'use strict';

const path = require('path');
const fs = require('fs');
const { app, Tray, Menu, nativeImage, ipcMain, globalShortcut } = require('electron');

const Store = require('./engine/store').Store;
const Pomodoro = require('./engine/pomodoro');
const { CatPicker } = require('./engine/cat-picker');
const { buildLoginItemOptions } = require('./paths');
const createWindowManager = require('./windows');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(bootstrap);
}

function bootstrap() {
  if (process.env.RESTPAW_USER_DATA) {
    try {
      app.setPath('userData', process.env.RESTPAW_USER_DATA);
    } catch (e) {
      console.error('[main] cannot override userData:', e.message);
    }
  }
  const store = new Store(app.getPath('userData'));
  const wm = createWindowManager({ preload: path.join(__dirname, 'preload.js') });
  const engine = new Pomodoro(store.getConfig(), (type, payload) => onEngineEvent(type, payload));

  let tray = null;
  let lastPersist = 0;
  let lastSig = null;
  let startPrompt = false;
  let catIds = [];
  let activeCat = null;
  let lastPhase = null;
  let catPicker = new CatPicker([]);

  function loadCats() {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'ui', 'assets', 'cats', 'manifest.json'), 'utf8')
      );
      if (Array.isArray(manifest.cats) && manifest.cats.length) {
        catIds = manifest.cats.map((c) => c.id);
      }
    } catch (e) {
      catIds = [];
    }
    catPicker = new CatPicker(catIds);
    activeCat = catPicker.pick();
  }

  function maybeSwitchCat(s) {
    const was = lastPhase;
    lastPhase = s.phase;
    if (!was || was === s.phase) return;
    const workToBreak = was === 'work' && (s.phase === 'short' || s.phase === 'long');
    const breakToWork = (was === 'short' || was === 'long') && s.phase === 'work';
    if ((workToBreak || breakToWork) && catPicker.available) {
      activeCat = catPicker.pick();
    }
  }

  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png');
  const trayIcon = nativeImage.createFromPath(iconPath);
  if (trayIcon.isEmpty()) {
    console.error('[main] tray icon not found, run: node tools/make-icon.js');
  }

  function persist(now, force) {
    if (force || now - lastPersist > 30000) {
      lastPersist = now;
      store.setState(engine.toJSON());
    }
  }

  function signature() {
    const s = engine.getState(0);
    return [
      s.phase,
      s.awaiting,
      s.round,
      s.frozen,
      s.muted,
      s.nextBreak,
      s.snoozeUntil,
      s.muteUntil,
      s.deadline,
      s.frozenRemaining,
    ].join('|');
  }

  function broadcast(now) {
    const s = engine.getState(now);
    wm.broadcast(
      'state',
      Object.assign({ stats: store.getStats(), cfg: engine.cfg, visible: wm.visibility(), prompt: currentPrompt(now), catId: activeCat }, s)
    );
  }

  function updateTray(now) {
    if (tray) tray.setToolTip(tooltipText(now));
  }

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function statusText(now) {
    const s = engine.getState(now);
    if (s.muted) {
      const left = s.muteUntil === Infinity ? '手动' : fmt(s.muteUntil - now);
      return `会议模式 ${left}`;
    }
    if (s.frozen) return `已暂停 ${fmt(s.remainingMs)}`;
    if (s.awaiting === 'work-end') return '该休息啦';
    if (s.awaiting === 'break-end') return '休息结束啦';
    const label = s.phase === 'work' ? '工作' : s.phase === 'short' ? '短休' : s.phase === 'long' ? '长休' : '未开始';
    return `${label} ${fmt(s.remainingMs)}`;
  }

  function tooltipText(now) {
    const st = store.getStats();
    return `休息小助手\n${statusText(now)} · 今日休息 ${st.shortRests + st.longRests} 次`;
  }

  function showPopup() {
    const p = currentPrompt(Date.now());
    if (p) wm.showPopup();
  }

  function currentPrompt(now) {
    const s = engine.getState(now);
    if (s.muted) return null;
    if (s.phase === 'idle') return startPrompt ? 'start' : null;
    if (s.awaiting === 'work-end') return 'work-end';
    if (s.awaiting === 'break-end') return 'break-end';
    if (s.phase === 'short' || s.phase === 'long') return 'break';
    return null;
  }

  function onEngineEvent(type, payload) {
    const now = Date.now();
    switch (type) {
      case 'work-end':
        // replay = 「稍后」到期 / 会议模式解除积压的补弹。本轮的 +1 在首发时已经做过，
        // 补弹只负责再弹一次窗，不能再计一轮（否则点一次「稍后」今日工作轮多 1）。
        if (!payload.replay) {
          store.bump('workRounds', 1);
          if (payload.reason === 'skip') store.bump('skippedWorks', 1);
        }
        showPopup();
        break;
      case 'break-start':
        store.bump(payload.phase === 'long' ? 'longRests' : 'shortRests', 1);
        wm.hidePopup();
        showPopup();
        break;
      case 'skipped':
        store.bump('skippedRests', 1);
        wm.hidePopup();
        break;
      case 'break-end':
        showPopup();
        break;
      case 'snoozed':
        // 点「稍后 5 分钟」＝先关窗、5 分钟后再弹同一个窗（方案 §3.1「重复同一弹窗」）。
        // 不关的话弹窗原地不动零反馈，看起来就像按钮坏了（实测反馈的问题）。
        // 注意 awaiting 仍是 work-end，所以 currentPrompt() 仍是 'work-end'，关窗只能在这里做。
        wm.hidePopup();
        break;
      case 'muted':
        wm.hidePopup();
        break;
      case 'unmuted':
        showPopup();
        break;
      case 'started':
        startPrompt = false;
        break;
      default:
        break;
    }
    persist(now, true);
    broadcast(now);
    updateTray(now);
  }

  ipcMain.handle('cmd', (e, name, arg) => {
    const now = Date.now();
    const guard = (fn, force) => {
      try {
        fn();
        persist(now, !!force);
        broadcast(now);
        updateTray(now);
        return { ok: true };
      } catch (err) {
        return { error: err.message || String(err) };
      }
    };
    switch (name) {
      case 'start':
        return guard(() => engine.start(now));
      case 'toggleTimer':
        return guard(() => {
          const s = engine.getState(now);
          if (s.phase === 'idle') engine.start(now);
          else if (s.frozen) engine.resume(now);
          else engine.pause(now);
        });
      case 'beginBreak':
        return guard(() => engine.beginBreak(now));
      case 'skip':
        return guard(() => engine.skipRest(now));
      case 'skipWork':
        return guard(() => engine.skipWork(now));
      case 'snooze':
        return guard(() => engine.snooze((arg && arg.minutes) || 5, now));
      case 'endBreakEarly':
        return guard(() => engine.endBreakEarly(now));
      case 'jumpToBreak':
        return guard(() => engine.jumpToBreak(now));
      case 'beginWork':
        return guard(() => engine.beginWork(now));
      case 'extendBreak':
        return guard(() => engine.extendBreak((arg && arg.minutes) || 5, now));
      case 'mute':
        return guard(() => {
          const a = arg || {};
          if (a.mode === 'work') engine.setMuteForWork(now);
          else engine.setMute(a.minutes !== undefined ? a.minutes : null, now);
        });
      case 'unmute':
        return guard(() => engine.clearMute(now));
      case 'hidePopup':
        wm.hidePopup();
        return { ok: true };
      case 'openSettings':
        wm.openSettings();
        return { ok: true };
      case 'showPanel':
        wm.showPanel();
        return { ok: true };
      case 'hidePanel':
        wm.hideWindow('panel');
        return { ok: true };
      case 'closeSettings':
        wm.hideWindow('settings');
        return { ok: true };
      case 'saveConfig':
        return guard(() => {
          const cfg = store.updateConfig(arg || {});
          if (arg && arg.immediate) engine.applyConfigNow(cfg, now);
          else engine.configure(cfg);
          applyLoginItem(cfg);
        }, true);
      case 'getConfig':
        return store.getConfig();
      case 'getStats':
        return store.getStats();
      case 'quit':
        wm.setQuitting(true);
        app.exit(0);
        return { ok: true };
      default:
        return { error: `unknown command: ${name}` };
    }
  });

  function applyLoginItem(cfg) {
    try {
      // portable 版必须显式指定原始 exe 路径：它跑在 %TEMP% 的解压目录里，
      // 照默认注册的话 Windows 清理完 %TEMP% 开机自启就静默失效了。
      app.setLoginItemSettings(buildLoginItemOptions(cfg, process.env, process.execPath));
    } catch (e) {}
  }

  function buildTrayMenu(now) {
    const s = engine.getState(now);
    const started = s.phase !== 'idle';
    const items = [
      { label: statusText(now), enabled: false },
      { type: 'separator' },
      {
        label: !started ? '开始' : s.frozen ? '继续' : '暂停',
        click: () => ipcTick(() => {
          if (!started) engine.start(Date.now());
          else if (s.frozen) engine.resume(Date.now());
          else engine.pause(Date.now());
        }),
      },
      {
        label: '跳过工作轮',
        enabled: s.phase === 'work' && !s.awaiting,
        click: () => ipcTick(() => engine.skipWork(Date.now())),
      },
      {
        label: '去休息',
        enabled: s.awaiting === 'work-end',
        click: () => ipcTick(() => engine.beginBreak(Date.now())),
      },
      {
        label: '跳过休息',
        enabled: s.awaiting === 'work-end',
        click: () => ipcTick(() => engine.skipRest(Date.now())),
      },
      {
        label: '开始工作',
        enabled: s.awaiting === 'break-end',
        click: () => ipcTick(() => engine.beginWork(Date.now())),
      },
      {
        label: '会议模式',
        submenu: [
          { label: '到工作时间结束', click: () => ipcTick(() => engine.setMuteForWork(Date.now())) },
          { label: '15 分钟', click: () => ipcTick(() => engine.setMute(15, Date.now())) },
          { label: '30 分钟', click: () => ipcTick(() => engine.setMute(30, Date.now())) },
          { label: '60 分钟', click: () => ipcTick(() => engine.setMute(60, Date.now())) },
          { label: '直到手动恢复', click: () => ipcTick(() => engine.setMute(null, Date.now())) },
          { type: 'separator' },
          { label: '立即恢复', enabled: s.muted, click: () => ipcTick(() => engine.clearMute(Date.now())) },
        ],
      },
      { type: 'separator' },
      { label: '打开面板', click: () => wm.showPanel(trayAnchor()) },
      { label: '设置', click: () => wm.openSettings() },
      { label: '退出小程序', click: () => { wm.setQuitting(true); app.exit(0); } },
    ];
    return Menu.buildFromTemplate(items);
  }

  function ipcTick(fn) {
    fn();
    const now = Date.now();
    persist(now, false);
    broadcast(now);
    updateTray(now);
  }

  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip('休息小助手');
  const trayAnchor = () => (tray ? tray.getBounds() : null);
  tray.on('click', () => wm.togglePanel(trayAnchor()));
  tray.on('right-click', () => {
    if (process.platform === 'linux') {
      wm.showPanel(trayAnchor());
    } else {
      tray.popUpContextMenu(buildTrayMenu(Date.now()));
    }
  });

  const saved = store.getState();
  loadCats();
  if (saved && Pomodoro.isStaleSession(saved, engine.cfg, Date.now())) {
    engine.reset();
    store.clearState();
    console.log('[main] 上次会话已过期，丢弃并按新的一天开始');
  } else if (saved) {
    engine.restore(saved);
  }

  try {
    globalShortcut.register('CommandOrControl+Alt+R', () => wm.showPanel());
  } catch (e) {
    console.error('[main] global shortcut unavailable:', e.message);
  }

  setInterval(() => {
    const now = Date.now();
    engine.tick(now);
    maybeSwitchCat(engine.getState(now));
    const sig = signature();
    if (sig !== lastSig) {
      lastSig = sig;
      persist(now, true);
    } else {
      persist(now, false);
    }
    broadcast(now);
    updateTray(now);
  }, 1000);

  setTimeout(() => {
    const now = Date.now();
    const s = engine.getState(now);
    if (s.phase === 'idle') startPrompt = true;
    if (currentPrompt(now)) {
      wm.showPopup();
    } else {
      wm.showPanel();
    }
    broadcast(now);
    updateTray(now);
  }, 400);

  app.on('second-instance', () => {
    wm.showPanel();
  });

  applyLoginItem(store.getConfig());
}
