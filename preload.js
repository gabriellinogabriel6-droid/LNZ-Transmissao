const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lnzDesktop', {
  listSources: () => ipcRenderer.invoke('sources:list'),
  selectSource: (sourceId) => ipcRenderer.invoke('sources:select', sourceId),
  nativeStatus: () => ipcRenderer.invoke('native:status'),
  startAudio: (sourceId) => ipcRenderer.invoke('audio:start', sourceId),
  stopAudio: () => ipcRenderer.invoke('audio:stop'),
  onAudioChunk: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('audio:chunk', listener);
    return () => ipcRenderer.removeListener('audio:chunk', listener);
  }
});
