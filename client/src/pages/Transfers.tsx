import React from "react";
import { ArrowUp, ArrowDown, Folder, RotateCcw, Trash2 } from "lucide-react";
import { TransferRecord } from "../shared/types";
import styles from "./Transfers.module.css";

interface TransfersProps {
  records: TransferRecord[];
  onClearHistory: () => void;
}

export const Transfers: React.FC<TransfersProps> = ({
  records,
  onClearHistory,
}) => {
  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Transfers</h1>
        {records.length > 0 && (
          <button className={styles.clearBtn} onClick={onClearHistory}>
            <Trash2 size={13} />
            <span>Clear History</span>
          </button>
        )}
      </div>

      {records.length === 0 ? (
        <div className={styles.emptyState}>
          {" "}
          <b>No recent file transfers</b>
          <br />
          <p>Transfers you send or receive will appear here.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {records.map((record) => (
            <div key={record.id} className={styles.row}>
              <div className={styles.iconCol}>
                {record.direction === "outgoing" ? (
                  <ArrowUp size={16} className={styles.outgoing} />
                ) : (
                  <ArrowDown size={16} className={styles.incoming} />
                )}
              </div>

              <div className={styles.infoCol}>
                <div className={styles.fileName}>
                  {record.files[0]?.name || "Files"}
                </div>
                <div className={styles.meta}>
                  {record.direction === "outgoing"
                    ? `To ${record.deviceName}`
                    : `From ${record.deviceName}`}{" "}
                  · {formatSize(record.totalSizeBytes)}
                </div>
              </div>

              <div className={styles.statusCol}>
                <span
                  className={`${styles.statusBadge} ${styles[record.state]}`}
                >
                  {record.state}
                </span>
              </div>

              <div className={styles.actionsCol}>
                {record.state === "completed" && (
                  <button
                    className={styles.actionBtn}
                    title="Open in folder"
                    onClick={() => window.electronAPI?.openFolder?.(record.files[0]?.path)}
                  >
                    <Folder size={14} />
                  </button>
                )}
                {record.state === "failed" && (
                  <button className={styles.actionBtn} title="Retry transfer">
                    <RotateCcw size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
