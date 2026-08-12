import React from "react";
import { Upload, File, Folder } from "lucide-react";
import styles from "./DropZone.module.css";

interface DropZoneProps {
  isDragging: boolean;
  selectedDeviceName?: string;
  stagedCount?: number;
  onSelectFiles: () => void;
  onSelectFolder: () => void;
}

export const DropZone: React.FC<DropZoneProps> = ({
  isDragging,
  selectedDeviceName,
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
              : "Select a device to complete transfer"}
          </div>
        </div>
      ) : (
        <div className={styles.normalContent}>
          <div className={styles.prompt}>Drop files to send</div>
          {stagedCount > 0 && (
            <div className={styles.dragSubtitle}>
              {stagedCount} item{stagedCount === 1 ? "" : "s"} selected
              {selectedDeviceName
                ? ` for ${selectedDeviceName}`
                : " - select a device to continue"}
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
