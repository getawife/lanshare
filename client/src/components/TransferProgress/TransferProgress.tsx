import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, FileText, ShieldAlert } from "lucide-react";
import { transfer_record } from "../../shared/types";
import { format_bytes, format_speed } from "../../shared/format.ts";
import { visually_hidden } from "../../shared/a11y.ts";
import styles from "./TransferProgress.module.css";

interface transfer_progress_props {
  transfer: transfer_record;
  on_cancel?: (() => void) | undefined;
}

export const TransferProgress: React.FC<transfer_progress_props> = ({
  transfer,
  on_cancel,
}) => {
  const percentage = Math.min(
    100,
    Math.round(
      (transfer.bytes_transferred / Math.max(transfer.total_size_bytes, 1)) *
        100,
    ) || 0,
  );

  const is_incoming = transfer.direction === "incoming";
  const file_count = transfer.files.length;
  const file_word = file_count === 1 ? "file" : "files";
  const is_finished = transfer.state === "completed";
  const is_ended =
    is_finished ||
    transfer.state === "failed" ||
    transfer.state === "cancelled";
  const summary = is_incoming
    ? `Receiving ${file_count} ${file_word} from ${transfer.device_name}`
    : `Sending ${file_count} ${file_word} to ${transfer.device_name}`;

  const [announcement, set_announcement] = useState("");
  const last_bucket = useRef(0);

  useEffect(() => {
    set_announcement(summary);
    last_bucket.current = 0;
  }, [transfer.id]);

  useEffect(() => {
    if (is_ended) return;
    const bucket = Math.floor(percentage / 25);
    if (bucket > last_bucket.current) {
      last_bucket.current = bucket;
      set_announcement(
        `${percentage} percent ${is_incoming ? "received" : "sent"}`,
      );
    }
  }, [percentage, is_ended, is_incoming]);

  return (
    <div
      className={styles.card}
      role="region"
      aria-label={`Transfer progress for ${transfer.device_name}`}
    >
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.title}>
            {is_finished ? "Transfer complete" : summary}
          </span>
          <span className={styles.subtitle}>
            {is_finished
              ? "Ready for the next transfer"
              : "Keep Lanshare open until the transfer finishes."}
          </span>
        </div>
        <span className={styles.percentage} aria-hidden="true">
          {percentage}%
        </span>
      </div>

      <div className={styles.detailContainer}>
        <div className={styles.detailRow}>
          <FileText size={16} className={styles.fileIcon} aria-hidden="true" />
          <span className={styles.fileTarget}>
            {transfer.files[0]?.name || "Files"}
            {transfer.files.length > 1 &&
              ` (+${transfer.files.length - 1} more)`}
          </span>
        </div>
      </div>

      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-label="Transfer progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        aria-valuetext={`${percentage} percent, ${format_bytes(transfer.bytes_transferred)} of ${format_bytes(transfer.total_size_bytes)}`}
      >
        <div
          className={styles.progressBar}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className={styles.progressCopy}>
        <span>
          <Clock size={13} aria-hidden="true" />{" "}
          {format_bytes(transfer.bytes_transferred)} /{" "}
          {format_bytes(transfer.total_size_bytes)}
        </span>
        <span>{format_speed(transfer.speed_bytes_per_sec)}</span>
      </div>

      <div className={styles.footer}>
        <span className={styles.metrics}>
          {is_finished ? (
            <>
              <CheckCircle2
                size={16}
                style={{ color: "#32d74b" }}
                aria-hidden="true"
              />{" "}
              Complete
            </>
          ) : transfer.state === "failed" ? (
            <>
              <ShieldAlert
                size={16}
                style={{ color: "#ff453a" }}
                aria-hidden="true"
              />{" "}
              Interrupted
            </>
          ) : (
            <>
              <span className={styles.statusDot} aria-hidden="true" /> In
              progress
            </>
          )}
        </span>
        {!is_finished && on_cancel && (
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={on_cancel}
            aria-label="Cancel active transfer"
          >
            Cancel
          </button>
        )}
      </div>

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={visually_hidden}
      >
        {announcement}
      </div>
    </div>
  );
};
