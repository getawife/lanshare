import React from "react";
import { File, Folder, X } from "lucide-react";
import { Device, FileItem } from "../../shared/types";
import styles from "./SendConfirmation.module.css";

interface SendConfirmationProps {
  device: Device;
  files: FileItem[];
  onCancel: () => void;
  onSend: () => void;
}

export const SendConfirmation: React.FC<SendConfirmationProps> = ({
  device,
  files,
  onCancel,
  onSend,
}) => {
  const totalSizeBytes = files.reduce((acc, f) => acc + f.sizeBytes, 0);
  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Send Confirmation</span>
          <button className={styles.closeBtn} onClick={onCancel}>
            <X size={14} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.metaRow}>
            <span className={styles.label}>Send to</span>
            <span className={styles.targetDevice}>{device.name}</span>
          </div>

          <div className={styles.summaryText}>
            {files.length} {files.length === 1 ? "item" : "items"} ·{" "}
            {formatSize(totalSizeBytes)}
          </div>

          <div className={styles.fileList}>
            {files.map((file, idx) => (
              <div key={idx} className={styles.fileItem}>
                {file.isDirectory ? <Folder size={14} /> : <File size={14} />}
                <span className={styles.fileName}>{file.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.sendBtn} onClick={onSend}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
};
