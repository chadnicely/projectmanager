const { contextBridge, ipcRenderer } = require('electron');

// Minimal bridge so the sticky page can hide itself. Nothing else is exposed.
contextBridge.exposeInMainWorld('baseSticky', {
  hide: () => ipcRenderer.send('sticky:hide')
});
