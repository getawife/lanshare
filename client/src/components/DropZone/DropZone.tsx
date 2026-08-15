import React from "react";
import { Upload, File, Folder, SearchX } from "lucide-react";
import styles from "./DropZone.module.css";

interface DropZoneProps {
  isDragging: boolean;
  selectedDeviceName?: string;
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
    <div className={`${styles.dropZone} ${isDragging ? styles.dragging : ""}`}>
      {isDragging ? (
        <div className={styles.dragContent}>
          <Upload size={28} className={styles.dragIcon} />
          <div className={styles.dragTitle}>Drop files here</div>
          <div className={styles.dragSubtitle}>
            {selectedDeviceName
              ? `to send to ${selectedDeviceName}`
              : "Select a device first"}
          </div>
        </div>
      ) : (
        <div className={styles.normalContent}>
          {!hasRecipient ? (
            <>
              <SearchX size={24} className={styles.emptyIcon} />
              <div className={styles.prompt}>Select a device to start sending</div>
              <div className={styles.dragSubtitle}>
                Files and folders can be added once you choose a recipient.
              </div>
            </>
          ) : (
            <div className={styles.prompt}>Drop files here</div>
          )}
          {stagedCount > 0 && hasRecipient && (
            <div className={styles.dragSubtitle}>
              {stagedCount} item{stagedCount === 1 ? "" : "s"} selected
              {selectedDeviceName ? ` for ${selectedDeviceName}` : ""}
            </div>
          )}
          <div className={styles.buttonGroup}>
            <button className={styles.actionBtn} onClick={onSelectFiles}>
              <File size={14} />
              <span>Select Files</span>
            </button>
            <button className={styles.secondaryBtn} onClick={onSelectFolder}>
              <Folder size={14} />
              <span>Select Folder</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
