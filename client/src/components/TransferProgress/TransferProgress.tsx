import React from "react";
import { CheckCircle2, Clock3, FileText, ShieldAlert } from "lucide-react";
import { TransferRecord } from "../../shared/types";
import styles from "./TransferProgress.module.css";

interface TransferProgressProps {
  transfer: TransferRecord;
  onCancel: () => void;
}

export const TransferProgress: React.FC<TransferProgressProps> = ({
  transfer,
  onCancel,
}) => {
  const percentage = Math.min(
    100,
    Math.round((transfer.bytesTransferred / Math.max(transfer.totalSizeBytes, 1)) * 100) ||
      0,
  );

  const formatSize = (bytes: number) =>
    bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const speedMB = (transfer.speedBytesPerSec / (1024 * 1024)).toFixed(1);
  const fileCount = transfer.files.length;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.title}>
            {transfer.state === "completed"
              ? "Transfer complete"
              : `Sending ${fileCount} file${fileCount === 1 ? "" : "s"} to ${transfer.deviceName}`}
          </span>
          <span className={styles.subtitle}>
            {transfer.state === "completed"
              ? "Ready for the next transfer"
              : "Keep Lanshare open until the transfer finishes."}
          </span>
        </div>
        <span className={styles.percentage}>{percentage}%</span>
      </div>

      <div className={styles.detailRow}>
        <FileText size={14} />
        <span className={styles.fileTarget}>
          {transfer.files[0]?.name || "Files"}
          {transfer.files.length > 1 && ` (+${transfer.files.length - 1} more)`}
        </span>
      </div>
      {transfer.files.some((file) => file.isDirectory) && (
        <div className={styles.detailRow}>
          <FileText size={14} />
          <span className={styles.fileTarget}>Folder structure will be preserved</span>
        </div>
      )}

      <div className={styles.progressTrack} aria-hidden="true">
        <div
          className={styles.progressBar}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className={styles.progressCopy} aria-label="Transfer status details">
        <span>
          <Clock3 size={13} /> {formatSize(transfer.bytesTransferred)} /{" "}
          {formatSize(transfer.totalSizeBytes)}
        </span>
        <span>{speedMB} MB/s</span>
      </div>

      <div className={styles.footer}>
        <span className={styles.metrics}>
          {transfer.state === "completed" ? (
            <>
              <CheckCircle2 size={13} /> Complete
            </>
          ) : transfer.state === "failed" ? (
            <>
              <ShieldAlert size={13} /> Interrupted
            </>
          ) : (
            <>
              <span className={styles.statusDot} aria-hidden="true" /> In progress
            </>
          )}
        </span>
        {transfer.state !== "completed" && (
          <button className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};
