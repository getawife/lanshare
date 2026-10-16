import React from "react";
import { app_settings, app_theme } from "../shared/types";
import { format_fingerprint } from "../shared/format.ts";
import styles from "./Settings.module.css";

interface settings_props {
  settings: app_settings;
  on_update_settings: (updates: Partial<app_settings>) => void;
  device_fingerprint?: string | undefined;
}

const theme_options: { value: app_theme; label: string }[] = [
  { value: "default_light", label: "Default Light" },
  { value: "default_dark", label: "Default Dark" },
  { value: "green_light", label: "Green Light" },
  { value: "green_dark", label: "Green Dark" },
  { value: "blue_light", label: "Blue Light" },
  { value: "blue_dark", label: "Blue Dark" },
];

export const SettingsPage: React.FC<settings_props> = ({
  settings,
  on_update_settings,
  device_fingerprint,
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
        <div className={styles.sectionTitle}>Appearance</div>
        <fieldset className={styles.theme_picker}>
          <div className={styles.theme_choices}>
            {theme_options.map((option) => (
              <label className={styles.theme_choice} key={option.value}>
                <input
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={settings.theme === option.value}
                  onChange={() => on_update_settings({ theme: option.value })}
                />
                <span
                  className={styles.theme_preview}
                  data-theme={option.value}
                >
                  <span className={styles.preview_sidebar} />
                  <span className={styles.preview_content}>
                    <span className={styles.preview_line} />
                    <span className={styles.preview_card} />
                  </span>
                </span>
                <span className={styles.theme_label}>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
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
            <span className={styles.version}>v1.0.8</span>
          </div>
          <div className={styles.aboutRow}>
            <span>Device fingerprint</span>
            <span
              className={styles.version}
              title="Compare this with the fingerprint shown on the other device when you trust it"
            >
              {format_fingerprint(device_fingerprint) || "Unavailable"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
