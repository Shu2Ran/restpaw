'use strict';

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const UI = (f) => path.join(__dirname, 'ui', f);

function createWindowManager(ctx) {
  const wins = {};
  let quitting = false;

  function create(name, size, file) {
    const existing = wins[name];
    if (existing && !existing.isDestroyed()) return existing;
    const win = new BrowserWindow({
      width: size.w,
      height: size.h,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: ctx.preload,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadFile(UI(file));
    win.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        win.hide();
      }
    });
    win.on('closed', () => {
      if (wins[name] === win) delete wins[name];
    });
    wins[name] = win;
    return win;
  }

  function placeCenter(win) {
    const wa = screen.getPrimaryDisplay().workArea;
    const b = win.getBounds();
    win.setPosition(Math.round(wa.x + (wa.width - b.width) / 2), Math.round(wa.y + (wa.height - b.height) / 2));
  }

  function get(name) {
    const w = wins[name];
    return w && !w.isDestroyed() ? w : null;
  }

  return {
    get(name) {
      return get(name);
    },

    showPopup() {
      const w = create('popup', { w: 380, h: 352 }, 'popup.html');
      placeCenter(w);
      w.show();
      w.focus();
    },

    hidePopup() {
      const w = get('popup');
      if (w) w.hide();
    },

    hideWindow(name) {
      const w = get(name);
      if (w) w.hide();
    },

    isPopupVisible() {
      const w = get('popup');
      return !!w && w.isVisible();
    },

    togglePanel(anchor) {
      const w = get('panel');
      if (w && w.isVisible()) {
        w.hide();
      } else {
        this.showPanel(anchor);
      }
    },

    showPanel(anchor) {
      const size = { w: 340, h: 556 };
      const w = create('panel', size, 'panel.html');
      const usable = anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y) && anchor.width > 4 && anchor.height > 4;
      if (usable) {
        const wa = screen.getDisplayMatching(anchor).workArea;
        const x = anchor.x + anchor.width / 2 - size.w / 2;
        const y = anchor.y - size.h - 8;
        w.setPosition(
          Math.round(Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - size.w - 8))),
          Math.round(Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - size.h - 8)))
        );
      } else {
        placeCenter(w);
      }
      w.show();
    },

    openSettings() {
      const w = create('settings', { w: 372, h: 560 }, 'settings.html');
      placeCenter(w);
      w.show();
      w.focus();
    },

    broadcast(channel, payload) {
      for (const name of Object.keys(wins)) {
        const w = wins[name];
        if (w && !w.isDestroyed() && w.webContents) {
          w.webContents.send(channel, payload);
        }
      }
    },

    visibility() {
      const out = {};
      for (const name of ['popup', 'panel', 'settings']) {
        const w = wins[name];
        out[name] = !!w && !w.isDestroyed() && w.isVisible();
      }
      return out;
    },

    hideAll() {
      for (const name of Object.keys(wins)) {
        const w = wins[name];
        if (w && !w.isDestroyed()) w.hide();
      }
    },

    setQuitting(v) {
      quitting = v;
    },
  };
}

module.exports = createWindowManager;
