import React from "react";
import { Monitor, Laptop, Smartphone } from "lucide-react";
import { Device } from "../../shared/types";
import styles from "./DeviceCard.module.css";

interface DeviceCardProps {
  device: Device;
  isSelected: boolean;
  onSelect: (device: Device) => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  isSelected,
  onSelect,
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
    <div
      className={`${styles.card} ${isSelected ? styles.selected : ""} ${styles[device.status]}`}
      onClick={() => onSelect(device)}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(device);
      }}
    >
      <div className={styles.iconWrapper}>{getDeviceIcon()}</div>
      <div className={styles.info}>
        <div className={styles.name}>{device.name}</div>
        <div className={styles.os}>{device.os}</div>
      </div>
      <div className={styles.statusRow}>
        <span
          className={`${styles.statusDot} ${styles[`dot_${device.status}`]}`}
        />
        <span className={styles.statusText}>{getStatusText()}</span>
      </div>
    </div>
  );
};
