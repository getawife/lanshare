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
        className={`${styles.navItem} ${activeTab === "devices" ? styles.active : ""}`}
        onClick={() => onSelectTab("devices")}
      >
        <Monitor size={16} />
        <span>Devices</span>
      </button>

      <button
        className={`${styles.navItem} ${activeTab === "transfers" ? styles.active : ""}`}
        onClick={() => onSelectTab("transfers")}
      >
        <ArrowLeftRight size={16} />
        <span>Transfers</span>
        {activeTransfersCount > 0 && (
          <span className={styles.badge}>{activeTransfersCount}</span>
        )}
      </button>

      <button
        className={`${styles.navItem} ${activeTab === "settings" ? styles.active : ""}`}
        onClick={() => onSelectTab("settings")}
      >
        <Settings size={16} />
        <span>Settings</span>
      </button>
    </nav>
  );
};
