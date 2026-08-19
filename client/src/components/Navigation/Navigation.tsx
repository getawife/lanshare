import React from "react";
import { Monitor, ArrowLeftRight, Settings } from "lucide-react";
import styles from "./Navigation.module.css";

export type ViewTab = "devices" | "transfers" | "settings";

interface NavigationProps {
  activeTab: ViewTab;
  onSelectTab: (tab: ViewTab) => void;
  activeTransfersCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  activeTransfersCount,
}) => {
  return (
    <nav className={styles.sidebar} aria-label="Main Navigation">
      <button
        type="button"
        className={`${styles.navItem} ${activeTab === "devices" ? styles.active : ""}`}
        onClick={() => onSelectTab("devices")}
        aria-current={activeTab === "devices" ? "page" : undefined}
      >
        <Monitor size={22} strokeWidth={1.5} />
        <span>Devices</span>
      </button>

      <button
        type="button"
        className={`${styles.navItem} ${activeTab === "transfers" ? styles.active : ""}`}
        onClick={() => onSelectTab("transfers")}
        aria-current={activeTab === "transfers" ? "page" : undefined}
      >
        <ArrowLeftRight size={22} strokeWidth={1.5} />
        <span>Transfers</span>
        {activeTransfersCount > 0 && (
          <span
            className={styles.badge}
            aria-label={`${activeTransfersCount} active transfers`}
          >
            {activeTransfersCount}
          </span>
        )}
      </button>

      <button
        type="button"
        className={`${styles.navItem} ${activeTab === "settings" ? styles.active : ""}`}
        onClick={() => onSelectTab("settings")}
        aria-current={activeTab === "settings" ? "page" : undefined}
      >
        <Settings size={22} strokeWidth={1.5} />
        <span>Settings</span>
      </button>
    </nav>
  );
};
