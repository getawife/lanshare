export type device_status = "available" | "connecting" | "busy" | "offline";
export type device_type = "pc" | "mac" | "phone";
export type os_name =
  | "Windows 11"
  | "Windows 10"
  | "macOS"
  | "iOS"
  | "Android"
  | "Linux";

export interface device {
  id: string;
  name: string;
  os: os_name;
  type_: device_type;
  status: device_status;
  ip: string;
  is_trusted?: boolean;
}

export interface file_item {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
}

export type transfer_state =
  | "pending"
  | "connecting"
  | "transferring"
  | "completed"
  | "failed"
  | "cancelled";

export type transfer_direction = "incoming" | "outgoing";

export interface transfer_record {
  id: string;
  direction: transfer_direction;
  device_name: string;
  files: file_item[];
  total_size_bytes: number;
  bytes_transferred: number;
  speed_bytes_per_sec: number;
  state: transfer_state;
  timestamp: Date;
  error_message?: string;
}

export interface app_settings {
  deviceName: string;
  autoStart: boolean;
  showNotifications: boolean;
  downloadFolder: string;
  askBeforeAccepting: boolean;
  autoAcceptTrusted: boolean;
  currentNetwork: string;
  theme: "dark";
}

export interface network_diagnostics {
  hasActiveLan: boolean;
  interfaces: string[];
  udpDiscoveryBound: boolean;
  udpPort: number;
  warnings: string[];
}

export type backend_state = "starting" | "running" | "error" | "stopped";

export interface backend_status {
  state: backend_state;
  url: string;
  code?:
    | "PORT_IN_USE"
    | "BLOCKED_BY_FIREWALL"
    | "BINARY_NOT_FOUND"
    | "HEALTHCHECK_TIMEOUT"
    | "BACKEND_CRASH"
    | "UNKNOWN";
  error?: string;
  errorDetails?: string;
  networkWarnings?: string[];
  diagnostics?: network_diagnostics;
}

declare global {
  interface File {
    path: string;
  }

  interface Window {
    electronAPI?: {
      selectFiles: () => Promise<file_item[] | null>;
      selectFolder: () => Promise<file_item | null>;
      getSettings: () => Promise<app_settings>;
      saveSettings: (settings: Partial<app_settings>) => Promise<boolean>;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      getBackendUrl?: () => Promise<string>;
      getBackendStatus?: () => Promise<backend_status>;
      restartBackend?: () => Promise<backend_status>;
      getBackendState?: () => Promise<any>;
      fetchBackend?: (path: string, init?: RequestInit) => Promise<any>;
      transferRespond?: (transfer_id: string, accept: boolean) => Promise<any>;
      openFolder?: (path: string) => Promise<void>;
      notify?: (title: string, body: string) => Promise<boolean>;
      listTrusted?: () => Promise<{
        ok: boolean;
        status: number;
        body: string;
      }>;
      setTrusted?: (
        peer_id: string,
        trusted: boolean,
      ) => Promise<{
        ok: boolean;
        status: number;
        body: string;
      }>;

      updates: {
        onChecking: (callback: () => void) => () => void;

        onAvailable: (
          callback: (info: { version: string }) => void,
        ) => () => void;

        onNotAvailable: (callback: () => void) => () => void;

        onProgress: (
          callback: (progress: {
            percent: number;
            bytesPerSecond: number;
            transferred: number;
            total: number;
          }) => void,
        ) => () => void;

        onDownloaded: (
          callback: (info: { version: string }) => void,
        ) => () => void;

        onError: (
          callback: (error: { message?: string }) => void,
        ) => () => void;

        install: () => void;
      };
    };
  }
}
