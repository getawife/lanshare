import React from "react";
import { ShieldCheck } from "lucide-react";
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

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.titleRow}>
          <span className={styles.badge}>Incoming File</span>
          {isTrusted && (
            <span className={styles.trusted}>
              <ShieldCheck size={12} /> Trusted device
            </span>
          )}
        </div>

        <div className={styles.sender}>
          <strong>{transfer.deviceName}</strong> wants to send:
        </div>

        <div className={styles.payloadBox}>
          <div className={styles.fileName}>{transfer.files[0]?.name}</div>
          <div className={styles.fileSize}>
            {formatSize(transfer.totalSizeBytes)}
          </div>
        </div>

        <div className={styles.actions}>
          <button className={styles.declineBtn} onClick={onDecline}>
            Decline
          </button>
          <button className={styles.acceptBtn} onClick={onAccept}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};
