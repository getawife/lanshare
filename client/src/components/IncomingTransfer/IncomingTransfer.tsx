import React from "react";
import { ShieldCheck, FileText } from "lucide-react";
import { TransferRecord } from "../../shared/types";
import styles from "./IncomingTransfer.module.css";

interface IncomingTransferProps {
  transfer: TransferRecord;
  isTrusted?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export const IncomingTransfer: React.FC<IncomingTransferProps> = ({
  transfer,
  isTrusted,
  onAccept,
  onDecline,
}) => {
  const formatSize = (bytes: number) =>
    `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const fileName = transfer.files[0]?.name || "Unknown File";
  const additionalFilesCount = transfer.files.length - 1;

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
            <strong>{transfer.deviceName}</strong>
            wants to share a file
          </span>
          {isTrusted && (
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
              {fileName}
              {additionalFilesCount > 0 && ` + ${additionalFilesCount} more`}
            </span>
            <span className={styles.fileSize}>
              {formatSize(transfer.totalSizeBytes)}
            </span>
          </div>
        </div>

        <div className={styles.actions}>
          <button
            className={styles.declineBtn}
            onClick={onDecline}
            aria-label={`Decline transfer from ${transfer.deviceName}`}
          >
            Decline
          </button>
          <button
            className={styles.acceptBtn}
            onClick={onAccept}
            aria-label={`Accept transfer from ${transfer.deviceName}`}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};
