import React, { useEffect, useState } from "react";
import { TitleBar } from "./components/TitleBar/TitleBar.js";
import { Navigation, ViewTab } from "./components/Navigation/Navigation.js";
import { BackendStatusBanner } from "./components/BackendStatusBanner/BackendStatusBanner.js";
import { Home } from "./pages/Home.js";
import { Transfers } from "./pages/Transfers.js";
import { SettingsPage } from "./pages/Settings.js";
import {
  AppSettings,
  BackendStatus,
  Device,
  FileItem,
  TransferRecord,
} from "./shared/types.js";

type AppNotice = {
  id: string;
  title: string;
  details: string;
  code?: string;
  createdAt: number;
};

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ViewTab>("devices");
  const [devices, setDevices] = useState<Device[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(
    null,
  );
  const [isRestartingBackend, setIsRestartingBackend] = useState(false);
  const [discoveryStatus, setDiscoveryStatus] = useState<
    "discovering" | "found" | "empty"
  >("discovering");
  const [activeTransfer, setActiveTransfer] = useState<TransferRecord>();
  const [transferHistory, setTransferHistory] = useState<TransferRecord[]>([]);
  const [notices, setNotices] = useState<AppNotice[]>([]);
  const [expandedNoticeId, setExpandedNoticeId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    deviceName: "LANShare Desktop",
    autoStart: false,
    showNotifications: true,
    downloadFolder: "",
    askBeforeAccepting: true,
    autoAcceptTrusted: false,
    currentNetwork: "Unknown",
    theme: "dark",
    clipboardSync: false,
  });

  const upsertTransferRecord = (record: TransferRecord) => {
    setTransferHistory((prev) => {
      const next = prev.filter((item) => item.id !== record.id);
      return [record, ...next];
    });
  };

  const safeText = (value: string) =>
    value
      .replace(/https?:\/\/[^\s]+/g, "[redacted-url]")
      .replace(/[A-Za-z]:\\[^\s]+/g, "[redacted-path]")
      .replace(/\/(?:[^/\s]+\/)*[^/\s]+/g, "[redacted-path]")
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[redacted-ip]");

  const pushNotice = (notice: Omit<AppNotice, "id" | "createdAt">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setNotices((prev) =>
      [{ id, createdAt: Date.now(), ...notice }, ...prev].slice(0, 3),
    );
    window.setTimeout(() => {
      setNotices((prev) => prev.filter((item) => item.id !== id));
    }, 10000);
  };

  const parseErrorBody = async (response?: { body?: string }) => {
    if (!response?.body)
      return {
        code: undefined as string | undefined,
        message: "Something went wrong",
      };
    try {
      const parsed = JSON.parse(response.body) as {
        code?: string;
        message?: string;
      };
      return {
        code: typeof parsed.code === "string" ? parsed.code : undefined,
        message:
          typeof parsed.message === "string"
            ? parsed.message
            : "Something went wrong",
      };
    } catch {
      return {
        code: undefined,
        message: safeText(response.body || "Something went wrong"),
      };
    }
  };

  const recordFromTransferEvent = (payload: any): TransferRecord | null => {
    if (!payload?.id) return null;
    const files = Array.isArray(payload.files)
      ? payload.files.map((file: any) => ({
          name:
            file.name ??
            (typeof file.relativePath === "string"
              ? (file.relativePath.split(/[\\/]/).pop() ?? "File")
              : "File"),
          path: file.path ?? "",
          sizeBytes: Number(file.size ?? file.sizeBytes ?? 0),
          isDirectory: Boolean(file.isDir ?? file.isDirectory),
        }))
      : [];
    const totalSize = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    const totalSizeBytes = Number(payload.totalSizeBytes ?? totalSize);
    const bytesTransferred = Number(
      payload.bytesTransferred ??
        (payload.state === "completed" ? totalSizeBytes : 0),
    );
    return {
      id: String(payload.id),
      direction: payload.direction === "incoming" ? "incoming" : "outgoing",
      deviceName: payload.deviceName ?? payload.peerName ?? "Nearby device",
      files,
      totalSizeBytes,
      bytesTransferred,
      speedBytesPerSec: Number(payload.speedBytesPerSec ?? 0),
      state: payload.state ?? "pending",
      timestamp: new Date(),
      errorMessage: payload.errorMessage,
    };
  };

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshDevices = async () => {
    setIsRefreshing(true);
    setDiscoveryStatus("discovering");
    await fetchState();
    setTimeout(() => {
      setIsRefreshing(false);
    }, 700);
  };

  const fetchState = async () => {
    try {
      const status = await window.electronAPI?.getBackendStatus?.();
      if (status) {
        setBackendStatus(status);
      }
      const state = await window.electronAPI?.getBackendState?.();
      const peers = state?.peers ?? [];
      setDevices(peers);
      setIsConnected(true);
      setDiscoveryStatus(peers.length > 0 ? "found" : "empty");
    } catch {
      setIsConnected(false);
      setDiscoveryStatus("discovering");
      const status = await window.electronAPI?.getBackendStatus?.();
      if (status) setBackendStatus(status);
    }
  };

  const handleRestartBackend = async () => {
    setIsRestartingBackend(true);
    try {
      const status = await window.electronAPI?.restartBackend?.();
      if (status) {
        setBackendStatus(status);
      }
      await fetchState();
    } catch (err: any) {
      pushNotice({
        title: "Restart Failed",
        details: err?.message || "Failed to restart backend engine.",
      });
    } finally {
      setIsRestartingBackend(false);
    }
  };

  useEffect(() => {
    void fetchState();
    const timer = window.setInterval(fetchState, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.electronAPI?.getSettings().then((saved) => {
      if (saved) setSettings((prev) => ({ ...prev, ...saved }));
    });
  }, []);

  // --- FIXED EVENT LISTENER ---
  useEffect(() => {
    let source: EventSource | undefined;
    let cancelled = false;

    const connectEvents = async () => {
      const backendUrl = await window.electronAPI?.getBackendUrl?.();
      if (cancelled || !backendUrl) return;
      source = new EventSource(`${backendUrl}/api/events`);

      source.addEventListener("peer", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const newDevice = payload?.data;
          if (!newDevice) return;

          // Use case‑insensitive name comparison (matches backend dedup)
          const lowerName = newDevice.name.toLowerCase();

          setDevices((prev) => {
            // Find existing device by lowercased name
            const existingIndex = prev.findIndex(
              (d) => d.name.toLowerCase() === lowerName,
            );

            if (existingIndex >= 0) {
              // Update in place – preserves order and avoids flicker
              const updated = [...prev];
              updated[existingIndex] = newDevice;
              return updated;
            } else {
              // New device – add to the beginning
              return [newDevice, ...prev];
            }
          });

          setDiscoveryStatus("found");
        } catch {
          // ignore parse errors
        }
      });

      source.addEventListener("transfer", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const record = recordFromTransferEvent(payload?.data);
          if (!record) return;
          upsertTransferRecord(record);
          if (record.state === "transferring") {
            setActiveTransfer(record);
          } else if (
            record.state === "completed" ||
            record.state === "failed" ||
            record.state === "cancelled"
          ) {
            setActiveTransfer((current) =>
              current?.id === record.id ? undefined : current,
            );
          }
        } catch {
          void 0;
        }
      });
    };

    void connectEvents();
    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);
  // --- END OF FIX ---

  useEffect(() => {
    void window.electronAPI?.saveSettings(settings);
  }, [settings]);

  const handleInitiateTransfer = async (device: Device, files: FileItem[]) => {
    if (!files.length) return;
    const totalSize = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    const transferId = String(Date.now());
    const record: TransferRecord = {
      id: transferId,
      direction: "outgoing",
      deviceName: device.name,
      files,
      totalSizeBytes: totalSize,
      bytesTransferred: 0,
      speedBytesPerSec: 0,
      state: "transferring",
      timestamp: new Date(),
    };
    setActiveTransfer(record);
    try {
      const response = await window.electronAPI?.fetchBackend?.(
        "/api/transfer",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transferId,
            peerId: device.id,
            files: files.map((file) => ({
              path: file.path,
              name: file.name,
              size: file.sizeBytes,
              isDir: file.isDirectory,
            })),
          }),
        },
      );
      if (!response?.ok) {
        const parsed = await parseErrorBody(response);
        pushNotice({
          title: parsed.code
            ? `Something went wrong (${parsed.code})`
            : "Something went wrong",
          code: parsed.code,
          details: parsed.message,
        });
        const failed = {
          ...record,
          state: "failed" as const,
          errorMessage: parsed.message,
        };
        setActiveTransfer(undefined);
        upsertTransferRecord(failed);
        return;
      }
    } catch (error) {
      const failed = { ...record, state: "failed" as const };
      setActiveTransfer(undefined);
      upsertTransferRecord(failed);
      const details =
        error instanceof Error ? safeText(error.message) : "Unknown error";
      pushNotice({
        title: "Something went wrong",
        details,
      });
    }
  };

  return (
    <div className="app-layout">
      <TitleBar isConnected={isConnected} discoveryStatus={discoveryStatus} />
      <div className="content-container">
        <Navigation
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          activeTransfersCount={activeTransfer ? 1 : 0}
        />
        <main className="main-viewport">
          {activeTab === "devices" && (
            <Home
              devices={devices}
              onRefreshDevices={handleRefreshDevices}
              isRefreshing={isRefreshing}
              activeTransfer={activeTransfer}
              onInitiateTransfer={handleInitiateTransfer}
              onCancelTransfer={() => setActiveTransfer(undefined)}
              discoveryStatus={discoveryStatus}
              isConnected={isConnected}
            />
          )}
          {activeTab === "transfers" && (
            <Transfers
              records={transferHistory}
              onClearHistory={() => setTransferHistory([])}
            />
          )}
          {activeTab === "settings" && (
            <SettingsPage
              settings={settings}
              onUpdateSettings={(updates) =>
                setSettings((prev) => ({ ...prev, ...updates }))
              }
            />
          )}
        </main>
      </div>
      <div
        className="notice-stack"
        aria-live="polite"
        aria-relevant="additions"
      >
        {notices.map((notice) => (
          <button
            key={notice.id}
            type="button"
            className="notice-card"
            onClick={() => {
              setExpandedNoticeId((current) =>
                current === notice.id ? null : notice.id,
              );
            }}
            title="Click to expand or collapse"
          >
            <div className="notice-title">{notice.title}</div>
            <div className="notice-details">
              {expandedNoticeId === notice.id
                ? notice.details
                : notice.code
                  ? `Error code: ${notice.code}`
                  : "Click to view details"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default App;
