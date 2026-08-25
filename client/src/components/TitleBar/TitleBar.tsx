import React from "react";
import { Minus, Square, X } from "lucide-react";
import styles from "./TitleBar.module.css";

interface TitleBarProps {
  isConnected: boolean;
  isRestricted?: boolean;
  discoveryStatus: "discovering" | "found" | "empty";
  statusDetail?: string;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  isConnected,
  isRestricted = false,
  discoveryStatus,
  statusDetail,
}) => {
  // Logs and executes the window control action
  const logAndRun = (action: string, fn: () => void) => {
    console.log(`[TitleBar] ${action} clicked`);
    fn();
  };

  const getStatusLabel = () => {
    if (!isConnected) return "Offline";
    if (isRestricted) return "Network Restricted";
    return "Connected";
  };

  const dotClass = !isConnected
    ? styles.offline
    : isRestricted
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
            logAndRun("minimize", () => window.electronAPI?.minimizeWindow())
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
            logAndRun("maximize", () => window.electronAPI?.maximizeWindow())
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
            logAndRun("close", () => window.electronAPI?.closeWindow())
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
