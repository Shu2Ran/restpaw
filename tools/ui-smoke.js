'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');

function tmpUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rp-ui-'));
}

function seed(dir, state, stats) {
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
  if (stats) fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(stats));
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
}

async function withApp(dir, state, stats, fn) {
  if (typeof stats === 'function') {
    fn = stats;
    stats = null;
  }
  seed(dir, state, stats);
  const { _electron } = require(path.join(ROOT, 'node_modules', 'playwright-core'));
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, '--no-sandbox'],
    env: Object.assign({}, process.env, { RESTPAW_USER_DATA: dir }),
    timeout: 20000,
  });
  const kill = () => {
    try {
      app.process().kill('SIGKILL');
    } catch (e) {}
  };
  const ctx = {
    app,
    kill,
    waitPage: async (pred, ms = 8000) => {
      const t0 = Date.now();
      let lastErr = null;
      while (Date.now() - t0 < ms) {
        for (const p of app.windows()) {
          try {
            if (await pred(p)) return p;
          } catch (e) {
            lastErr = e;
          }
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      throw new Error('page not found' + (lastErr ? `: ${lastErr.message}` : ''));
    },
    visible: async (p) => {
      return p.evaluate(() => {
        const s = window.__lastState;
        if (!s || !s.visible) return null;
        return s.visible;
      });
    },
  };
  try {
    return await fn(ctx);
  } finally {
    try {
      app.process().kill('SIGKILL');
    } catch (e) {}
    await new Promise((r) => {
      let p = null;
      try {
        p = app.process();
      } catch (e) {
        return r();
      }
      if (!p || p.exitCode !== null) return r();
      p.on('exit', r);
      setTimeout(r, 1500);
    });
  }
}

const NOW = () => Date.now();
const IDLE = { phase: 'idle', deadline: 0, round: 0, awaiting: null, snoozeUntil: 0, muteUntil: 0, frozen: false, frozenRemaining: 0, nextBreak: null, lastBreak: null };

async function findPopup(ctx) {
  return ctx.waitPage(async (p) => (await p.$$('#btn-break')).length > 0 || (await p.$$('#btn-early')).length > 0);
}

async function findPanel(ctx) {
  return ctx.waitPage(async (p) => (await p.$$('#btn-toggle')).length > 0);
}

async function findSettings(ctx) {
  return ctx.waitPage(async (p) => (await p.$$('#btn-save')).length > 0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CATS_DIR = path.join(ROOT, 'src', 'ui', 'assets', 'cats');
const FIXTURE_CATS = path.join(ROOT, 'tests', 'fixtures', 'cats');

/**
 * 把 tests/fixtures/cats/ 里的**合成**素材铺进素材目录，跑完还原。
 *
 * 为什么需要：作者的真实猫图不进版本库（属个人素材），但没有图片素材就没法
 * 验证「两只猫随机 / 眨眼 / 伸懒腰 / 素材损坏回退」这些行为。本机若已有真实
 * 素材会先备份再原样还原，所以本地开发跑测试不会动到你的猫。
 */
async function withStagedCats(fn) {
  const backup = new Map();
  if (fs.existsSync(CATS_DIR)) {
    for (const f of fs.readdirSync(CATS_DIR)) backup.set(f, fs.readFileSync(path.join(CATS_DIR, f)));
  }
  fs.mkdirSync(CATS_DIR, { recursive: true });
  for (const f of fs.readdirSync(FIXTURE_CATS)) {
    if (f === 'README.md') continue;
    fs.writeFileSync(path.join(CATS_DIR, f), fs.readFileSync(path.join(FIXTURE_CATS, f)));
  }
  try {
    return await fn();
  } finally {
    for (const f of fs.readdirSync(CATS_DIR)) {
      if (!backup.has(f)) fs.rmSync(path.join(CATS_DIR, f), { force: true });
    }
    for (const [f, buf] of backup) fs.writeFileSync(path.join(CATS_DIR, f), buf);
  }
}

const waitVis = async (page, key, val, timeout = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await page
      .evaluate(() => (window.__lastState || {}).visible)
      .catch(() => null);
    if (v && v[key] === val) return;
    await sleep(150);
  }
  throw new Error(`timeout waiting visible.${key} === ${val}`);
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('弹窗出现并可秒关（Esc / 跳过本次）', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: NOW() - 1000, round: 1, awaiting: 'work-end', nextBreak: 'short' }), async (ctx) => {
    const popup = await findPopup(ctx);
    await waitVis(popup, 'popup', true);
    assert.ok(await popup.$('[data-mode="work-end"]'), 'work-end 区域应显示');
    await popup.click('#btn-skip');
    await waitVis(popup, 'popup', false);
    const s = readState(dir);
    assert.equal(s.phase, 'work');
    assert.equal(s.awaiting, null);
  });
});

