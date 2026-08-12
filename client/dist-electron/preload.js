import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electronAPI", {
    selectFiles: () => ipcRenderer.invoke("files:select"),
    selectFolder: () => ipcRenderer.invoke("folder:select"),
    getSettings: () => ipcRenderer.invoke("settings:get"),
    saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
    getBackendUrl: () => ipcRenderer.invoke("backend:get-url"),
    getBackendState: () => ipcRenderer.invoke("backend:state"),
    fetchBackend: (path, init) => ipcRenderer.invoke("backend:fetch", path, init),
    minimizeWindow: () => ipcRenderer.send("window:minimize"),
    maximizeWindow: () => ipcRenderer.send("window:maximize"),
    closeWindow: () => ipcRenderer.send("window:close"),
});
