import React from "react";
import { Monitor, ArrowLeftRight, Settings } from "lucide-react";
import styles from "./Navigation.module.css";

export type view_tab = "devices" | "transfers" | "settings";

interface navigation_props {
  active_tab: view_tab;
  on_select_tab: (tab: view_tab) => void;
  active_transfers_count: number;
}

export const Navigation: React.FC<navigation_props> = ({
  active_tab,
  on_select_tab,
  active_transfers_count,
}) => {
  return (
    <nav className={styles.sidebar} aria-label="Main Navigation">
      <button
        type="button"
        className={`${styles.navItem} ${active_tab === "devices" ? styles.active : ""}`}
        onClick={() => on_select_tab("devices")}
        aria-current={active_tab === "devices" ? "page" : undefined}
      >
        <Monitor size={22} strokeWidth={1.5} />
        <span>Devices</span>
      </button>

      <button
        type="button"
        className={`${styles.navItem} ${active_tab === "transfers" ? styles.active : ""}`}
        onClick={() => on_select_tab("transfers")}
        aria-current={active_tab === "transfers" ? "page" : undefined}
      >
        <ArrowLeftRight size={22} strokeWidth={1.5} />
        <span>Transfers</span>
        {active_transfers_count > 0 && (
          <span
            className={styles.badge}
            aria-label={`${active_transfers_count} active transfers`}
          >
            {active_transfers_count}
          </span>
        )}
      </button>

      <button
        type="button"
        className={`${styles.navItem} ${active_tab === "settings" ? styles.active : ""}`}
        onClick={() => on_select_tab("settings")}
        aria-current={active_tab === "settings" ? "page" : undefined}
      >
        <Settings size={22} strokeWidth={1.5} />
        <span>Settings</span>
      </button>
    </nav>
  );
};
