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
  clipboardSync: boolean;
};

contextBridge.exposeInMainWorld("electronAPI", {
  selectFiles: () => ipcRenderer.invoke("files:select"),

  selectFolder: () => ipcRenderer.invoke("folder:select"),

  getSettings: () => ipcRenderer.invoke("settings:get"),

  saveSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke("settings:save", settings),

  getBackendUrl: () => ipcRenderer.invoke("backend:get-url"),

  getBackendStatus: () => ipcRenderer.invoke("backend:status"),

  restartBackend: () => ipcRenderer.invoke("backend:restart"),

  getBackendState: () => ipcRenderer.invoke("backend:state"),

  fetchBackend: (path: string, init?: RequestInit) =>
    ipcRenderer.invoke("backend:fetch", path, init),
  transferRespond: (transferId: string, accept: boolean) =>
    ipcRenderer.invoke("transfer:respond", transferId, accept),

  openFolder: (path?: string) => ipcRenderer.invoke("folder:open", path),

  minimizeWindow: () => {
    ipcRenderer.send("window:minimize");
  },

  maximizeWindow: () => {
    ipcRenderer.send("window:maximize");
  },

  closeWindow: () => {
    ipcRenderer.send("window:close");
  },
});
