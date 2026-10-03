import React, { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { device } from "../../shared/types";
import { format_fingerprint } from "../../shared/format";
import { use_dialog_focus } from "../../shared/use_dialog_focus";
import styles from "./TrustVerification.module.css";

interface trust_verification_props {
  device: device | null;
  on_confirm: (device: device) => void;
  on_cancel: () => void;
}

interface trust_dialog_props {
  device: device;
  on_confirm: (device: device) => void;
  on_cancel: () => void;
}

const TrustDialog: React.FC<trust_dialog_props> = ({
  device,
  on_confirm,
  on_cancel,
}) => {
  const [compared, set_compared] = useState(false);
  const dialog_ref = use_dialog_focus<HTMLDivElement>({
    on_escape: on_cancel,
    initial_focus: "[data-initial-focus]",
  });
  const fingerprint = format_fingerprint(device.certFp);
  const can_confirm = compared && fingerprint !== "";

  return (
    <div
      ref={dialog_ref}
      tabIndex={-1}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trust-verify-title"
      aria-describedby="trust-verify-desc"
    >
      <div className={styles.card}>
        <div className={styles.titleRow}>
          <span className={styles.title} id="trust-verify-title">
            Verify {device.name} before trusting it
          </span>
        </div>

        <p className={styles.text} id="trust-verify-desc">
          Anyone on your network can pretend to be another device. Open Lanshare
          on {device.name}, go to Settings, and check that its device
          fingerprint matches the one below.
        </p>

        <div className={styles.fingerprint} aria-label="Device fingerprint">
          {fingerprint || "This device has not shared a certificate yet."}
        </div>

        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={compared}
            disabled={fingerprint === ""}
            onChange={(event) => set_compared(event.target.checked)}
          />
          <span>The fingerprints match on both devices</span>
        </label>

        <div className={styles.actions}>
          <button
            type="button"
            data-initial-focus
            className={styles.cancelBtn}
            onClick={on_cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.trustBtn}
            disabled={!can_confirm}
            onClick={() => on_confirm(device)}
          >
            Trust device
          </button>
        </div>
      </div>
    </div>
  );
};

export const TrustVerification: React.FC<trust_verification_props> = ({
  device,
  on_confirm,
  on_cancel,
}) => {
  if (!device) return null;
  return (
    <TrustDialog
      key={device.id}
      device={device}
      on_confirm={on_confirm}
      on_cancel={on_cancel}
    />
  );
};
