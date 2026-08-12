import React from "react";
import { AppSettings } from "../shared/types";
import styles from "./Settings.module.css";

interface SettingsProps {
  settings: AppSettings;
  onUpdateSettings: (updates: Partial<AppSettings>) => void;
}

export const SettingsPage: React.FC<SettingsProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const handleBrowse = async () => {
    const folder = await window.electronAPI?.selectFolder();
    if (folder) onUpdateSettings({ downloadFolder: folder.path });
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Settings</h1>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>General</div>
        <div className={styles.row}>
          <label className={styles.label}>Device name</label>
          <input
            type="text"
            className={styles.textInput}
            value={settings.deviceName}
            onChange={(e) => onUpdateSettings({ deviceName: e.target.value })}
          />
        </div>
        <div className={styles.checkboxRow}>
          <input
            type="checkbox"
            id="autoStart"
            checked={settings.autoStart}
            onChange={(e) => onUpdateSettings({ autoStart: e.target.checked })}
          />
          <label htmlFor="autoStart">Start with Windows</label>
        </div>
        <div className={styles.checkboxRow}>
          <input
            type="checkbox"
            id="notifications"
            checked={settings.showNotifications}
            onChange={(e) =>
              onUpdateSettings({ showNotifications: e.target.checked })
            }
          />
          <label htmlFor="notifications">Show notifications</label>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Transfers</div>
        <div className={styles.row}>
          <label className={styles.label}>Default download folder</label>
          <div className={styles.folderInputGroup}>
            <input
              type="text"
              readOnly
              className={styles.textInput}
              value={settings.downloadFolder}
            />
            <button className={styles.browseBtn} onClick={handleBrowse}>
              Browse
            </button>
          </div>
        </div>
        <div className={styles.checkboxRow}>
          <input
            type="checkbox"
            id="askAccept"
            checked={settings.askBeforeAccepting}
            onChange={(e) =>
              onUpdateSettings({ askBeforeAccepting: e.target.checked })
            }
          />
          <label htmlFor="askAccept">Ask before accepting files</label>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>About</div>
        <div className={styles.aboutRow}>
          <span>Lanshare Desktop</span>
          <span className={styles.version}>v1.2.0</span>
        </div>
      </div>
    </div>
  );
};