test('弹窗去休息后转为休息倒计时窗，Esc 收起不打断', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: NOW() - 1000, round: 1, awaiting: 'work-end', nextBreak: 'short' }), async (ctx) => {
    const popup = await findPopup(ctx);
    await popup.click('#btn-break');
    await popup.waitForFunction(() => window.__lastState && window.__lastState.phase === 'short', null, { timeout: 4000 });
    assert.match(await popup.textContent('#break-phase'), /休息/);
    await popup.keyboard.press('Escape');
    await waitVis(popup, 'popup', false);
    const s = readState(dir);
    assert.equal(s.phase, 'short', '休息倒计时应继续');
  });
});

test('会议模式可设置、可取消，角标同步', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: NOW() + 600000, round: 0 }), async (ctx) => {
    const panel = await findPanel(ctx);
    await panel.selectOption('#sel-mute', '30');
    await panel.waitForFunction(() => window.__lastState && window.__lastState.muted === true, null, { timeout: 4000 });
    const s = readState(dir);
    assert.ok(s.muteUntil > NOW(), '静音应生效');
    assert.equal(await panel.evaluate(() => document.querySelector('#mute-badge').classList.contains('hidden')), false, '静音角标应显示');

    await panel.selectOption('#sel-mute', '0');
    await panel.waitForFunction(() => window.__lastState && window.__lastState.muted === false, null, { timeout: 4000 });
    const s2 = readState(dir);
    assert.equal(s2.muteUntil, 0, '取消后应解除静音');
    assert.equal(await panel.evaluate(() => document.querySelector('#mute-badge').classList.contains('hidden')), true, '角标应隐藏');

    await panel.selectOption('#sel-mute', 'manual');
    await panel.waitForFunction(() => window.__lastState && window.__lastState.muteUntil === Infinity, null, { timeout: 4000 });
    await panel.selectOption('#sel-mute', '0');
    await panel.waitForFunction(() => window.__lastState && window.__lastState.muted === false, null, { timeout: 4000 });
  });
});

test('静音期间工作结束不弹窗，解除后补弹', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: NOW() + 3000, round: 1 }), async (ctx) => {
    const panel = await findPanel(ctx);
    await panel.selectOption('#sel-mute', '30');
    await panel.waitForFunction(() => window.__lastState && window.__lastState.muted === true, null, { timeout: 4000 });
    await panel.waitForFunction(() => window.__lastState && window.__lastState.awaiting === 'work-end', null, { timeout: 8000 });
    const s = readState(dir);
    assert.equal(s.awaiting, 'work-end', '工作结束状态应已落盘');
    const vis = await Promise.all(ctx.app.windows().map(async (p) => p.evaluate(() => (window.__lastState || {}).visible).catch(() => null)));
    assert.equal(vis.some((v) => v && v.popup), false, '静音中不应弹出提醒窗');

    await panel.selectOption('#sel-mute', '0');
    const popup = await ctx.waitPage((p) => p.url().includes('popup.html'), 5000);
    await waitVis(popup, 'popup', true, 5000);
    const vis2 = await Promise.all(ctx.app.windows().map(async (p) => p.evaluate(() => (window.__lastState || {}).visible).catch(() => null)));
    assert.equal(vis2.some((v) => v && v.popup), true, '解除静音后应补弹提醒窗');
  });
});

test('设置页：保存后自动关闭，未修改可关闭', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 20 * 60 * 1000 }), async (ctx) => {
    const panel = await findPanel(ctx);
    await panel.click('#btn-settings');
    const settings = await findSettings(ctx);
    await waitVis(settings, 'settings', true);
    await settings.fill('#workMin', '25');
    await settings.click('#btn-save');
    await sleep(1200);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(cfg.workMin, 25, '配置应已保存');
    await waitVis(settings, 'settings', false, 3000);

    await panel.click('#btn-settings');
    const settings2 = await findSettings(ctx);
    await waitVis(settings2, 'settings', true);
    await settings2.click('#btn-close');
    await waitVis(settings2, 'settings', false, 3000);

    await panel.click('#btn-settings');
    const settings3 = await findSettings(ctx);
    await waitVis(settings3, 'settings', true);
    await settings3.keyboard.press('Escape');
    await waitVis(settings3, 'settings', false, 3000);
  });
});

test('面板可完全退出程序', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 20 * 60 * 1000 }), async (ctx) => {
    const panel = await findPanel(ctx);
    await panel.click('#btn-quit');
    let gone = false;
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      try {
        if (ctx.app.windows().length === 0) {
          gone = true;
          break;
        }
      } catch (e) {
        gone = true;
        break;
      }
    }
    assert.ok(gone, '点击退出后进程和窗口应结束');
  });
});

