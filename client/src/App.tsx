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

  const fetchState = async () => {
    try {
      const state = await window.electronAPI?.getBackendState?.();
      const peers = state?.peers ?? [];
      setDevices(peers);
      setIsConnected(true);
    } catch {
      setIsConnected(false);
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
    void window.electronAPI?.saveSettings(settings);
  }, [settings]);

  const handleInitiateTransfer = async (device: Device, files: FileItem[]) => {
    if (!files.length) return;
    const totalSize = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    const record: TransferRecord = {
      id: String(Date.now()),
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
      const completed = { ...record, bytesTransferred: totalSize, state: "completed" as const };
      setActiveTransfer(undefined);
      setTransferHistory((prev) => [completed, ...prev]);
    } catch {
      const failed = { ...record, state: "failed" as const };
      setActiveTransfer(undefined);
      setTransferHistory((prev) => [failed, ...prev]);
    }
  };

  return (
    <div className="app-layout">
      <TitleBar isConnected={isConnected} />
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
