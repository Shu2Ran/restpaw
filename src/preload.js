'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (name, arg) => ipcRenderer.invoke('cmd', name, arg),
  onState: (cb) => {
    ipcRenderer.on('state', (_e, payload) => cb(payload));
  },
});
