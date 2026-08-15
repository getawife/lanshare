import React from "react";
import { ChevronRight, Monitor, Laptop, Smartphone } from "lucide-react";
import { Device } from "../../shared/types";
import styles from "./DeviceCard.module.css";

interface DeviceCardProps {
  device: Device;
  isSelected: boolean;
  onSelect: (device: Device) => void;
  actionLabel?: string;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  isSelected,
  onSelect,
  actionLabel = "Connect",
}) => {
  const getDeviceIcon = () => {
    switch (device.type) {
      case "pc":
        return <Monitor size={20} />;
      case "mac":
        return <Laptop size={20} />;
      case "phone":
        return <Smartphone size={20} />;
    }
  };

  const getStatusText = () => {
    switch (device.status) {
      case "available":
        return "Available";
      case "connecting":
        return "Connecting...";
      case "busy":
        return "Busy";
      case "offline":
        return "Offline";
    }
  };

  return (
    <button
      type="button"
      className={`${styles.card} ${isSelected ? styles.selected : ""} ${styles[device.status]}`}
      onClick={() => onSelect(device)}
      aria-label={`${actionLabel} to ${device.name}`}
    >
      <div className={styles.primaryRow}>
        <div className={styles.iconWrapper}>{getDeviceIcon()}</div>
        <div className={styles.info}>
          <div className={styles.name}>{device.name}</div>
          <div className={styles.os}>{device.os}</div>
        </div>
      </div>
      <div className={styles.statusRow}>
        <span
          className={`${styles.statusDot} ${styles[`dot_${device.status}`]}`}
          aria-hidden="true"
        />
        <span className={styles.statusText}>{getStatusText()}</span>
      </div>
      <div className={styles.actionRow}>
        <span className={styles.actionText}>{actionLabel}</span>
        <ChevronRight size={14} className={styles.actionIcon} aria-hidden="true" />
      </div>
    </button>
  );
};
