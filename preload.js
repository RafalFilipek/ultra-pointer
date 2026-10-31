const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ultraPointer', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
});
