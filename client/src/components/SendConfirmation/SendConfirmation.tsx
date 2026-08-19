import React, { useState } from "react";
import { File, Folder, X, CircleDashed } from "lucide-react";
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
  const [isSending, setIsSending] = useState(false);

  // Calculates the total size of all files in the array[cite: 12]
  const totalSizeBytes = files.reduce(
    (acc, f) => acc + (Number(f.sizeBytes) || 0),
    0,
  );

  // Formats bytes into a readable string (B, KB, MB, GB)[cite: 12]
  const formatSize = (bytes: number) => {
    if (bytes <= 0 || isNaN(bytes)) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  // Handles the send action and sets the loading state[cite: 12]
  const handleSend = async () => {
    setIsSending(true);
    try {
      await onSend();
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-modal-title"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title} id="send-modal-title">
            Confirm Transfer
          </span>
          <button
            className={styles.closeBtn}
            onClick={onCancel}
            disabled={isSending}
            aria-label="Close modal"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.metaRow}>
            <span className={styles.label}>Sending to</span>
            <span className={styles.targetDevice}>{device.name}</span>
          </div>

          <div className={styles.summaryText}>
            {files.length} {files.length === 1 ? "item" : "items"} ·{" "}
            {formatSize(totalSizeBytes)}
          </div>

          <div className={styles.fileList} tabIndex={0}>
            {files.map((file, idx) => (
              <div key={idx} className={styles.fileItem}>
                <span className={styles.fileIcon}>
                  {file.isDirectory ? <Folder size={18} /> : <File size={18} />}
                </span>
                <span className={styles.fileName}>{file.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={isSending}
          >
            {isSending ? (
              <>
                <CircleDashed size={18} className={styles.spinning} />
                <span>Sending…</span>
              </>
            ) : (
              "Send Files"
            )}
          </button>
          <button
            className={styles.cancelBtn}
            onClick={onCancel}
            disabled={isSending}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
