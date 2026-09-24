import React from "react";
import { Monitor, Laptop, Smartphone } from "lucide-react";
import { device } from "../../shared/types";
import styles from "./DeviceCard.module.css";

interface device_card_props {
  device: device;
  is_selected: boolean;
  on_select: (device: device) => void;
  action_label?: string;
}

export const DeviceCard: React.FC<device_card_props> = ({
  device,
  is_selected,
  on_select,
  action_label = "Send",
}) => {
  const get_device_icon = () => {
    switch (device.type_) {
      case "pc":
        return <Monitor size={28} strokeWidth={1.5} />;
      case "mac":
        return <Laptop size={28} strokeWidth={1.5} />;
      case "phone":
        return <Smartphone size={28} strokeWidth={1.5} />;
    }
  };

  const get_status_text = () => {
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
      className={`${styles.card} ${is_selected ? styles.selected : ""}`}
      onClick={() => on_select(device)}
      aria-label={`${action_label} to ${device.name}. Status: ${get_status_text()}`}
      aria-pressed={is_selected}
    >
      <div className={styles.avatarContainer}>
        <div className={styles.iconWrapper} aria-hidden="true">
          {get_device_icon()}
        </div>
      </div>

      <div className={styles.info}>
        <span className={styles.name}>{device.name}</span>
        <span className={styles.os}>
          {device.os} • {get_status_text()}
        </span>
      </div>
    </button>
  );
};
