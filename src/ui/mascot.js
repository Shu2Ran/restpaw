(function () {
  const SVG = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <g stroke="#e4dac8" stroke-width="3" stroke-linejoin="round">
    <path d="M32 48 L40 14 L63 33 Z" fill="#fffdf8"/>
    <path d="M88 48 L80 14 L57 33 Z" fill="#fffdf8"/>
    <path d="M40 42 L44 26 L56 35 Z" fill="#f3c0ca" stroke="none"/>
    <path d="M80 42 L76 26 L64 35 Z" fill="#f3c0ca" stroke="none"/>
  </g>
  <ellipse cx="60" cy="66" rx="42" ry="38" fill="#fffdf8" stroke="#e4dac8" stroke-width="3"/>
  <g stroke="#4a4844" stroke-width="3" stroke-linecap="round" fill="none">
    <path d="M41 62 q4 -6 8 0"/>
    <path d="M71 62 q4 -6 8 0"/>
  </g>
  <ellipse cx="34" cy="76" rx="6" ry="3.6" fill="#f3c0ca" opacity="0.85"/>
  <ellipse cx="86" cy="76" rx="6" ry="3.6" fill="#f3c0ca" opacity="0.85"/>
  <path d="M54 75 q6 6 12 0" stroke="#4a4844" stroke-width="3" stroke-linecap="round" fill="none"/>
</svg>`;

  const BASE = 'assets/cats/';
  const CLOSED_MOODS = ['rest', 'sleepy', 'happy'];
  const cache = {};
  const mounted = new Map();
  let manifest = null;
  let manifestFailed = false;
  let activeCat = null;
  // 眨眼状态按元素独立保存：el -> { timer, reopen }
  // 不能用模块级单例——一个窗口里有 4 个猫元素，而 render() 每秒都会被面板调用一次，
  // 单例计时器会被无限重排，眨眼一次也触发不了；闭包捕获的 catId 还会让
  // 工作期排下的链子一直拿旧猫画图，表现就是休息时两只猫来回跳。
  const blink = new Map();

  const moodOf = (el) => mounted.get(el) || 'work';

  function renderSvg(el, mood) {
    el.innerHTML = SVG;
    const svg = el.firstElementChild;
    if (svg) svg.setAttribute('class', `mascot mascot--${mood || 'work'}`);
    el.classList.remove('cat-photo');
    el.classList.add('cat-fallback');
    el.style.backgroundImage = '';
  }

  function fileFor(catId, mood) {
    const cat = manifest.cats.find((c) => c.id === catId) || manifest.cats[0];
    if (!cat) return null;
    return BASE + (CLOSED_MOODS.includes(mood) ? cat.closed : cat.open);
  }

  function preload(src) {
    if (!src || cache[src] !== undefined) return;
    const img = new Image();
    img.onload = () => {
      cache[src] = true;
    };
    img.onerror = () => {
      cache[src] = false;
      for (const [el, mood] of mounted) {
        if (el.dataset.src === src) {
          clearBlink(el);
          renderSvg(el, mood);
        }
      }
    };
    img.src = src;
  }

  function apply(el, mood, catId) {
    const src = fileFor(catId, mood);
    if (!src || cache[src] === false) {
      renderSvg(el, mood);
      return;
    }
    preload(src);
    if (el.querySelector('svg')) el.innerHTML = '';
    el.classList.add('cat-photo');
    el.classList.remove('cat-fallback');
    if (el.dataset.src !== src) {
      setImage(el, src);
    }
  }

  function setImage(el, src) {
    if (el.dataset.src === src) return;
    el.dataset.src = src;
    el.style.opacity = '0';
    el.style.backgroundImage = `url("${src}")`;
    requestAnimationFrame(() => {
      el.style.opacity = '1';
    });
  }

  function clearBlink(el) {
    const b = blink.get(el);
    if (!b) return;
    if (b.timer) clearTimeout(b.timer);
    if (b.reopen) clearTimeout(b.reopen);
    blink.delete(el);
  }

  // 排队一次眨眼。两个关键点：
  //   1. 不捕获 mood / catId，触发时现读——换猫、换心情都不会画到旧图上；
  //   2. 已有在途计时就直接返回——render() 每秒被面板调一次，
  //      否则计时器会被无限重排，工作状态的眨眼一次都眨不出来。
  function scheduleBlink(el) {
    if (!manifest || manifestFailed) return;
    if (el.classList.contains('cat-stretch')) return; // 伸懒腰时不眨
    if (CLOSED_MOODS.includes(moodOf(el))) return; // 休息 / 犯困 / 开心 ＝ 闭眼静止
    if (blink.has(el)) return; // 已在排队，别重排
    const timer = setTimeout(() => {
      const b = blink.get(el);
      if (b) b.timer = null;
      fireBlink(el);
    }, 2500 + Math.floor(Math.random() * 2500));
    blink.set(el, { timer, reopen: null });
  }

  function fireBlink(el) {
    const mood = moodOf(el);
    // 排队期间可能已经进了休息 / 开始伸懒腰，直接作废，绝不碰当前图片
    if (CLOSED_MOODS.includes(mood) || el.classList.contains('cat-stretch')) {
      clearBlink(el);
      return;
    }
    const catId = activeCat;
    const closedSrc = fileFor(catId, 'rest');
    if (!closedSrc || cache[closedSrc] === false) {
      clearBlink(el);
      return;
    }
    el.style.backgroundImage = `url("${closedSrc}")`;
    // 立刻同步 dataset：保证「dataset.src 永远等于当前画面」。
    // 否则在 260ms 窗口内切进休息时，clearBlink 会砍掉恢复定时器，
    // 留下一张闭眼图配着过期的 dataset，下一帧又白白重绘一次。
    el.dataset.src = closedSrc;
    const b = blink.get(el) || { timer: null, reopen: null };
    b.reopen = setTimeout(() => {
      b.reopen = null;
      // dataset 已是闭眼图，apply 会认为需要换图并切回睁眼图；
      // 若这 260ms 里心情变成了休息，apply 算出的仍是闭眼图，于是原地不动——
      // 既不会卡在闭眼，也不会误画睁眼图。
      apply(el, moodOf(el), activeCat);
      clearBlink(el);
      scheduleBlink(el);
    }, 260);
    blink.set(el, b);
  }

  function playStretch(el) {
    if (!el || el.classList.contains('cat-fallback')) return;
    clearBlink(el);
    const closedSrc = fileFor(activeCat, 'rest');
    if (!closedSrc || cache[closedSrc] === false) return;
    if (el.dataset.src === closedSrc) return;
    el.style.backgroundImage = `url("${closedSrc}")`;
    el.classList.add('cat-stretch');
    setTimeout(() => {
      el.classList.remove('cat-stretch');
      el.dataset.src = closedSrc;
      apply(el, moodOf(el), activeCat);
      // 拉伸会把 blink 记录清掉，结束后要重新排队，否则这只猫再也不眨眼了
      scheduleBlink(el);
    }, 900);
  }

  function load() {
    return fetch(`${BASE}manifest.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.cats) || !data.cats.length) throw new Error('manifest 无有效猫');
        manifest = data;
      })
      .catch(() => {
        manifestFailed = true;
      });
  }

  function render(el, mood) {
    if (!el) return;
    if (!manifest || manifestFailed) {
      clearBlink(el);
      renderSvg(el, mood);
      return;
    }
    apply(el, mood, activeCat);
    // 进闭眼心情（休息 / 静音 / 暂停 / 伸懒腰）必须主动作废在途眨眼：
    // 否则工作期排下的那条链子会一路续期，拿旧 catId 反复覆盖当前图片。
    if (CLOSED_MOODS.includes(mood) || el.classList.contains('cat-stretch')) clearBlink(el);
    else scheduleBlink(el);
  }

  window.mascot = {
    ready: load().then(() => {
      if (manifest) {
        for (const cat of manifest.cats) {
          preload(BASE + cat.open);
          preload(BASE + cat.closed);
        }
      }
      for (const [el, mood] of mounted) render(el, mood);
    }),

    setCat(catId) {
      if (!manifest) return;
      const ids = manifest.cats.map((c) => c.id);
      activeCat = ids.includes(catId) ? catId : ids[Math.floor(Math.random() * ids.length)];
    },

    currentCat() {
      return activeCat;
    },

    hasPhotos() {
      return !!manifest && !manifestFailed;
    },

    mount(el, mood) {
      if (!el) return;
      mounted.set(el, mood);
      render(el, mood);
    },

    playStretch,

    setHover(el, on) {
      if (!el) return;
      el.classList.toggle('cat-hover', !!on);
    },
  };
})();