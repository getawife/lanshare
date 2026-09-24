import React from "react";
import { ArrowUp, ArrowDown, Folder, RotateCcw } from "lucide-react";
import { transfer_record } from "../shared/types";
import styles from "./Transfers.module.css";

interface transfers_props {
  records: transfer_record[];
  on_clear_history: () => void;
  on_retry_transfer?: (record: transfer_record) => void;
}

export const Transfers: React.FC<transfers_props> = ({
  records,
  on_clear_history,
  on_retry_transfer,
}) => {
  const format_size = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className={styles.container}
      role="region"
      aria-label="Transfer History"
    >
      <div className={styles.header}>
        <h1 className={styles.title}>Transfers</h1>
        {records.length > 0 && (
          <button
            className={styles.clearBtn}
            onClick={on_clear_history}
            aria-label="Clear transfer history"
          >
            <span>Clear History</span>
          </button>
        )}
      </div>

      {records.length === 0 ? (
        <div className={styles.emptyState}>
          <b>No recent file transfers</b>
          <p>Transfers you send or receive will appear here.</p>
        </div>
      ) : (
        <div className={styles.listWrapper}>
          <div
            className={styles.list}
            role="feed"
            aria-label="Transfer history list"
          >
            {records.map((record) => (
              <div key={record.id} className={styles.row}>
                <div className={styles.iconCol} aria-hidden="true">
                  {record.direction === "outgoing" ? (
                    <ArrowUp size={14} className={styles.outgoing} />
                  ) : (
                    <ArrowDown size={14} className={styles.incoming} />
                  )}
                </div>

                <div className={styles.infoCol}>
                  <div className={styles.fileName}>
                    {record.files[0]?.name || "Files"}
                  </div>
                  <div className={styles.meta}>
                    {record.direction === "outgoing"
                      ? `To ${record.device_name}`
                      : `From ${record.device_name}`}{" "}
                    · {format_size(record.total_size_bytes)}
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
                  {record.state === "completed" && record.files[0]?.path && (
                    <button
                      className={styles.actionBtn}
                      title="Open in folder"
                      aria-label="Open in folder"
                      onClick={() =>
                        window.electronAPI?.openFolder?.(record.files[0]!.path)
                      }
                    >
                      <Folder size={14} />
                    </button>
                  )}
                  {record.state === "failed" && (
                    <button
                      className={styles.actionBtn}
                      title="Retry transfer"
                      aria-label="Retry transfer"
                      onClick={() => on_retry_transfer?.(record)}
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
