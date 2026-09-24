import React from "react";
import { Upload, File, Folder, SearchX } from "lucide-react";
import styles from "./DropZone.module.css";

interface drop_zone_props {
  is_dragging: boolean;
  selected_device_name?: string | undefined;
  has_recipient: boolean;
  staged_count?: number;
  on_select_files: () => void;
  on_select_folder: () => void;
}

export const DropZone: React.FC<drop_zone_props> = ({
  is_dragging,
  selected_device_name,
  has_recipient,
  staged_count = 0,
  on_select_files,
  on_select_folder,
}) => {
  return (
    <div
      className={`${styles.dropZone} ${is_dragging ? styles.dragging : ""}`}
      aria-live="polite"
    >
      {is_dragging ? (
        <div className={styles.contentContainer}>
          <div>
            <h3 className={styles.title}>Release to Drop</h3>
            <div className={styles.subtitle}>
              {selected_device_name ? (
                <>
                  Sending to{" "}
                  <span className={styles.accentText}>
                    {selected_device_name}
                  </span>
                </>
              ) : (
                "Select a device first"
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.contentContainer}>
          {!has_recipient ? (
            <>
              <div>
                <h3 className={styles.title}>Select a recipient</h3>
                <div className={styles.subtitle}>
                  Files and folders can be added once you choose a device to
                  send to.
                </div>
              </div>
            </>
          ) : (
            <>
              <h3 className={styles.title}>Drop files here</h3>
              {staged_count > 0 && (
                <div className={styles.subtitle}>
                  <span className={styles.accentText}>{staged_count}</span> item
                  {staged_count === 1 ? "" : "s"} ready
                  {selected_device_name ? ` for ${selected_device_name}` : ""}
                </div>
              )}
            </>
          )}

          <div className={styles.buttonGroup}>
            <button
              className={styles.actionBtn}
              onClick={on_select_files}
              aria-label="Select files to send"
            >
              <File size={16} strokeWidth={2} />
              <span>Select Files</span>
            </button>
            <button
              className={styles.secondaryBtn}
              onClick={on_select_folder}
              aria-label="Select folder to send"
            >
              <Folder size={16} strokeWidth={2} />
              <span>Select Folder</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