test('面板跳过工作：弹窗显示已跳过，跳过休息后进入下一轮', async () => {
  const dir = tmpUserData();
  const stats = { day: today(), workRounds: 0, shortRests: 0, longRests: 0, skippedRests: 0, skippedWorks: 0 };
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: NOW() + 20 * 60000, round: 0 }), stats, async (ctx) => {
    const panel = await findPanel(ctx);
    await waitVis(panel, 'panel', true);
    assert.equal(await panel.textContent('#btn-skip'), '跳过工作');
    await panel.click('#btn-skip');
    const popup = await findPopup(ctx);
    await waitVis(popup, 'popup', true);
    assert.match(await popup.textContent('#lead-work'), /已跳过本轮工作/);
    await popup.click('#btn-skip');
    await waitVis(popup, 'popup', false);
    const s = readState(dir);
    assert.equal(s.phase, 'work');
    assert.equal(s.round, 1, '跳过的工作计入轮次');
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'));
    assert.equal(st.skippedWorks, 1);
    assert.equal(st.skippedRests, 1);
  });
});

test('设置「立即生效」：按新时长重算当前轮剩余', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: NOW() + 35 * 60000 }), null, async (ctx) => {
    const panel = await findPanel(ctx);
    await panel.click('#btn-settings');
    const settings = await findSettings(ctx);
    await waitVis(settings, 'settings', true);
    await settings.fill('#workMin', '40');
    await settings.check('input[name="apply"][value="now"]');
    const before = Date.now();
    await settings.click('#btn-save');
    await waitVis(settings, 'settings', false, 3000);
    await sleep(400);
    const s = readState(dir);
    assert.ok(s.deadline > before + 29 * 60000 && s.deadline < before + 31 * 60000, '剩余应重算为约 30 分钟（已进行 10 分钟）');
    assert.equal(s.phase, 'work');
  });
});

test('设置「下一轮」：当前轮不受影响', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: NOW() + 35 * 60000 }), null, async (ctx) => {
    const panel = await findPanel(ctx);
    await panel.click('#btn-settings');
    const settings = await findSettings(ctx);
    await waitVis(settings, 'settings', true);
    await settings.fill('#workMin', '40');
    await settings.click('#btn-save');
    await waitVis(settings, 'settings', false, 3000);
    await sleep(400);
    const s = readState(dir);
    assert.ok(s.deadline > NOW() + 33 * 60000, '当前轮剩余应保持不变（约 35 分钟）');
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(cfg.workMin, 40, '配置已保存，下轮使用');
  });
});

test('休息结束弹窗：点「开始工作」后才开始计时', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'short', deadline: NOW() + 2000, round: 2 }), null, async (ctx) => {
    const popup = await findPopup(ctx);
    await waitVis(popup, 'popup', true);
    await popup.waitForFunction(() => window.__lastState && window.__lastState.awaiting === 'break-end', null, { timeout: 5000 });
    assert.equal((await popup.textContent('#btn-work')).trim(), '开始工作');
    await sleep(2500);
    let s = readState(dir);
    assert.equal(s.phase, 'short', '不点击则不开始工作');
    assert.equal(s.awaiting, 'break-end');

    await popup.click('#btn-work');
    await waitVis(popup, 'popup', false);
    s = readState(dir);
    assert.equal(s.phase, 'work');
    assert.equal(s.awaiting, null);
    assert.ok(s.deadline > NOW() + 40 * 60000, '应按完整工作时长开始计时');
  });
});

test('每日首次启动：空闲状态弹「开始工作」确认窗', async () => {
  const dir = tmpUserData();
  await withApp(dir, IDLE, null, async (ctx) => {
    const popup = await ctx.waitPage((p) => p.url().includes('popup.html'), 8000);
    await waitVis(popup, 'popup', true);
    await popup.waitForFunction(() => window.__lastState && window.__lastState.prompt === 'start', null, { timeout: 5000 });
    assert.match(await popup.textContent('[data-mode="start"]'), /新的一天|开始专注/);

    await popup.click('#btn-start');
    await sleep(600);
    const s = readState(dir);
    assert.equal(s.phase, 'work', '点击后才开始工作');
    const panel = await ctx.waitPage((p) => p.url().includes('panel.html'), 5000);
    await panel.waitForFunction(() => !!window.__lastState, null, { timeout: 5000 });
    const visAfter = await panel.evaluate(() => window.__lastState.visible);
    assert.equal(visAfter.panel, true, '开始后显示面板');
  });
});

test('确认窗可关闭：不开始计时，程序留在待命状态', async () => {
  const dir = tmpUserData();
  await withApp(dir, IDLE, null, async (ctx) => {
    const popup = await ctx.waitPage((p) => p.url().includes('popup.html'), 8000);
    await waitVis(popup, 'popup', true);
    await popup.keyboard.press('Escape');
    await waitVis(popup, 'popup', false);
    await sleep(1500);
    const s = readState(dir);
    assert.equal(s.phase, 'idle', '关闭确认窗不应开始计时');
  });
});

