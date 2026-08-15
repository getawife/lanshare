import React, { useEffect, useState } from "react";
import { TitleBar } from "./components/TitleBar/TitleBar.js";
import { Navigation, ViewTab } from "./components/Navigation/Navigation.js";
import { Home } from "./pages/Home.js";
import { Transfers } from "./pages/Transfers.js";
import { SettingsPage } from "./pages/Settings.js";
import { AppSettings, Device, FileItem, TransferRecord } from "./shared/types.js";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ViewTab>("devices");
  const [devices, setDevices] = useState<Device[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [discoveryStatus, setDiscoveryStatus] = useState<"discovering" | "found" | "empty">("discovering");
  const [activeTransfer, setActiveTransfer] = useState<TransferRecord>();
  const [transferHistory, setTransferHistory] = useState<TransferRecord[]>([]);
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

  const recordFromTransferEvent = (payload: any): TransferRecord | null => {
    if (!payload?.id) return null;
    const files = Array.isArray(payload.files)
      ? payload.files.map((file: any) => ({
          name: file.name ?? "File",
          path: file.path ?? "",
          sizeBytes: Number(file.size ?? file.sizeBytes ?? 0),
          isDirectory: Boolean(file.isDir ?? file.isDirectory),
        }))
      : [];
    const totalSize = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    return {
      id: String(payload.id),
      direction: payload.direction === "incoming" ? "incoming" : "outgoing",
      deviceName: payload.deviceName ?? payload.peerName ?? "Nearby device",
      files,
      totalSizeBytes: totalSize,
      bytesTransferred: payload.state === "completed" ? totalSize : 0,
      speedBytesPerSec: 0,
      state: payload.state ?? "pending",
      timestamp: new Date(),
      errorMessage: payload.errorMessage,
    };
  };

  const fetchState = async () => {
    try {
      const state = await window.electronAPI?.getBackendState?.();
      const peers = state?.peers ?? [];
      setDevices(peers);
      setIsConnected(true);
      setDiscoveryStatus(peers.length > 0 ? "found" : "empty");
    } catch {
      setIsConnected(false);
      setDiscoveryStatus("discovering");
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
          setDevices((prev) => {
            const next = prev.filter((device) => device.id !== payload?.data?.id);
            return payload?.data ? [payload.data, ...next] : next;
          });
          setDiscoveryStatus("found");
        } catch {
          void 0;
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
          } else if (record.state === "completed" || record.state === "failed" || record.state === "cancelled") {
            setActiveTransfer((current) => (current?.id === record.id ? undefined : current));
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
      const response = await window.electronAPI?.fetchBackend?.("/api/transfer", {
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
      });
      if (!response?.ok) throw new Error(response?.body ?? "transfer failed");
    } catch {
      const failed = { ...record, state: "failed" as const };
      setActiveTransfer(undefined);
      upsertTransferRecord(failed);
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
              onRefreshDevices={fetchState}
              activeTransfer={activeTransfer}
              onInitiateTransfer={handleInitiateTransfer}
              onCancelTransfer={() => setActiveTransfer(undefined)}
              discoveryStatus={discoveryStatus}
              isConnected={isConnected}
            />
          )}
          {activeTab === "transfers" && (
            <Transfers records={transferHistory} onClearHistory={() => setTransferHistory([])} />
          )}
          {activeTab === "settings" && (
            <SettingsPage
              settings={settings}
              onUpdateSettings={(updates) => setSettings((prev) => ({ ...prev, ...updates }))}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
