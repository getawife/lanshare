import React, { useState } from "react";
import { File, Folder, X, CircleDashed } from "lucide-react";
import { device, file_item } from "../../shared/types";
import styles from "./SendConfirmation.module.css";

interface send_confirmation_props {
  device: device;
  files: file_item[];
  on_cancel: () => void;
  on_send: () => void;
}

export const SendConfirmation: React.FC<send_confirmation_props> = ({
  device,
  files,
  on_cancel,
  on_send,
}) => {
  const [is_sending, set_is_sending] = useState(false);

  const total_size_bytes = files.reduce(
    (acc, f) => acc + (Number(f.size) || 0),
    0,
  );

  const format_size = (bytes: number) => {
    if (bytes <= 0 || isNaN(bytes)) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const handle_send = async () => {
    set_is_sending(true);
    try {
      await on_send();
    } finally {
      set_is_sending(false);
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
            onClick={on_cancel}
            disabled={is_sending}
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
            {format_size(total_size_bytes)}
          </div>

          <div className={styles.fileList} tabIndex={0}>
            {files.map((file, idx) => (
              <div key={idx} className={styles.fileItem}>
                <span className={styles.fileIcon}>
                  {file.is_dir ? <Folder size={18} /> : <File size={18} />}
                </span>
                <span className={styles.fileName}>{file.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          <button
            className={styles.sendBtn}
            onClick={handle_send}
            disabled={is_sending}
          >
            {is_sending ? (
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
            onClick={on_cancel}
            disabled={is_sending}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
