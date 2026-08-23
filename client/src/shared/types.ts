export type DeviceStatus = "available" | "connecting" | "busy" | "offline";
export type DeviceType = "pc" | "mac" | "phone";
export type OSName =
  | "Windows 11"
  | "Windows 10"
  | "macOS"
  | "iOS"
  | "Android"
  | "Linux";

export interface Device {
  id: string;
  name: string;
  os: OSName;
  type: DeviceType;
  status: DeviceStatus;
  ip: string;
  isTrusted?: boolean;
}

export interface FileItem {
  name: string;
  path: string;
  sizeBytes: number;
  isDirectory: boolean;
}

export type TransferState =
  | "pending"
  | "connecting"
  | "transferring"
  | "completed"
  | "failed"
  | "cancelled";
export type TransferDirection = "incoming" | "outgoing";

export interface TransferRecord {
  id: string;
  direction: TransferDirection;
  deviceName: string;
  files: FileItem[];
  totalSizeBytes: number;
  bytesTransferred: number;
  speedBytesPerSec: number;
  state: TransferState;
  timestamp: Date;
  errorMessage?: string;
}

export interface AppSettings {
  deviceName: string;
  autoStart: boolean;
  showNotifications: boolean;
  downloadFolder: string;
  askBeforeAccepting: boolean;
  autoAcceptTrusted: boolean;
  currentNetwork: string;
  theme: "dark";
  clipboardSync?: boolean;
}

export interface NetworkDiagnostics {
  hasActiveLan: boolean;
  interfaces: string[];
  udpDiscoveryBound: boolean;
  udpPort: number;
  warnings: string[];
}

export type BackendState = "starting" | "running" | "error" | "stopped";

export interface BackendStatus {
  state: BackendState;
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
  diagnostics?: NetworkDiagnostics;
}

declare global {
  interface Window {
    electronAPI?: {
      selectFiles: () => Promise<FileItem[] | null>;
      selectFolder: () => Promise<FileItem | null>;
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: Partial<AppSettings>) => Promise<boolean>;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      getBackendUrl?: () => Promise<string>;
      getBackendStatus?: () => Promise<BackendStatus>;
      restartBackend?: () => Promise<BackendStatus>;
      getBackendState?: () => Promise<any>;
      fetchBackend?: (path: string, init?: RequestInit) => Promise<any>;
      transferRespond?: (transferId: string, accept: boolean) => Promise<any>;
      openFolder?: (path: string) => Promise<void>;
    };
  }
}