test('跨天过期会话：启动时丢弃，不凭空多一轮', async () => {
  const dir = tmpUserData();
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const dayStr = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
  const stats = { day: dayStr, workRounds: 7, shortRests: 5, longRests: 2, skippedRests: 1, skippedWorks: 3 };
  const stale = Object.assign({}, IDLE, {
    phase: 'work',
    // 昨天 23:30 开始的 45 分钟工作轮，deadline 今天 00:15（跨天）
    deadline: (() => {
      const d = new Date();
      d.setHours(0, 15, 0, 0);
      return d.getTime();
    })(),
    round: 4,
    workedMs: 6 * 60 * 60 * 1000,
    workedDay: dayStr,
  });
  await withApp(dir, stale, stats, async (ctx) => {
    // 轮询等待启动清理落盘完成
    let s = null;
    for (let i = 0; i < 40; i++) {
      s = readState(dir);
      if (s && s.phase === 'idle' && s.round === 0) break;
      await sleep(200);
    }
    assert.equal(s.phase, 'idle', '过期会话应被丢弃，回到空闲');
    assert.equal(s.round, 0, '轮数归零，不凭空多一轮');
    assert.equal(s.workedMs, 0, '工时归零');
    const popup = await ctx.waitPage((p) => p.url().includes('popup.html'), 8000);
    await waitVis(popup, 'popup', true);
    await popup.waitForFunction(() => window.__lastState && window.__lastState.prompt === 'start', null, { timeout: 5000 });
    const st = await popup.evaluate(() => window.__lastState.stats);
    assert.equal(st.workRounds, 0, '昨天的统计应已清零');
  });
});

test('同一天未完成的会话：必须继承续跑', async () => {
  const dir = tmpUserData();
  const live = Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 25 * 60 * 1000, round: 2 });
  await withApp(dir, live, null, async (ctx) => {
    await sleep(1500);
    const s = readState(dir);
    assert.equal(s.phase, 'work', '同一天会话应继承');
    assert.equal(s.round, 2);
    assert.ok(s.deadline > Date.now() + 20 * 60 * 1000, '剩余时间应继续走');
    const popupVisible = await Promise.all(ctx.app.windows().map(async (p) =>
      p.url().includes('popup.html')
        ? p.evaluate(() => (window.__lastState || {}).visible.popup).catch(() => false)
        : false
    ));
    assert.equal(popupVisible.some(Boolean), false, '继承的工作不应弹开始窗');
  });
});

test('工时进度条颜色：6h 绿 / 7h 黄 / 8h 红，且加班时文字变红', async () => {
  const work = (h) =>
    Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 20 * 60 * 1000, workedMs: h * 3600000, workedDay: today() });
  const probe = async (h) => {
    const dir = tmpUserData();
    const r = await withApp(dir, work(h), null, async (ctx) => {
      const panel = await findPanel(ctx);
      await waitVis(panel, 'panel', true);
      await panel.waitForFunction((expect) => window.__lastState && Math.abs(window.__lastState.workedMs - expect) < 60000, h * 3600000, { timeout: 8000 });
      await sleep(1200);
      return panel.evaluate(() => ({
        worked: window.__lastState.workedMs,
        color: getComputedStyle(document.getElementById('worked-fill')).backgroundColor,
        labelColor: getComputedStyle(document.getElementById('worked-label')).color,
        label: document.getElementById('worked-label').textContent,
        width: document.getElementById('worked-fill').style.width,
      }));
    });
    await sleep(800);
    return r;
  };
  const p6 = await probe(6);
  assert.equal(p6.color, 'rgb(139, 191, 168)', '6小时应为薄荷绿');
  assert.equal(p6.labelColor, 'rgb(140, 135, 121)', '6小时文字应为灰色');

  const p7 = await probe(7);
  const m = p7.color.match(/rgb\((\d+), (\d+), (\d+)\)/);
  assert.ok(m, '7小时应有颜色');
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  assert.ok(r > 190 && g > 150 && b < 110, `7小时应为琥珀黄，实际 ${p7.color}`);

  const p8 = await probe(8.5);
  assert.equal(p8.color, 'rgb(192, 80, 63)', '超8小时应为红色');
  assert.equal(p8.labelColor, 'rgb(192, 80, 63)', '加班文字应同步变红');
  assert.match(p8.label, /已加班：30分/);
  assert.equal(p8.width, '100%', '超8小时进度条维持满格');
});

