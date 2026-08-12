import React from "react";
import { Minus, Square, X, Wifi } from "lucide-react";
import styles from "./TitleBar.module.css";

interface TitleBarProps {
  isConnected: boolean;
}

export const TitleBar: React.FC<TitleBarProps> = ({ isConnected }) => {
  const logAndRun = (action: string, fn: () => void) => {
    console.log(`[TitleBar] ${action} clicked`);
    fn();
  };

  return (
    <header className={styles.titleBar}>
      <div className={styles.dragRegion}>
        <span className={styles.appTitle}>Lanshare</span>
        <div className={styles.statusIndicator}>
          <span
            className={`${styles.dot} ${isConnected ? styles.online : styles.offline}`}
          />
          <span className={styles.statusText}>
            {isConnected ? "Connected" : "Offline"}
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
