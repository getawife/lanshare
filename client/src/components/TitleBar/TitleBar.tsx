import React from "react";
import { Minus, Square, X } from "lucide-react";
import styles from "./TitleBar.module.css";

interface title_bar_props {
  is_connected: boolean;
  is_restricted?: boolean;
  discovery_status: "discovering" | "found" | "empty";
  status_detail?: string;
}

export const TitleBar: React.FC<title_bar_props> = ({
  is_connected,
  is_restricted = false,
  discovery_status,
  status_detail,
}) => {
  const log_and_run = (action: string, fn: () => void) => {
    console.log(`[TitleBar] ${action} clicked`);
    fn();
  };

  const get_status_label = () => {
    if (!is_connected) return "Offline";
    if (is_restricted) return "Network Restricted";
    return "Connected";
  };

  const dot_class = !is_connected
    ? styles.offline
    : is_restricted
      ? styles.restricted
      : styles.online;

  return (
    <header className={styles.titleBar}>
      <div className={styles.dragRegion}>
        <span className={styles.appTitle}>Lanshare</span>
      </div>

      <div
        className={styles.windowControls}
        role="region"
        aria-label="Window Controls"
      >
        <button
          type="button"
          draggable={false}
          onClick={() =>
            log_and_run("minimize", () => window.electronAPI?.minimizeWindow())
          }
          className={styles.controlBtn}
          aria-label="Minimize window"
        >
          <Minus size={12} strokeWidth={2} />
        </button>
        <button
          type="button"
          draggable={false}
          onClick={() =>
            log_and_run("maximize", () => window.electronAPI?.maximizeWindow())
          }
          className={styles.controlBtn}
          aria-label="Maximize window"
        >
          <Square size={10} strokeWidth={2} />
        </button>
        <button
          type="button"
          draggable={false}
          onClick={() =>
            log_and_run("close", () => window.electronAPI?.closeWindow())
          }
          className={`${styles.controlBtn} ${styles.closeBtn}`}
          aria-label="Close window"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
};
