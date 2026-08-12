import { contextBridge, ipcRenderer } from "electron";

type AppSettings = {
  deviceName: string;
  autoStart: boolean;
  showNotifications: boolean;
  downloadFolder: string;
  askBeforeAccepting: boolean;
  autoAcceptTrusted: boolean;
  currentNetwork: string;
  theme: "system" | "light" | "dark";
};

contextBridge.exposeInMainWorld("electronAPI", {
  selectFiles: () => ipcRenderer.invoke("files:select"),
  selectFolder: () => ipcRenderer.invoke("folder:select"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke("settings:save", settings),
  getBackendUrl: () => ipcRenderer.invoke("backend:get-url"),
  getBackendState: () => ipcRenderer.invoke("backend:state"),
  fetchBackend: (path: string, init?: RequestInit) =>
    ipcRenderer.invoke("backend:fetch", path, init),
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  maximizeWindow: () => ipcRenderer.send("window:maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
});
