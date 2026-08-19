import React from "react";
import { Monitor, Laptop, Smartphone } from "lucide-react";
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
  actionLabel = "Send",
}) => {
  const getDeviceIcon = () => {
    switch (device.type) {
      case "pc":
        return <Monitor size={28} strokeWidth={1.5} />;
      case "mac":
        return <Laptop size={28} strokeWidth={1.5} />;
      case "phone":
        return <Smartphone size={28} strokeWidth={1.5} />;
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
      className={`${styles.card} ${isSelected ? styles.selected : ""}`}
      onClick={() => onSelect(device)}
      aria-label={`${actionLabel} to ${device.name}. Status: ${getStatusText()}`}
      aria-pressed={isSelected}
    >
      <div className={styles.avatarContainer}>
        <div className={styles.iconWrapper} aria-hidden="true">
          {getDeviceIcon()}
        </div>
        <span
          className={`${styles.statusBadge} ${styles[`dot_${device.status}`]}`}
          title={getStatusText()}
          aria-hidden="true"
        />
      </div>

      <div className={styles.info}>
        <span className={styles.name}>{device.name}</span>
        <span className={styles.os}>
          {device.os} • {getStatusText()}
        </span>
      </div>

      <div className={styles.actionRow} aria-hidden="true">
        <span className={styles.actionText}>
          {isSelected ? "Selected" : actionLabel}
        </span>
      </div>
    </button>
  );
};
