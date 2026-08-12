import React, { useState } from "react";
import { RefreshCw, MonitorX } from "lucide-react";
import { Device, FileItem, TransferRecord } from "../shared/types";
import { DeviceCard } from "../components/DeviceCard/DeviceCard";
import { DropZone } from "../components/DropZone/DropZone";
import { SendConfirmation } from "../components/SendConfirmation/SendConfirmation";
import { TransferProgress } from "../components/TransferProgress/TransferProgress";
import styles from "./Home.module.css";

interface HomeProps {
  devices: Device[];
  onRefreshDevices: () => void;
  activeTransfer?: TransferRecord;
  onInitiateTransfer: (device: Device, files: FileItem[]) => void;
  onCancelTransfer: () => void;
}

export const Home: React.FC<HomeProps> = ({
  devices,
  onRefreshDevices,
  activeTransfer,
  onInitiateTransfer,
  onCancelTransfer,
}) => {
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [stagedFiles, setStagedFiles] = useState<FileItem[] | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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
    const files = await window.electronAPI?.selectFiles();
    if (files) setStagedFiles(files);
  };

  const handleSelectFolder = async () => {
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
        <div>
          <h1 className={styles.title}>Nearby Devices</h1>
          <div className={styles.subtitle}>
            {devices.length} devices available
          </div>
        </div>
        <button
          className={styles.refreshBtn}
          onClick={onRefreshDevices}
          title="Rescan network"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {devices.length === 0 ? (
        <div className={styles.emptyState}>
          <MonitorX size={32} className={styles.emptyIcon} />
          <div className={styles.emptyTitle}>No devices found</div>
          <div className={styles.emptyText}>
            Make sure both devices are connected to the same network.
          </div>
          <button className={styles.scanBtn} onClick={onRefreshDevices}>
            Scan Again
          </button>
        </div>
      ) : (
        <div className={styles.deviceGrid}>
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              isSelected={selectedDevice?.id === device.id}
              onSelect={setSelectedDevice}
            />
          ))}
        </div>
      )}

      {activeTransfer ? (
        <div className={styles.activeTransferWrapper}>
          <TransferProgress
            transfer={activeTransfer}
            onCancel={onCancelTransfer}
          />
        </div>
      ) : (
        <div className={styles.dropZoneWrapper}>
          <DropZone
            isDragging={isDragging}
            selectedDeviceName={selectedDevice?.name}
            stagedCount={stagedFiles?.length ?? 0}
            onSelectFiles={handleSelectFiles}
            onSelectFolder={handleSelectFolder}
          />
        </div>
      )}

      {stagedFiles && selectedDevice && (
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
    </div>
  );
};
