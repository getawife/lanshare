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
  const logAndRun = (action: string, fn: () => void) => {
    console.log(`[TitleBar] ${action} clicked`);
    fn();
  };

  const getStatusLabel = () => {
    if (!isConnected) return "Offline";
    if (isRestricted) return "Network Restricted";
    return "Connected";
  };

  const getStatusSubtext = () => {
    if (statusDetail) return ` - ${statusDetail}`;
    if (!isConnected) return " - service unavailable";
    if (isRestricted) return " - discovery limited";
    if (discoveryStatus === "discovering") return " - scanning nearby devices";
    if (discoveryStatus === "found") return " - discovery active";
    return " - no devices found yet";
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
        <div className={styles.statusIndicator}>
          <span className={`${styles.dot} ${dotClass}`} />
          <span className={styles.statusText}>
            {getStatusLabel()}
            <span className={styles.statusSubtext}>{getStatusSubtext()}</span>
          </span>
        </div>
      </div>
      <div className={styles.windowControls}>
        <button
          type="button"
          draggable={false}
          onClick={() =>
            logAndRun("minimize", () => window.electronAPI?.minimizeWindow())
          }
          className={styles.controlBtn}
          aria-label="Minimize"
        >
          <Minus size={12} />
        </button>
        <button
          type="button"
          draggable={false}
          onClick={() =>
            logAndRun("maximize", () => window.electronAPI?.maximizeWindow())
          }
          className={styles.controlBtn}
          aria-label="Maximize"
        >
          <Square size={10} />
        </button>
        <button
          type="button"
          draggable={false}
          onClick={() =>
            logAndRun("close", () => window.electronAPI?.closeWindow())
          }
          className={`${styles.controlBtn} ${styles.closeBtn}`}
          aria-label="Close"
        >
          <X size={12} />
        </button>
      </div>
    </header>
  );
};