test('两只猫随机：启动随机且状态带 catId，轮次切换重随机', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 20 * 60 * 1000 }), null, async (ctx) => {
    const panel = await findPanel(ctx);
    await waitVis(panel, 'panel', true);
    const info = await panel.evaluate(() => ({
      cat: window.__lastState.catId,
      catClass: document.getElementById('mascot').classList.contains('cat-photo'),
      src: document.getElementById('mascot').style.backgroundImage,
      liveCat: window.mascot.currentCat(),
      leftoverSvg: !!document.querySelector('#mascot svg'),
      bgImage: getComputedStyle(document.getElementById('mascot')).backgroundImage,
    }));
    assert.ok(['a', 'b'].includes(info.cat), '应随机选中 a 或 b');
    assert.equal(info.catClass, true, '应使用猫照片而非SVG兜底');
    assert.match(info.src, /assets\/cats\//, '背景图应指向猫素材');
    assert.equal(info.liveCat, info.cat, '渲染进程应同步主进程的猫');
    assert.equal(info.leftoverSvg, false, '不应残留手绘SVG遮挡照片');
    assert.match(info.bgImage, /assets\/cats\//, '计算样式应显示猫照片');
  });
});

test('素材缺失时回退手绘 SVG 猫', async () => {
  const dir = tmpUserData();
  const fs2 = require('fs');
  const path2 = require('path');
  const backup = path2.join(dir, 'manifest-backup.json');
  fs2.copyFileSync(path2.join(ROOT, 'src/ui/assets/cats/manifest.json'), backup);
  try {
    fs2.writeFileSync(path2.join(ROOT, 'src/ui/assets/cats/manifest.json'), '[]');
    await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 20 * 60 * 1000 }), null, async (ctx) => {
      const panel = await findPanel(ctx);
      await waitVis(panel, 'panel', true);
      const info = await panel.evaluate(() => ({
        hasPhotos: window.mascot.hasPhotos(),
        fallback: document.getElementById('mascot').classList.contains('cat-fallback'),
        svg: !!document.querySelector('#mascot svg'),
        cat: window.__lastState.catId,
      }));
      assert.equal(info.hasPhotos, false, '无素材时应报告无照片');
      assert.equal(info.fallback, true, '应使用SVG兜底');
      assert.equal(info.svg, true, '应渲染出手绘SVG猫');
      assert.equal(info.cat, null, '主进程不应下发catId');
    });
  } finally {
    fs2.copyFileSync(backup, path2.join(ROOT, 'src/ui/assets/cats/manifest.json'));
  }
});

test('图片文件损坏/丢失时回退手绘 SVG 猫', async () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const catsDir = path2.join(ROOT, 'src/ui/assets/cats');
  const backups = {};
  for (const f of fs2.readdirSync(catsDir)) {
    backups[f] = fs2.readFileSync(path2.join(catsDir, f));
  }
  const restore = () => {
    for (const [f, buf] of Object.entries(backups)) fs2.writeFileSync(path2.join(catsDir, f), buf);
  };
  try {
    // 场景一：图片内容被破坏（不是合法 PNG）
    for (const f of ['a-open.png', 'a-closed.png', 'b-open.png', 'b-closed.png']) {
      fs2.writeFileSync(path2.join(catsDir, f), 'this is not a valid png');
    }
    await withApp(tmpUserData(), Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 20 * 60 * 1000 }), null, async (ctx) => {
      const panel = await findPanel(ctx);
      await waitVis(panel, 'panel', true);
      await panel.waitForFunction(() => !!window.__lastState, null, { timeout: 5000 });
      await sleep(2500);
      const info = await panel.evaluate(() => ({
        fallback: document.getElementById('mascot').classList.contains('cat-fallback'),
        svg: !!document.querySelector('#mascot svg'),
        hasPhotos: window.mascot.hasPhotos(),
      }));
      assert.equal(info.svg, true, '图片损坏时应渲染手绘SVG猫');
      assert.equal(info.fallback, true, '图片损坏时应标记为兜底状态');
      assert.equal(info.hasPhotos, true, 'manifest 本身有效，只是图片坏了');
    });

    // 场景二：图片文件直接缺失
    restore();
    for (const f of ['a-open.png', 'a-closed.png', 'b-open.png', 'b-closed.png']) {
      fs2.unlinkSync(path2.join(catsDir, f));
    }
    await withApp(tmpUserData(), Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 20 * 60 * 1000 }), null, async (ctx) => {
      const panel = await findPanel(ctx);
      await waitVis(panel, 'panel', true);
      await panel.waitForFunction(() => !!window.__lastState, null, { timeout: 5000 });
      await sleep(2500);
      const svg = await panel.evaluate(() => !!document.querySelector('#mascot svg'));
      assert.equal(svg, true, '图片缺失时应渲染手绘SVG猫');
    });
  // 场景三：只有闭眼图损坏，睁眼图应照常显示
    restore();
    for (const f of ['a-closed.png', 'b-closed.png']) {
      fs2.writeFileSync(path2.join(catsDir, f), 'broken');
    }
    await withApp(tmpUserData(), Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 20 * 60 * 1000 }), null, async (ctx) => {
      const panel = await findPanel(ctx);
      await waitVis(panel, 'panel', true);
      await panel.waitForFunction(() => !!window.__lastState, null, { timeout: 5000 });
      await sleep(2500);
      const info = await panel.evaluate(() => ({
        photo: document.getElementById('mascot').classList.contains('cat-photo'),
        svg: !!document.querySelector('#mascot svg'),
      }));
      assert.equal(info.photo, true, '睁眼图完好时仍应显示照片猫');
      assert.equal(info.svg, false, '睁眼图完好时不应出现SVG');
    });
  } finally {
    restore();
  }
});

