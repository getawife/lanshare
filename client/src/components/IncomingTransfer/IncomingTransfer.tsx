import React from "react";
import { ShieldCheck, FileText } from "lucide-react";
import { transfer_record } from "../../shared/types";
import styles from "./IncomingTransfer.module.css";

interface incoming_transfer_props {
  transfer: transfer_record;
  is_trusted?: boolean;
  on_accept: () => void;
  on_decline: () => void;
}

export const IncomingTransfer: React.FC<incoming_transfer_props> = ({
  transfer,
  is_trusted,
  on_accept,
  on_decline,
}) => {
  const format_size = (bytes: number) =>
    `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const file_name = transfer.files[0]?.name || "Unknown File";
  const additional_files_count = transfer.files.length - 1;

  return (
    <div
      className={styles.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="incoming-transfer-title"
      aria-describedby="incoming-transfer-desc"
    >
      <div className={styles.card}>
        <div className={styles.titleRow}>
          <span className={styles.sender} id="incoming-transfer-title">
            <strong>{transfer.device_name}</strong>
            wants to share a file
          </span>
          {is_trusted && (
            <span className={styles.trusted} title="Verified local device">
              <ShieldCheck size={12} strokeWidth={2.5} />
              Trusted
            </span>
          )}
        </div>

        <div className={styles.payloadBox} id="incoming-transfer-desc">
          <div className={styles.fileIconWrapper} aria-hidden="true">
            <FileText size={18} strokeWidth={2} />
          </div>
          <div className={styles.fileDetails}>
            <span className={styles.fileName}>
              {file_name}
              {additional_files_count > 0 &&
                ` + ${additional_files_count} more`}
            </span>
            <span className={styles.fileSize}>
              {format_size(transfer.total_size_bytes)}
            </span>
          </div>
        </div>

        <div className={styles.actions}>
          <button
            className={styles.declineBtn}
            onClick={on_decline}
            aria-label={`Decline transfer from ${transfer.device_name}`}
          >
            Decline
          </button>
          <button
            className={styles.acceptBtn}
            onClick={on_accept}
            aria-label={`Accept transfer from ${transfer.device_name}`}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};
