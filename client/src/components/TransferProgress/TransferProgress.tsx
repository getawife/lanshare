import React from "react";
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
    Math.round((transfer.bytesTransferred / transfer.totalSizeBytes) * 100) ||
      0,
  );

  const formatSize = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
  const speedMB = (transfer.speedBytesPerSec / (1024 * 1024)).toFixed(1);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>Sending to {transfer.deviceName}</span>
        <span className={styles.percentage}>{percentage}%</span>
      </div>

      <div className={styles.fileTarget}>
        {transfer.files[0]?.name || "Files"}
        {transfer.files.length > 1 && ` (+${transfer.files.length - 1} more)`}
      </div>

      <div className={styles.progressTrack}>
        <div
          className={styles.progressBar}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className={styles.footer}>
        <span className={styles.metrics}>
          {formatSize(transfer.bytesTransferred)} MB /{" "}
          {formatSize(transfer.totalSizeBytes)} MB · {speedMB} MB/s
        </span>
        <button className={styles.cancelBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};
