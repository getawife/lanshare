import React from "react";
import { Upload, File, Folder, SearchX } from "lucide-react";
import styles from "./DropZone.module.css";

interface DropZoneProps {
  isDragging: boolean;
  selectedDeviceName?: string | undefined;
  hasRecipient: boolean;
  stagedCount?: number;
  onSelectFiles: () => void;
  onSelectFolder: () => void;
}

export const DropZone: React.FC<DropZoneProps> = ({
  isDragging,
  selectedDeviceName,
  hasRecipient,
  stagedCount = 0,
  onSelectFiles,
  onSelectFolder,
}) => {
  return (
    <div
      className={`${styles.dropZone} ${isDragging ? styles.dragging : ""}`}
      aria-live="polite"
    >
      {isDragging ? (
        <div className={styles.contentContainer}>
          <div>
            <h3 className={styles.title}>Release to Drop</h3>
            <div className={styles.subtitle}>
              {selectedDeviceName ? (
                <>
                  Sending to{" "}
                  <span className={styles.accentText}>
                    {selectedDeviceName}
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
          {!hasRecipient ? (
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
              {stagedCount > 0 && (
                <div className={styles.subtitle}>
                  <span className={styles.accentText}>{stagedCount}</span> item
                  {stagedCount === 1 ? "" : "s"} ready
                  {selectedDeviceName ? ` for ${selectedDeviceName}` : ""}
                </div>
              )}
            </>
          )}

          <div className={styles.buttonGroup}>
            <button
              className={styles.actionBtn}
              onClick={onSelectFiles}
              aria-label="Select files to send"
            >
              <File size={16} strokeWidth={2} />
              <span>Select Files</span>
            </button>
            <button
              className={styles.secondaryBtn}
              onClick={onSelectFolder}
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
