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
  let blinkTimer = null;
  let blinking = false;

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
        if (el.dataset.src === src) renderSvg(el, mood);
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

  function scheduleBlink(el, mood, catId) {
    if (blinkTimer) clearTimeout(blinkTimer);
    if (el.classList.contains('cat-stretch')) return;
    const closedSrc = fileFor(catId, 'rest');
    if (!closedSrc || cache[closedSrc] === false) return;
    const gap = 2500 + Math.floor(Math.random() * 2500);
    blinkTimer = setTimeout(() => {
      if (blinking || el.classList.contains('cat-stretch')) {
        scheduleBlink(el, mood, catId);
        return;
      }
      blinking = true;
      el.style.backgroundImage = `url("${closedSrc}")`;
      setTimeout(() => {
        blinking = false;
        el.dataset.src = closedSrc;
        apply(el, mood, catId);
        scheduleBlink(el, mood, catId);
      }, 260);
    }, gap);
  }

  function playStretch(el) {
    if (!el || el.classList.contains('cat-fallback')) return;
    if (blinkTimer) clearTimeout(blinkTimer);
    const closedSrc = fileFor(activeCat, 'rest');
    if (!closedSrc || cache[closedSrc] === false) return;
    if (el.dataset.src === closedSrc) return;
    el.style.backgroundImage = `url("${closedSrc}")`;
    el.classList.add('cat-stretch');
    setTimeout(() => {
      el.classList.remove('cat-stretch');
      el.dataset.src = closedSrc;
      apply(el, 'work', activeCat);
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
      renderSvg(el, mood);
      return;
    }
    apply(el, mood, activeCat);
    if (!CLOSED_MOODS.includes(mood)) scheduleBlink(el, mood, activeCat);
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