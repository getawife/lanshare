import { useEffect, useState } from "react";
import styles from "./UpdateUI.module.css";

type update_state =
  | { status: "idle" }
  | { status: "checking" }
  | {
      status: "downloading";
      percent: number;
      speed?: number;
      transferred?: number;
      total?: number;
    }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

function format_bytes(bytes: number) {
  if (!bytes || bytes < 1024) {
    return `${bytes || 0} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = -1;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(
    value >= 100 ? 0 : value >= 10 ? 1 : 2,
  )} ${units[unit]}`;
}

function format_speed(bytes_per_second: number) {
  if (!bytes_per_second) {
    return "Preparing...";
  }

  return `${format_bytes(bytes_per_second)}/s`;
}

export default function UpdateUI() {
  const [state, set_state] = useState<update_state>({
    status: "idle",
  });

  useEffect(() => {
    const updates = window.electronAPI?.updates;

    if (!updates) {
      return;
    }

    const cleanup: Array<() => void> = [];

    cleanup.push(
      updates.onChecking(() => {
        set_state({
          status: "checking",
        });
      }),
    );

    cleanup.push(
      updates.onAvailable(() => {
        set_state({
          status: "downloading",
          percent: 0,
        });
      }),
    );

    cleanup.push(
      updates.onProgress((progress) => {
        set_state({
          status: "downloading",
          percent: Math.max(0, Math.min(100, progress.percent)),
          speed: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        });
      }),
    );

    cleanup.push(
      updates.onDownloaded((info) => {
        set_state({
          status: "ready",
          version: info.version,
        });
      }),
    );

    cleanup.push(
      updates.onError((error) => {
        set_state({
          status: "error",
          message:
            error.message ??
            "An unexpected error occurred while updating Lanshare.",
        });
      }),
    );

    return () => {
      cleanup.forEach((remove) => remove());
    };
  }, []);

  if (state.status === "idle") {
    return null;
  }

  if (state.status === "checking") {
    return (
      <section className={styles.card} aria-live="polite">
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <span className={styles.title}>Checking for updates</span>

            <span className={styles.subtitle}>
              Looking for a newer version of Lanshare
            </span>
          </div>

          <span className={styles.status}>
            <span className={styles.statusDot} />
            Checking
          </span>
        </div>
      </section>
    );
  }

  if (state.status === "downloading") {
    return (
      <section className={styles.card} aria-live="polite">
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <span className={styles.title}>Updating Lanshare</span>

            <span className={styles.subtitle}>
              The update is downloading in the background
            </span>
          </div>

          <span className={styles.percentage}>
            {Math.round(state.percent)}%
          </span>
        </div>

        <div className={styles.detailContainer}>
          <div className={styles.detailRow}>
            <span className={styles.statusDot} />

            <span>
              Downloading{" "}
              {state.total ? (
                <strong className={styles.fileTarget}>
                  {format_bytes(state.transferred ?? 0)} of{" "}
                  {format_bytes(state.total)}
                </strong>
              ) : (
                <strong className={styles.fileTarget}>update</strong>
              )}
            </span>
          </div>

          <div className={styles.progressTrack}>
            <div
              className={styles.progressBar}
              style={{
                width: `${state.percent}%`,
              }}
            />
          </div>

          <div className={styles.progressCopy}>
            <span>
              {state.speed ? format_speed(state.speed) : "Preparing download"}
            </span>

            <span>{Math.round(state.percent)}%</span>
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.metrics}>
            <span className={styles.statusDot} />

            <span>Update in progress</span>
          </div>

          <span className={styles.backgroundCopy}>Background download</span>
        </div>
      </section>
    );
  }

  if (state.status === "ready") {
    return (
      <section className={`${styles.card} ${styles.ready}`} aria-live="polite">
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <span className={styles.title}>Update ready</span>

            <span className={styles.subtitle}>
              Lanshare {state.version} is ready to install
            </span>
          </div>

          <span className={styles.readyStatus}>Ready</span>
        </div>

        <div className={styles.detailContainer}>
          <div className={styles.detailRow}>
            <span className={styles.readyIcon}>✓</span>

            <span>
              The update has been downloaded and will install when Lanshare
              restarts.
            </span>
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.metrics}>
            <span className={`${styles.statusDot} ${styles.readyDot}`} />

            <span>Lanshare {state.version}</span>
          </div>

          <button
            type="button"
            className={styles.updateBtn}
            onClick={() => window.electronAPI?.updates.install()}
          >
            Restart & Update
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.card} ${styles.error}`} aria-live="polite">
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.title}>Update failed</span>

          <span className={styles.subtitle}>
            Lanshare couldn't download the latest update
          </span>
        </div>

        <span className={styles.errorStatus}>Failed</span>
      </div>

      <div className={styles.detailContainer}>
        <div className={styles.detailRow}>{state.message}</div>
      </div>
    </section>
  );
}