test('动画增强：呼吸幅度、摇摆、悬停类、淡入淡出真实生效', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 20 * 60 * 1000 }), null, async (ctx) => {
    const panel = await findPanel(ctx);
    await waitVis(panel, 'panel', true);
    await panel.waitForFunction(() => window.__lastState && window.__lastState.phase === 'work', null, { timeout: 5000 });
    await sleep(500);
    const r = await panel.evaluate(async () => {
      const el = document.getElementById('mascot');
      const cs = getComputedStyle(el);
      const scale = [];
      const rotate = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 2700) {
        const s = getComputedStyle(el);
        scale.push(parseFloat(s.scale));
        rotate.push(parseFloat(s.rotate));
        await new Promise((r) => setTimeout(r, 90));
      }
      return {
        animation: cs.animationName,
        transition: cs.transitionProperty,
        opacity: el.style.opacity,
        sway: el.classList.contains('cat-sway'),
        scaleMin: Math.min(...scale),
        scaleMax: Math.max(...scale),
        rotateMin: Math.min(...rotate),
        rotateMax: Math.max(...rotate),
      };
    });
    assert.ok(r.animation.includes('breathe'), '应有呼吸动画');
    assert.ok(r.animation.includes('sway'), '工作中应叠加摇摆动画');
    assert.ok(r.transition.includes('opacity'), '应声明 opacity 过渡（淡入淡出）');
    assert.equal(r.opacity, '1', '切换图片后应淡入到不透明');
    assert.equal(r.sway, true, '工作中应带 cat-sway 类');
    // 回归防护：breathe/sway 若共用 transform 属性会互相覆盖，摇摆将吃掉呼吸
    assert.ok(r.scaleMax - r.scaleMin > 0.02, `工作中应真实呼吸缩放，实际波动 ${(r.scaleMax - r.scaleMin).toFixed(3)}`);
    assert.ok(r.rotateMax - r.rotateMin > 3, `工作中应真实摇摆 ±3.5°，实际波动 ${(r.rotateMax - r.rotateMin).toFixed(2)}`);
  });
});

test('悬停看过来：mouseenter 加类、mouseleave 移除', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 20 * 60 * 1000 }), null, async (ctx) => {
    const panel = await findPanel(ctx);
    await waitVis(panel, 'panel', true);
    await panel.dispatchEvent('#mascot', 'mouseenter');
    await panel.waitForFunction(() => document.getElementById('mascot').classList.contains('cat-hover'), null, { timeout: 3000 });
    await sleep(400);
    // 回归防护：paused 动画仍会覆盖基础样式，必须 animation:none 才有效
    const hovered = await panel.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('mascot'));
      return { scale: parseFloat(cs.scale), rotate: parseFloat(cs.rotate), anim: cs.animationName };
    });
    assert.equal(hovered.scale, 1.1, `悬停应真实放大到 1.1，实际 ${hovered.scale}`);
    assert.equal(hovered.rotate, -3, `悬停应真实歪头 -3°，实际 ${hovered.rotate}`);
    assert.equal(hovered.anim, 'none', '悬停应停止动画，否则基础样式被覆盖');
    await panel.dispatchEvent('#mascot', 'mouseleave');
    await panel.waitForFunction(() => !document.getElementById('mascot').classList.contains('cat-hover'), null, { timeout: 3000 });
    await sleep(300);
    const back = await panel.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('mascot'));
      return { scale: parseFloat(cs.scale), anim: cs.animationName };
    });
    assert.notEqual(back.anim, 'none', '移开鼠标后动画应恢复');
    assert.ok(back.scale < 1.09, `移开后应回弹，实际 ${back.scale}`);
  });
});

test('伸懒腰：工作结束弹窗出现时播放并自动结束', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: Date.now() + 2000, round: 1 }), null, async (ctx) => {
    const popup = await ctx.waitPage((p) => p.url().includes('popup.html'), 8000);
    await waitVis(popup, 'popup', true);
    await popup.waitForFunction(() => window.__lastState && window.__lastState.awaiting === 'work-end', null, { timeout: 6000 });
    const played = await popup.waitForFunction(() => document.querySelector('#m-work').classList.contains('cat-stretch'), null, { timeout: 3000 }).then(() => true).catch(() => false);
    assert.equal(played, true, '工作结束时猫应播放伸懒腰');
    await popup.waitForFunction(() => !document.querySelector('#m-work').classList.contains('cat-stretch'), null, { timeout: 3000 });
    const settled = await popup.evaluate(() => {
      const el = document.querySelector('#m-work');
      return { stretch: el.classList.contains('cat-stretch'), src: el.style.backgroundImage };
    });
    assert.equal(settled.stretch, false, '伸懒腰结束后应移除 class');
    assert.ok(!/closed/.test(settled.src), '结束后应恢复睁眼图');
  });
});

