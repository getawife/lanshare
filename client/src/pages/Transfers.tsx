import React, { useState } from "react";
import { ArrowUp, ArrowDown, Folder, RotateCcw, Star, X } from "lucide-react";
import { device, transfer_record } from "../shared/types";
import styles from "./Transfers.module.css";

type transfers_tab = "history" | "trusted";

interface transfers_props {
  records: transfer_record[];
  trusted_devices: device[];
  on_clear_history: () => void;
  on_retry_transfer?: (record: transfer_record) => void;
  on_toggle_trust: (device: device, trusted: boolean) => void;
}

export const Transfers: React.FC<transfers_props> = ({
  records,
  trusted_devices,
  on_clear_history,
  on_retry_transfer,
  on_toggle_trust,
}) => {
  const [active_tab, set_active_tab] = useState<transfers_tab>("history");

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
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Transfers views">
        <button
          type="button"
          role="tab"
          aria-selected={active_tab === "history"}
          className={`${styles.tab} ${
            active_tab === "history" ? styles.tabActive : ""
          }`}
          onClick={() => set_active_tab("history")}
        >
          History
          {records.length > 0 && (
            <span className={styles.tabBadge}>{records.length}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active_tab === "trusted"}
          className={`${styles.tab} ${
            active_tab === "trusted" ? styles.tabActive : ""
          }`}
          onClick={() => set_active_tab("trusted")}
        >
          Trusted
          {trusted_devices.length > 0 && (
            <span className={styles.tabBadge}>{trusted_devices.length}</span>
          )}
        </button>
      </div>

      {active_tab === "history" ? (
        <>
          {records.length > 0 && (
            <div className={styles.historyActions}>
              <button
                className={styles.clearBtn}
                onClick={on_clear_history}
                aria-label="Clear transfer history"
              >
                Clear History
              </button>
            </div>
          )}

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
                        className={`${styles.statusBadge} ${
                          styles[record.state]
                        }`}
                      >
                        {record.state}
                      </span>
                    </div>

                    <div className={styles.actionsCol}>
                      {record.state === "completed" &&
                        record.files[0]?.path && (
                          <button
                            className={styles.actionBtn}
                            title="Open in folder"
                            aria-label="Open in folder"
                            onClick={() =>
                              window.electronAPI?.openFolder?.(
                                record.files[0]!.path,
                              )
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
        </>
      ) : trusted_devices.length === 0 ? (
        <div className={styles.emptyState}>
          <b>No trusted devices</b>
          <p>
            Star a device from the Devices tab to trust it. Trusted devices can
            auto-accept transfers and don't trigger notifications.
          </p>
        </div>
      ) : (
        <div className={styles.listWrapper}>
          <div
            className={styles.list}
            role="feed"
            aria-label="Trusted devices list"
          >
            {trusted_devices.map((device) => (
              <div key={device.id} className={styles.row}>
                <div className={styles.iconCol} aria-hidden="true">
                  <Star
                    size={14}
                    className={styles.trustedStar}
                    fill="currentColor"
                  />
                </div>

                <div className={styles.infoCol}>
                  <div className={styles.fileName}>{device.name}</div>
                  <div className={styles.meta}>
                    {device.os} · {device.ip}
                  </div>
                </div>

                <div className={styles.actionsCol}>
                  <button
                    className={styles.actionBtn}
                    title="Remove from trusted"
                    aria-label={`Remove ${device.name} from trusted devices`}
                    onClick={() => on_toggle_trust(device, false)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
