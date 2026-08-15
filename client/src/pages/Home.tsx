import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  CircleDashed,
  RefreshCw,
  MonitorX,
  ChevronDown,
} from "lucide-react";
import { Device, FileItem, TransferRecord } from "../shared/types";
import { DeviceCard } from "../components/DeviceCard/DeviceCard";
import { DropZone } from "../components/DropZone/DropZone";
import { SendConfirmation } from "../components/SendConfirmation/SendConfirmation";
import { TransferProgress } from "../components/TransferProgress/TransferProgress";
import { IncomingTransfer } from "../components/IncomingTransfer/IncomingTransfer";
import styles from "./Home.module.css";

interface HomeProps {
  devices: Device[];
  onRefreshDevices: () => void;
  isRefreshing?: boolean;
  activeTransfer?: TransferRecord;
  onInitiateTransfer: (device: Device, files: FileItem[]) => void;
  onCancelTransfer: () => void;
  discoveryStatus: "discovering" | "found" | "empty";
  isConnected: boolean;
  networkWarnings?: string[];
}

export const Home: React.FC<HomeProps> = ({
  devices,
  onRefreshDevices,
  isRefreshing = false,
  activeTransfer,
  onInitiateTransfer,
  onCancelTransfer,
  discoveryStatus,
  isConnected,
  networkWarnings = [],
}) => {
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [stagedFiles, setStagedFiles] = useState<FileItem[] | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);

  const isSending = Boolean(activeTransfer);
  const hasDevices = devices.length > 0;
  const hasRecipient = Boolean(selectedDevice);
  const dropZoneEnabled = hasRecipient && !isSending;

  const headerLabel = useMemo(() => {
    if (isSending) return "Transfer in progress";
    if (!hasDevices) return discoveryStatus === "discovering" ? "Scanning for devices…" : "No nearby devices";
    if (hasRecipient) return `Send to ${selectedDevice?.name}`;
    return "Choose a device to continue";
  }, [discoveryStatus, hasDevices, hasRecipient, isSending, selectedDevice?.name]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!hasRecipient) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files: FileItem[] = Array.from(e.dataTransfer.files).map((f) => ({
        name: f.name,
        path: f.path,
        sizeBytes: f.size,
        isDirectory: false,
      }));
      setStagedFiles(files);
    }
  };

  const handleSelectFiles = async () => {
    if (!hasRecipient) return;
    const files = await window.electronAPI?.selectFiles();
    if (files) setStagedFiles(files);
  };

  const handleSelectFolder = async () => {
    if (!hasRecipient) return;
    const folder = await window.electronAPI?.selectFolder();
    if (folder) setStagedFiles([folder]);
  };

  return (
    <div
      className={styles.container}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>{headerLabel}</h1>
          <div className={styles.subtitle}>
            {isSending
              ? "The recipient stays visible while the transfer completes."
              : hasDevices
                ? hasRecipient
                  ? "Files and folders can be added now."
                  : `${devices.length} device${devices.length === 1 ? "" : "s"} discovered on the network.`
                : discoveryStatus === "discovering"
                  ? "Checking the local network for nearby Lanshare devices."
                  : "Open Lanshare on the other device and keep both devices on the same network."}
          </div>
        </div>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={onRefreshDevices}
          disabled={isRefreshing}
          title="Scan again"
          aria-label="Scan again"
        >
          <RefreshCw size={14} className={isRefreshing ? styles.spinning : ""} />
        </button>
      </div>

      {discoveryStatus === "discovering" && !hasDevices && (
        <div className={styles.discoveryBar} aria-live="polite">
          <CircleDashed size={14} className={styles.spinning} />
          <span>Scanning for devices…</span>
        </div>
      )}

      {!hasDevices ? (
        <section className={styles.emptyState} aria-label="No nearby devices">
          <MonitorX size={28} className={styles.emptyIcon} />
          <div className={styles.emptyTitle}>No nearby devices</div>
          <div className={styles.emptyText}>
            Make sure Lanshare is open on the other device and both devices are connected to the same network.
          </div>
          <div className={styles.emptyActions}>
            <button
              className={styles.scanBtn}
              onClick={onRefreshDevices}
              disabled={isRefreshing}
            >
              <RefreshCw size={14} className={isRefreshing ? styles.spinning : ""} />
              <span>{isRefreshing ? "Scanning…" : "Scan Again"}</span>
            </button>
            <button
              className={styles.troubleshootBtn}
              onClick={() => setShowTroubleshooting((value) => !value)}
              aria-expanded={showTroubleshooting}
            >
              Having trouble?
              <ChevronDown size={14} className={showTroubleshooting ? styles.chevronOpen : styles.chevron} />
            </button>
          </div>
          {showTroubleshooting && (
            <div className={styles.troubleshooting} aria-label="Troubleshooting tips">
              {networkWarnings.length > 0 && (
                <div style={{ color: "#fbbf24", fontWeight: 600, marginBottom: "4px" }}>
                  Active Network Issues:
                  {networkWarnings.map((w, i) => (
                    <div key={i} style={{ fontWeight: 400, marginTop: "2px", color: "#fde68a" }}>• {w}</div>
                  ))}
                </div>
              )}
              <div>Confirm both devices are on the same LAN</div>
              <div>Check firewall permissions (allow LANShare on Private Networks)</div>
              <div>Check whether a VPN or virtual adapter is interfering</div>
              <div>Confirm Lanshare is running on the recipient device</div>
              <div>Check network discovery restrictions</div>
            </div>
          )}
        </section>
      ) : (
        <section className={styles.deviceSection}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>Nearby Devices</div>
              <div className={styles.sectionMeta}>
                {isConnected ? "Service connected" : "Service offline"}
                {discoveryStatus === "discovering" && " · discovering"}
              </div>
            </div>
            {hasRecipient && (
              <button
                className={styles.clearSelectionBtn}
                onClick={() => {
                  setSelectedDevice(null);
                  setStagedFiles(null);
                }}
              >
                Change device
              </button>
            )}
          </div>

          <div className={styles.deviceGrid}>
            {devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                isSelected={selectedDevice?.id === device.id}
                onSelect={setSelectedDevice}
                actionLabel={selectedDevice?.id === device.id ? "Selected" : "Send to this device"}
              />
            ))}
          </div>
        </section>
      )}

      <section className={styles.transferArea}>
        {activeTransfer ? (
          activeTransfer.direction === "incoming" ? (
            <IncomingTransfer
              transfer={activeTransfer}
              onAccept={() => {}}
              onDecline={onCancelTransfer}
            />
          ) : (
            <TransferProgress transfer={activeTransfer} onCancel={onCancelTransfer} />
          )
        ) : hasRecipient ? (
          <DropZone
            isDragging={isDragging}
            selectedDeviceName={selectedDevice?.name}
            hasRecipient={dropZoneEnabled}
            stagedCount={stagedFiles?.length ?? 0}
            onSelectFiles={handleSelectFiles}
            onSelectFolder={handleSelectFolder}
          />
        ) : (
          <div className={styles.guidanceState}>
            <div className={styles.guidanceTitle}>Select a device to start sending</div>
            <div className={styles.guidanceText}>
              Files and folders can be added once you choose a recipient.
            </div>
          </div>
        )}
      </section>

      {stagedFiles && selectedDevice && !activeTransfer && (
        <SendConfirmation
          device={selectedDevice}
          files={stagedFiles}
          onCancel={() => setStagedFiles(null)}
          onSend={() => {
            onInitiateTransfer(selectedDevice, stagedFiles);
            setStagedFiles(null);
          }}
        />
      )}

      {isDragging && !hasRecipient && (
        <div className={styles.dragHint} role="status" aria-live="polite">
          Select a device first to send files.
        </div>
      )}
    </div>
  );
};

