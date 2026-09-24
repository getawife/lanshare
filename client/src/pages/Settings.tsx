import React from "react";
import { app_settings } from "../shared/types";
import styles from "./Settings.module.css";

interface settings_props {
  settings: app_settings;
  on_update_settings: (updates: Partial<app_settings>) => void;
}

export const SettingsPage: React.FC<settings_props> = ({
  settings,
  on_update_settings,
}) => {
  const handle_browse = async () => {
    const folder = await window.electronAPI?.selectFolder();
    if (folder) on_update_settings({ downloadFolder: folder.path });
  };

  return (
    <div className={styles.container} role="region" aria-label="Settings Page">
      <h1 className={styles.title}>Settings</h1>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>General</div>
        <div className={styles.cardGroup}>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="deviceNameInput">
              Device name
            </label>
            <input
              id="deviceNameInput"
              type="text"
              className={styles.textInput}
              value={settings.deviceName}
              onChange={(e) =>
                on_update_settings({ deviceName: e.target.value })
              }
            />
          </div>
          <div className={styles.checkboxRow}>
            <label htmlFor="autoStart">Start at system login</label>
            <input
              type="checkbox"
              id="autoStart"
              checked={settings.autoStart}
              onChange={(e) =>
                on_update_settings({ autoStart: e.target.checked })
              }
            />
          </div>
          <div className={styles.checkboxRow}>
            <label htmlFor="notifications">Show notifications</label>
            <input
              type="checkbox"
              id="notifications"
              checked={settings.showNotifications}
              onChange={(e) =>
                on_update_settings({ showNotifications: e.target.checked })
              }
            />
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Transfers</div>
        <div className={styles.cardGroup}>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="downloadFolderInput">
              Default download folder
            </label>
            <div className={styles.folderInputGroup}>
              <input
                id="downloadFolderInput"
                type="text"
                readOnly
                className={styles.textInput}
                value={settings.downloadFolder}
              />
              <button className={styles.browseBtn} onClick={handle_browse}>
                Browse
              </button>
            </div>
          </div>
          <div className={styles.checkboxRow}>
            <label htmlFor="askAccept">Ask before accepting files</label>
            <input
              type="checkbox"
              id="askAccept"
              checked={settings.askBeforeAccepting}
              onChange={(e) =>
                on_update_settings({ askBeforeAccepting: e.target.checked })
              }
            />
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>About</div>
        <div className={styles.cardGroup}>
          <div className={styles.aboutRow}>
            <span>Lanshare Desktop</span>
            <span className={styles.version}>v1.0.4</span>
          </div>
        </div>
      </div>
    </div>
  );
};
