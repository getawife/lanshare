import React from "react";
import { ShieldCheck, FileText } from "lucide-react";
import { transfer_record } from "../../shared/types";
import { format_bytes } from "../../shared/format.ts";
import { use_dialog_focus } from "../../shared/use_dialog_focus.ts";
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
  const dialog_ref = use_dialog_focus<HTMLDivElement>({
    initial_focus: "[data-initial-focus]",
  });

  const file_name = transfer.files[0]?.name || "Unknown File";
  const file_count = transfer.files.length;
  const additional_files_count = file_count - 1;

  return (
    <div
      ref={dialog_ref}
      tabIndex={-1}
      className={styles.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="incoming-transfer-title"
      aria-describedby="incoming-transfer-desc"
    >
      <div className={styles.card}>
        <div className={styles.titleRow}>
          <span className={styles.sender} id="incoming-transfer-title">
            <strong>{transfer.device_name}</strong> wants to share{" "}
            {file_count > 1 ? `${file_count} files` : "a file"}
          </span>
          {is_trusted && (
            <span className={styles.trusted} title="Verified local device">
              <ShieldCheck size={12} strokeWidth={2.5} aria-hidden="true" />
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
              {format_bytes(transfer.total_size_bytes)}
            </span>
          </div>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            data-initial-focus
            className={styles.declineBtn}
            onClick={on_decline}
            aria-label={`Decline transfer from ${transfer.device_name}`}
          >
            Decline
          </button>
          <button
            type="button"
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
