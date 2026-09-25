import React from "react";
import { Monitor, Laptop, Smartphone, Star } from "lucide-react";
import { device } from "../../shared/types";
import styles from "./DeviceCard.module.css";

interface device_card_props {
  device: device;
  is_selected: boolean;
  on_select: (device: device) => void;
  on_toggle_trust: (device: device, trusted: boolean) => void;
  action_label?: string;
}

export const DeviceCard: React.FC<device_card_props> = ({
  device,
  is_selected,
  on_select,
  on_toggle_trust,
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

  const handle_star_click = (event: React.MouseEvent) => {
    event.stopPropagation();
    on_toggle_trust(device, !device.is_trusted);
  };

  const trust_label = device.is_trusted
    ? `Remove ${device.name} from trusted devices`
    : `Add ${device.name} to trusted devices`;

  return (
    <button
      type="button"
      className={`${styles.card} ${is_selected ? styles.selected : ""} ${
        device.is_trusted ? styles.trusted : ""
      }`}
      onClick={() => on_select(device)}
      aria-label={`${action_label} to ${device.name}. Status: ${get_status_text()}`}
      aria-pressed={is_selected}
    >
      <span
        role="button"
        tabIndex={0}
        className={`${styles.starBtn} ${
          device.is_trusted ? styles.starBtnActive : ""
        }`}
        onClick={handle_star_click}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            on_toggle_trust(device, !device.is_trusted);
          }
        }}
        title={trust_label}
        aria-label={trust_label}
        aria-pressed={Boolean(device.is_trusted)}
      >
        <Star
          size={14}
          strokeWidth={2}
          fill={device.is_trusted ? "currentColor" : "none"}
        />
      </span>

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
