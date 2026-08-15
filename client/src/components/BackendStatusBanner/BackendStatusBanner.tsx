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
import { BackendStatus } from "../../shared/types";
import styles from "./BackendStatusBanner.module.css";

interface BackendStatusBannerProps {
  status: BackendStatus | null;
  onRestart: () => Promise<void>;
  isRestarting?: boolean;
}

export const BackendStatusBanner: React.FC<BackendStatusBannerProps> = ({
  status,
  onRestart,
  isRestarting = false,
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  if (!status) return null;

  const isError = status.state === "error" || status.state === "stopped";
  const hasWarnings = (status.networkWarnings && status.networkWarnings.length > 0) || false;

  if (!isError && !hasWarnings) return null;
  if (!isError && isDismissed) return null;

  const getTitleAndDescription = () => {
    if (isError) {
      switch (status.code) {
        case "PORT_IN_USE":
          return {
            title: "Port Conflict: Backend Service Blocked",
            icon: <AlertOctagon size={18} />,
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
            title: "Firewall / Security Restriction Detected",
            icon: <ShieldAlert size={18} />,
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
            title: "Backend Executable Not Found",
            icon: <AlertTriangle size={18} />,
            message:
              status.error ||
              "The local Go backend engine or binary could not be found.",
            tips: [
              "If running in development mode, ensure Go is installed and available in your PATH.",
              "If packaged, verify the installation directory contains lanshare-backend.",
            ],
          };
        case "HEALTHCHECK_TIMEOUT":
          return {
            title: "Backend Health Check Timed Out",
            icon: <AlertTriangle size={18} />,
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
            icon: <AlertOctagon size={18} />,
            message:
              status.error ||
              "The local communication engine is offline. Device discovery and file transfers are disabled.",
            tips: [
              "Click 'Restart Service' to launch the background engine.",
              "Check technical logs below for more details.",
            ],
          };
      }
    }

    return {
      title: "Network Restrictions Detected",
      icon: <WifiOff size={18} />,
      message:
        "Local network discovery may be limited due to current network adapter or firewall settings.",
      tips: [
        "Ensure both sending and receiving devices are connected to the same Wi-Fi or LAN.",
        "Ensure your Windows network profile is set to 'Private' rather than 'Public'.",
      ],
    };
  };

  const { title, icon, message, tips } = getTitleAndDescription();

  return (
    <div className={styles.bannerContainer} role="alert" aria-live="assertive">
      <div
        className={`${styles.banner} ${
          isError ? styles.errorBanner : styles.warningBanner
        }`}
      >
        <div className={styles.bannerMain}>
          <div
            className={`${styles.iconWrapper} ${
              isError ? styles.errorIcon : styles.warningIcon
            }`}
          >
            {icon}
          </div>

          <div className={styles.contentWrapper}>
            <div className={styles.headerRow}>
              <span className={styles.title}>{title}</span>
              {!isError && (
                <button
                  type="button"
                  className={styles.dismissBtn}
                  onClick={() => setIsDismissed(true)}
                  title="Dismiss warning"
                  aria-label="Dismiss warning"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className={styles.message}>{message}</div>

            {hasWarnings && (
              <ul className={styles.warningsList}>
                {status.networkWarnings?.map((w, idx) => (
                  <li key={idx} className={styles.warningItem}>
                    {w}
                  </li>
                ))}
              </ul>
            )}

            <div className={styles.actionsRow}>
              {isError && (
                <button
                  type="button"
                  className={styles.restartBtn}
                  onClick={onRestart}
                  disabled={isRestarting}
                >
                  <RefreshCw
                    size={13}
                    className={isRestarting ? styles.spinning : ""}
                  />
                  <span>{isRestarting ? "Restarting…" : "Restart Service"}</span>
                </button>
              )}

              {(status.errorDetails || tips.length > 0) && (
                <button
                  type="button"
                  className={styles.detailsToggleBtn}
                  onClick={() => setShowDetails((prev) => !prev)}
                >
                  <span>{showDetails ? "Hide Details" : "Troubleshooting & Logs"}</span>
                  {showDetails ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              )}
            </div>

            {showDetails && (
              <div className={styles.detailsContainer}>
                {tips.length > 0 && (
                  <div className={styles.troubleshootTips}>
                    <span className={styles.detailsHeader}>Suggested Steps:</span>
                    {tips.map((tip, idx) => (
                      <div key={idx} className={styles.troubleshootItem}>
                        <span className={styles.troubleshootDot} />
                        <span>{tip}</span>
                      </div>
                    ))}
                  </div>
                )}

                {status.errorDetails && (
                  <>
                    <span className={styles.detailsHeader}>System Output / Logs:</span>
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
