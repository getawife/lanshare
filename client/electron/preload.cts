import { contextBridge, ipcRenderer } from "electron";

type app_settings = {
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

  saveSettings: (settings: Partial<app_settings>) =>
    ipcRenderer.invoke("settings:save", settings),

  getBackendUrl: () => ipcRenderer.invoke("backend:get-url"),

  getBackendStatus: () => ipcRenderer.invoke("backend:status"),

  restartBackend: () => ipcRenderer.invoke("backend:restart"),

  getBackendState: () => ipcRenderer.invoke("backend:state"),

  fetchBackend: (path: string, init?: RequestInit) =>
    ipcRenderer.invoke("backend:fetch", path, init),

  transferRespond: (transfer_id: string, accept: boolean) =>
    ipcRenderer.invoke("transfer:respond", transfer_id, accept),

  openFolder: (path?: string) => ipcRenderer.invoke("folder:open", path),

  notify: (title: string, body: string) =>
    ipcRenderer.invoke("notify", title, body),

  listTrusted: () => ipcRenderer.invoke("trust:list"),

  setTrusted: (peer_id: string, trusted: boolean) =>
    ipcRenderer.invoke("trust:set", peer_id, trusted),

  minimizeWindow: () => {
    ipcRenderer.send("window:minimize");
  },

  maximizeWindow: () => {
    ipcRenderer.send("window:maximize");
  },

  closeWindow: () => {
    ipcRenderer.send("window:close");
  },

  updates: {
    onChecking: (callback: () => void) => {
      const listener = () => callback();

      ipcRenderer.on("update:checking", listener);

      return () => {
        ipcRenderer.removeListener("update:checking", listener);
      };
    },

    onAvailable: (callback: (info: { version: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        info: { version: string },
      ) => callback(info);

      ipcRenderer.on("update:available", listener);

      return () => {
        ipcRenderer.removeListener("update:available", listener);
      };
    },

    onNotAvailable: (callback: () => void) => {
      const listener = () => callback();

      ipcRenderer.on("update:not-available", listener);

      return () => {
        ipcRenderer.removeListener("update:not-available", listener);
      };
    },

    onProgress: (
      callback: (progress: {
        percent: number;
        bytesPerSecond: number;
        transferred: number;
        total: number;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: {
          percent: number;
          bytesPerSecond: number;
          transferred: number;
          total: number;
        },
      ) => callback(progress);

      ipcRenderer.on("update:progress", listener);

      return () => {
        ipcRenderer.removeListener("update:progress", listener);
      };
    },

    onDownloaded: (callback: (info: { version: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        info: { version: string },
      ) => callback(info);

      ipcRenderer.on("update:downloaded", listener);

      return () => {
        ipcRenderer.removeListener("update:downloaded", listener);
      };
    },

    onError: (callback: (error: { message?: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        error: { message?: string },
      ) => callback(error);

      ipcRenderer.on("update:error", listener);

      return () => {
        ipcRenderer.removeListener("update:error", listener);
      };
    },

    install: () => {
      ipcRenderer.send("update:install");
    },
  },
});
