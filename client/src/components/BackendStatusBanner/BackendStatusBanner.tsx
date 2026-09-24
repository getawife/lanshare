import React, { useState } from "react";
import {
  AlertTriangle,
  AlertOctagon,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  X,
  ShieldAlert,
  WifiOff,
} from "lucide-react";
import { backend_status } from "../../shared/types";
import styles from "./BackendStatusBanner.module.css";

interface backend_status_banner_props {
  status: backend_status | null;
  on_restart: () => Promise<void>;
  is_restarting?: boolean;
}

export const BackendStatusBanner: React.FC<backend_status_banner_props> = ({
  status,
  on_restart,
  is_restarting = false,
}) => {
  const [show_details, set_show_details] = useState(false);
  const [is_dismissed, set_is_dismissed] = useState(false);

  if (!status) return null;

  const is_error = status.state === "error" || status.state === "stopped";
  const has_warnings =
    (status.networkWarnings && status.networkWarnings.length > 0) || false;

  if (!is_error && !has_warnings) return null;
  if (!is_error && is_dismissed) return null;

  const get_title_and_description = () => {
    if (is_error) {
      switch (status.code) {
        case "PORT_IN_USE":
          return {
            title: "Port Conflict Detected",
            icon: <AlertOctagon size={20} strokeWidth={2} />,
            message:
              status.error ||
              "Port 43821 is already occupied by another application or an existing LANShare process.",
            tips: [
              "Close any other LANShare windows or background processes.",
              "Ensure no other local server is using port 43821.",
              "Click 'Restart Service' to attempt binding again.",
            ],
          };
        case "BLOCKED_BY_FIREWALL":
          return {
            title: "Firewall / Security Restriction",
            icon: <ShieldAlert size={20} strokeWidth={2} />,
            message:
              status.error ||
              "LANShare was blocked from starting by system security, Windows Firewall, or antivirus software.",
            tips: [
              "Allow LANShare through Windows Defender Firewall (Private Networks).",
              "Check your third-party antivirus for blocked local loopback sockets.",
              "Verify administrator execution permissions.",
            ],
          };
        case "BINARY_NOT_FOUND":
          return {
            title: "Backend Not Found",
            icon: <AlertTriangle size={20} strokeWidth={2} />,
            message: status.error || "The local Go backend could not be found.",
            tips: [
              "If running in development mode, ensure Go is installed and available in your PATH.",
              "If packaged, verify the installation directory contains lanshare-backend.",
            ],
          };
        case "HEALTHCHECK_TIMEOUT":
          return {
            title: "Backend Timed Out",
            icon: <AlertTriangle size={20} strokeWidth={2} />,
            message:
              status.error ||
              "The backend started but did not respond to local health checks. Localhost connections may be filtered.",
            tips: [
              "Check if proxy, VPN, or firewall software blocks 127.0.0.1 HTTP requests.",
              "Click 'Restart Service' to re-initialize the background worker.",
            ],
          };
        default:
          return {
            title: "Backend Service Unavailable",
            icon: <AlertOctagon size={20} strokeWidth={2} />,
            message:
              status.error ||
              "The backend is offline. Device discovery and file transfers are disabled.",
            tips: [
              "Click 'Restart Service' to launch again.",
              "Check logs below for more details.",
            ],
          };
      }
    }

    return {
      title: "Network Restrictions Detected",
      icon: <WifiOff size={20} strokeWidth={2} />,
      message:
        "Local network discovery may be limited due to current network adapter or firewall settings.",
      tips: [
        "Ensure both sending and receiving devices are connected to the same Wi-Fi or LAN.",
        "Ensure your Windows network profile is set to 'Private' rather than 'Public'.",
      ],
    };
  };

  const { title, icon, message, tips } = get_title_and_description();

  return (
    <div className={styles.bannerContainer} role="alert" aria-live="assertive">
      <div
        className={`${styles.banner} ${
          is_error ? styles.errorBanner : styles.warningBanner
        }`}
      >
        <div className={styles.bannerMain}>
          <div
            className={`${styles.iconWrapper} ${
              is_error ? styles.errorIcon : styles.warningIcon
            }`}
            aria-hidden="true"
          >
            {icon}
          </div>

          <div className={styles.contentWrapper}>
            <div className={styles.headerRow}>
              <span className={styles.title}>{title}</span>
              {!is_error && (
                <button
                  type="button"
                  className={styles.dismissBtn}
                  onClick={() => set_is_dismissed(true)}
                  title="Dismiss warning"
                  aria-label="Dismiss warning"
                >
                  <X size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>

            <div className={styles.message}>{message}</div>

            {has_warnings && (
              <ul className={styles.warningsList}>
                {status.networkWarnings?.map((w, idx) => (
                  <li key={idx} className={styles.warningItem}>
                    {w}
                  </li>
                ))}
              </ul>
            )}

            <div className={styles.actionsRow}>
              {is_error && (
                <button
                  type="button"
                  className={styles.restartBtn}
                  onClick={on_restart}
                  disabled={is_restarting}
                  aria-busy={is_restarting}
                >
                  <RefreshCw
                    size={14}
                    strokeWidth={2.5}
                    className={is_restarting ? styles.spinning : ""}
                  />
                  <span>
                    {is_restarting ? "Restarting…" : "Restart Service"}
                  </span>
                </button>
              )}

              {(status.errorDetails || tips.length > 0) && (
                <button
                  type="button"
                  className={styles.detailsToggleBtn}
                  onClick={() => set_show_details((prev) => !prev)}
                  aria-expanded={show_details}
                >
                  <span>
                    {show_details ? "Hide Details" : "Troubleshooting & Logs"}
                  </span>
                  {show_details ? (
                    <ChevronUp size={14} strokeWidth={2} />
                  ) : (
                    <ChevronDown size={14} strokeWidth={2} />
                  )}
                </button>
              )}
            </div>

            {show_details && (
              <div className={styles.detailsContainer}>
                {tips.length > 0 && (
                  <div className={styles.troubleshootTips}>
                    <span className={styles.detailsHeader}>
                      Suggested Steps
                    </span>
                    {tips.map((tip, idx) => (
                      <div key={idx} className={styles.troubleshootItem}>
                        <span
                          className={styles.troubleshootDot}
                          aria-hidden="true"
                        />
                        <span>{tip}</span>
                      </div>
                    ))}
                  </div>
                )}

                {status.errorDetails && (
                  <>
                    <span className={styles.detailsHeader}>
                      System Output / Logs
                    </span>
                    <pre className={styles.logsBox}>{status.errorDetails}</pre>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