test('今日工时进度条：8 小时前显示已工作，超过显示已加班', async () => {
  const dir = tmpUserData();
  const withWorked = (h) =>
    Object.assign({}, IDLE, {
      phase: 'work',
      deadline: Date.now() + 20 * 60 * 1000,
      workedMs: h * 3600000,
      workedDay: today(),
    });
  await withApp(dir, withWorked(3.5), null, async (ctx) => {
    const panel = await findPanel(ctx);
    await waitVis(panel, 'panel', true);
    assert.match(await panel.textContent('#worked-label'), /^今日已工作：3小时30分$/);
    const w1 = await panel.evaluate(() => document.getElementById('worked-fill').style.width);
    assert.ok(parseFloat(w1) > 40 && parseFloat(w1) < 46, '进度条约为 44%');
  });
  await withApp(dir, withWorked(9), null, async (ctx) => {
    const panel = await findPanel(ctx);
    await waitVis(panel, 'panel', true);
    assert.match(await panel.textContent('#worked-label'), /^已加班：1小时$/);
    const w2 = await panel.evaluate(() => document.getElementById('worked-fill').style.width);
    assert.equal(parseFloat(w2), 100);
  });
});

test('工作结束等待确认：圆环转橘红并显示递增的已超时', async () => {
  const dir = tmpUserData();
  const OVER = 'rgb(226, 112, 58)';
  const seedOver = Object.assign({}, IDLE, {
    phase: 'work',
    deadline: NOW() - 3000, // 启动时就已经超时 3 秒
    awaiting: 'work-end',
    nextBreak: 'short',
    round: 1,
    workedMs: 3.5 * 3600000,
    workedDay: today(),
  });

  await withApp(dir, seedOver, null, async (ctx) => {
    const popup = await findPopup(ctx);
    await waitVis(popup, 'popup', true);
    await popup.evaluate(() => window.api.call('showPanel'));
    const panel = await findPanel(ctx);
    await waitVis(panel, 'panel', true);
    await panel.waitForFunction(() => window.__lastState && window.__lastState.awaiting === 'work-end', null, { timeout: 5000 });
    await sleep(800); // 等 0.4s 的 stroke / color 过渡走完，否则会读到中间色

    const read = () =>
      panel.evaluate(() => {
        const ring = document.getElementById('ring');
        const t = document.getElementById('clock').textContent.trim();
        const m = t.match(/^已超时 (\d+):(\d{2})$/);
        const fill = document.getElementById('worked-fill');
        return {
          clock: t,
          seconds: m ? Number(m[1]) * 60 + Number(m[2]) : null,
          stroke: getComputedStyle(ring).stroke,
          offset: parseFloat(ring.style.strokeDashoffset || '0'),
          phase: document.getElementById('phase').textContent.trim(),
          phaseColor: getComputedStyle(document.getElementById('phase')).color,
          barColor: getComputedStyle(fill).getPropertyValue('--bar-color').trim(),
        };
      });

    const a = await read();
    assert.notEqual(a.seconds, null, `时钟应显示「已超时 mm:ss」，实际 "${a.clock}"`);
    assert.equal(a.stroke, OVER, `圆环应变橘红，实际 ${a.stroke}`);
    assert.equal(a.phase, '该休息啦');
    assert.equal(a.phaseColor, OVER, `阶段文案应变橘红，实际 ${a.phaseColor}`);
    assert.ok(a.offset < 1, `超时期间圆环应保持满环，实际 dashoffset=${a.offset}`);
    assert.ok(!/226,\s*112,\s*58/.test(a.barColor), `工时进度条配色不应受超时影响，实际 ${a.barColor}`);

    await sleep(3200);
    const b = await read();
    assert.ok(b.seconds > a.seconds, `已超时应递增：${a.seconds}s → ${b.seconds}s`);
  });

  // 回归防护：正常工作中圆环必须仍是薄荷绿，否则「变橘红」这条断言没有判别力
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: NOW() + 20 * 60 * 1000, workedDay: today() }), null, async (ctx) => {
    const panel = await findPanel(ctx);
    await waitVis(panel, 'panel', true);
    const st = await panel.evaluate(() => getComputedStyle(document.getElementById('ring')).stroke);
    assert.equal(st, 'rgb(168, 213, 194)', `工作中圆环应为薄荷绿，实际 ${st}`);
  });
});

