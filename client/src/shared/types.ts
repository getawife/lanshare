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
  theme: "system" | "light" | "dark";
  clipboardSync?: boolean;
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
      getBackendState?: () => Promise<any>;
      fetchBackend?: (path: string, init?: RequestInit) => Promise<any>;
      openFolder?: (path: string) => Promise<void>;
    };
}
}
