import React, { useState } from "react";
import { ArrowUp, ArrowDown, Folder, RotateCcw, Star, X } from "lucide-react";
import { device, transfer_record } from "../shared/types";
import { format_bytes } from "../shared/format.ts";
import styles from "./Transfers.module.css";

type transfers_tab = "history" | "trusted";

interface transfers_props {
  records: transfer_record[];
  trusted_devices: device[];
  on_clear_history: () => void;
  on_open_folder: (path: string) => void;
  on_retry_transfer?: (record: transfer_record) => void;
  on_toggle_trust: (device: device, trusted: boolean) => void;
}

export const Transfers: React.FC<transfers_props> = ({
  records,
  trusted_devices,
  on_clear_history,
  on_open_folder,
  on_retry_transfer,
  on_toggle_trust,
}) => {
  const [active_tab, set_active_tab] = useState<transfers_tab>("history");
  const [device_filter, set_device_filter] = useState("");
  const [status_filter, set_status_filter] = useState("");
  const [direction_filter, set_direction_filter] = useState("");
  const [date_filter, set_date_filter] = useState("");

  const filters_active = Boolean(
    device_filter || status_filter || direction_filter || date_filter,
  );
  const filtered_records = records.filter((record) => {
    if (device_filter === "macOS" && record.device_os !== "macOS") {
      return false;
    }
    if (device_filter === "Linux" && record.device_os !== "Linux") {
      return false;
    }
    if (
      device_filter === "Windows" &&
      record.device_os !== "Windows 10" &&
      record.device_os !== "Windows 11"
    ) {
      return false;
    }
    if (status_filter === "failed" && record.state !== "failed") return false;
    if (status_filter === "completed" && record.state !== "completed")
      return false;
    if (direction_filter && record.direction !== direction_filter) return false;
    if (date_filter) {
      const date = record.timestamp;
      const local_date = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");
      if (local_date !== date_filter) return false;
    }
    return true;
  });

  const clear_filters = () => {
    set_device_filter("");
    set_status_filter("");
    set_direction_filter("");
    set_date_filter("");
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
            <>
              <div className={styles.historyActions}>
                <div
                  className={styles.filters}
                  role="group"
                  aria-label="Filter transfer history"
                >
                  <label className={styles.filterField}>
                    <span>Device</span>
                    <select
                      value={device_filter}
                      onChange={(event) => set_device_filter(event.target.value)}
                    >
                      <option value="">All devices</option>
                      <option value="macOS">Mac</option>
                      <option value="Linux">Linux</option>
                      <option value="Windows">Windows</option>
                    </select>
                  </label>
                  <label className={styles.filterField}>
                    <span>Status</span>
                    <select
                      value={status_filter}
                      onChange={(event) => set_status_filter(event.target.value)}
                    >
                      <option value="">All statuses</option>
                      <option value="failed">Failed</option>
                      <option value="completed">Successful</option>
                    </select>
                  </label>
                  <label className={styles.filterField}>
                    <span>Direction</span>
                    <select
                      value={direction_filter}
                      onChange={(event) =>
                        set_direction_filter(event.target.value)
                      }
                    >
                      <option value="">Both directions</option>
                      <option value="outgoing">Sent</option>
                      <option value="incoming">Received</option>
                    </select>
                  </label>
                  <label className={styles.filterField}>
                    <span>Date</span>
                    <input
                      type="date"
                      value={date_filter}
                      onChange={(event) => set_date_filter(event.target.value)}
                    />
                  </label>
                  {filters_active && (
                    <button
                      type="button"
                      className={styles.clearFiltersBtn}
                      onClick={clear_filters}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
                <button
                  className={styles.clearBtn}
                  onClick={on_clear_history}
                  aria-label="Clear transfer history"
                >
                  Clear History
                </button>
              </div>
              <p className={styles.resultCount} aria-live="polite">
                Showing {filtered_records.length} of {records.length} transfers
              </p>
            </>
          )}

          {records.length === 0 ? (
            <div className={styles.emptyState}>
              <b>No recent file transfers</b>
              <p>Transfers you send or receive will appear here.</p>
            </div>
          ) : filtered_records.length === 0 ? (
            <div className={styles.emptyState}>
              <b>No transfers match these filters</b>
              <p>Clear filters to see all transfer history.</p>
            </div>
          ) : (
            <div className={styles.listWrapper}>
              <div
                className={styles.list}
                role="feed"
                aria-label="Transfer history list"
              >
                {filtered_records.map((record) => (
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
                        · {format_bytes(record.total_size_bytes)}
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
                              on_open_folder(record.files[0]!.path)
                            }
                          >
                            <Folder size={14} />
                          </button>
                        )}
                      {record.state === "failed" && (
                        <button
                          className={styles.actionBtn}
                          title="Resume transfer"
                          aria-label="Resume transfer"
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
                  <div className={styles.meta}>{device.ip}</div>
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