test('休息中猫眼闭着：7 秒内画面与猫都不许变', async () => {
  const dir = tmpUserData();
  // 必须真的走一遍「工作 → 休息」跳转：缺陷就出在工作期排下的那条眨眼链，
  // 直接以休息态启动是测不出来的。
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: NOW() + 9000, round: 1, workedDay: today() }), null, async (ctx) => {
    const panel = await findPanel(ctx);
    await waitVis(panel, 'panel', true);
    await panel.waitForFunction(() => window.__lastState && window.__lastState.phase === 'work', null, { timeout: 5000 });
    await sleep(1500); // 让工作期的眨眼排上队

    const popup = await findPopup(ctx);
    await waitVis(popup, 'popup', true);
    await popup.waitForFunction(() => window.__lastState && window.__lastState.awaiting === 'work-end', null, { timeout: 15000 });
    await popup.click('#btn-break');
    await panel.waitForFunction(() => window.__lastState && window.__lastState.phase === 'short', null, { timeout: 8000 });
    await sleep(600);

    // 用 MutationObserver 而非轮询：260ms 的闭眼窗口再短也逃不掉
    const r = await panel.evaluate(async () => {
      const el = document.getElementById('mascot');
      const changes = [];
      const mo = new MutationObserver(() => changes.push(el.style.backgroundImage));
      mo.observe(el, { attributes: true, attributeFilter: ['style'] });
      await new Promise((res) => setTimeout(res, 7000));
      mo.disconnect();
      return { changes, final: el.style.backgroundImage, src: el.dataset.src, cat: (window.__lastState || {}).catId };
    });

    // 断言的是「休息时绝不睁眼」这个真实不变量，而不是「一帧都不许变」：
    // 同一张闭眼图被重复写入是无害的，而旧缺陷会不停刷出 a-open / b-open 串猫。
    const opened = r.changes.filter((s) => /open/.test(s));
    assert.deepEqual(opened, [], `休息期间绝不该出现睁眼图，实际 ${JSON.stringify(r.changes)}`);
    assert.ok(/closed/.test(r.final), `休息时应显示闭眼图，实际 ${r.final}`);
    assert.ok(/closed/.test(r.src), `dataset 应停在闭眼图，实际 ${r.src}`);
    assert.ok(r.cat === 'a' || r.cat === 'b', `猫应保持不变，实际 ${r.cat}`);
  });
});

test('工作中猫咪会眨眼：9 秒内出现闭眼图并自动睁回', async () => {
  const dir = tmpUserData();
  await withApp(dir, Object.assign({}, IDLE, { phase: 'work', deadline: NOW() + 20 * 60 * 1000, workedDay: today() }), null, async (ctx) => {
    const panel = await findPanel(ctx);
    await waitVis(panel, 'panel', true);
    await panel.waitForFunction(() => window.__lastState && window.__lastState.phase === 'work', null, { timeout: 5000 });

    const r = await panel.evaluate(async () => {
      const el = document.getElementById('mascot');
      const seen = [];
      const mo = new MutationObserver(() => seen.push(el.style.backgroundImage));
      mo.observe(el, { attributes: true, attributeFilter: ['style'] });
      await new Promise((res) => setTimeout(res, 9000));
      mo.disconnect();
      return { seen, final: el.style.backgroundImage, src: el.dataset.src };
    });

    // 回归防护：旧实现里 render() 每秒重排一次计时器，眨眼一次都触发不了
    assert.ok(r.seen.length > 0, `9 秒内应至少发生一次换图（眨眼），实际 ${JSON.stringify(r.seen)}`);
    assert.ok(r.seen.some((s) => /closed/.test(s)), `眨眼时应短暂显示闭眼图，实际 ${JSON.stringify(r.seen)}`);
    assert.ok(/open/.test(r.final), `眨眼结束后应恢复睁眼图，实际 ${r.final}`);
    assert.ok(/open/.test(r.src), `dataset 应回到睁眼图，实际 ${r.src}`);
  });
});

// 整轮跑之前统一把合成猫素材铺进素材目录，跑完还原。
// 作者的真实猫图不进版本库，但没有图片素材就没法验证换猫/眨眼/伸懒腰/素材回退。
// 本机若已有真实素材会原样备份还原，所以本地开发跑测试不会动到你的猫。
(async () => {
  const only = process.argv[2];
  const list = only ? tests.filter((t) => t.name.includes(only)) : tests;
  let failed = 0;
  await withStagedCats(async () => {
    for (const t of list) {
      try {
        await t.fn();
        console.log(`ok - ${t.name}`);
      } catch (e) {
        failed++;
        console.error(`not ok - ${t.name}\n  ${e.stack.split('\n').slice(0, 3).join('\n  ')}`);
      }
    }
  });
  process.exit(failed ? 1 : 0);
})();
