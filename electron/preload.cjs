const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tapestryDesktopBackups', {
  getConfig: () => ipcRenderer.invoke('tapestry-backup:get-config'),
  chooseDirectory: () => ipcRenderer.invoke('tapestry-backup:choose-directory'),
  setEnabled: (enabled) => ipcRenderer.invoke('tapestry-backup:set-enabled', enabled === true),
  write: (payload) => ipcRenderer.invoke('tapestry-backup:write', payload),
  restore: () => ipcRenderer.invoke('tapestry-backup:restore'),
});
