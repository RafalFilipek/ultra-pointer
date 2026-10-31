const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ultraPointer', {
  // overlay
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  // settings window
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  suspendShortcut: () => ipcRenderer.invoke('shortcut:suspend'),
  resumeShortcut: () => ipcRenderer.invoke('shortcut:resume'),
  preview: () => ipcRenderer.invoke('preview'),
});
