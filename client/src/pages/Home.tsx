import React, { useMemo, useState, useEffect } from "react";
import {
  AlertCircle,
  CircleDashed,
  RefreshCw,
  MonitorX,
  ChevronDown,
} from "lucide-react";
import { device, file_item, transfer_record } from "../shared/types";
import { DeviceCard } from "../components/DeviceCard/DeviceCard";
import { DropZone } from "../components/DropZone/DropZone";
import { SendConfirmation } from "../components/SendConfirmation/SendConfirmation";
import { TransferProgress } from "../components/TransferProgress/TransferProgress";
import { IncomingTransfer } from "../components/IncomingTransfer/IncomingTransfer";
import styles from "./Home.module.css";

interface home_props {
  devices: device[];
  on_refresh_devices: () => void;
  is_refreshing?: boolean;
  active_transfer?: transfer_record | undefined;
  on_initiate_transfer: (device: device, files: file_item[]) => void;
  on_cancel_transfer: () => void;
  discovery_status: "discovering" | "found" | "empty";
  is_connected: boolean;
  network_warnings?: string[];
  on_notify?: (title: string, details: string, code?: string) => void;
}

export const Home: React.FC<home_props> = ({
  devices,
  on_refresh_devices,
  is_refreshing = false,
  active_transfer,
  on_initiate_transfer,
  on_cancel_transfer,
  discovery_status,
  is_connected,
  network_warnings = [],
  on_notify,
}) => {
  const [selected_device_id, set_selected_device_id] = useState<string | null>(
    null,
  );

  const selected_device = useMemo(
    () => devices.find((d) => d.id === selected_device_id) ?? null,
    [devices, selected_device_id],
  );

  useEffect(() => {
    if (!selected_device_id) return;

    const device_exists = devices.some((d) => d.id === selected_device_id);
    if (!device_exists) {
      const old_device = devices.find((d) => d.name === selected_device?.name);
      if (old_device) {
        set_selected_device_id(old_device.id);
      } else {
        set_selected_device_id(null);
        set_staged_files(null);
      }
    }
  }, [devices, selected_device_id, selected_device?.name]);

  const [staged_files, set_staged_files] = useState<file_item[] | null>(null);
  const [is_dragging, set_is_dragging] = useState(false);
  const [show_troubleshooting, set_show_troubleshooting] = useState(false);

  const is_sending = Boolean(active_transfer);
  const has_devices = devices.length > 0;
  const has_recipient = Boolean(selected_device);
  const drop_zone_enabled = has_recipient && !is_sending;

  const header_label = useMemo(() => {
    if (is_sending) return "Transfer in progress";
    if (!has_devices)
      return discovery_status === "discovering"
        ? "Looking for devices"
        : "Nearby devices";
    if (has_recipient) return `Send to ${selected_device?.name}`;
    return "Choose a device to continue";
  }, [
    discovery_status,
    has_devices,
    has_recipient,
    is_sending,
    selected_device?.name,
  ]);

  const handle_drag_over = (e: React.DragEvent) => {
    e.preventDefault();
    set_is_dragging(true);
  };

  const handle_drag_leave = () => {
    set_is_dragging(false);
  };

  const handle_drop = (e: React.DragEvent) => {
    e.preventDefault();
    set_is_dragging(false);
    if (!has_recipient) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files: file_item[] = Array.from(e.dataTransfer.files).map((f) => ({
        name: f.name,
        path: f.path,
        size: f.size,
        is_dir: false,
      }));
      set_staged_files(files);
    }
  };

  const handle_select_files = async () => {
    if (!has_recipient) return;
    const files = await window.electronAPI?.selectFiles();
    if (files) set_staged_files(files);
  };

  const handle_select_folder = async () => {
    if (!has_recipient) return;
    const folder = await window.electronAPI?.selectFolder();
    if (folder) set_staged_files([folder]);
  };

  const clear_selection = () => {
    set_selected_device_id(null);
    set_staged_files(null);
  };

  return (
    <div
      className={styles.container}
      onDragOver={handle_drag_over}
      onDragLeave={handle_drag_leave}
      onDrop={handle_drop}
    >
      <div className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>{header_label}</h1>
          <div className={styles.subtitle}>
            {is_sending
              ? "The recipient stays visible while the transfer completes."
              : has_devices
                ? has_recipient
                  ? "Files and folders can be added now."
                  : `${devices.length} device${devices.length === 1 ? "" : "s"} discovered on the network.`
                : discovery_status === "discovering"
                  ? "Checking the local network for nearby Lanshare devices."
                  : "Open Lanshare on the other device and keep both devices on the same network."}
          </div>
        </div>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={on_refresh_devices}
          disabled={is_refreshing}
          title="Scan again"
          aria-label="Scan again"
        >
          <RefreshCw
            size={14}
            className={is_refreshing ? styles.spinning : ""}
          />
        </button>
      </div>

      {discovery_status === "discovering" && !has_devices && (
        <div className={styles.discoveryBar} aria-live="polite">
          <CircleDashed size={14} className={styles.spinning} />
          <span>Scanning for devices…</span>
        </div>
      )}

      {!has_devices ? (
        <section className={styles.emptyState} aria-label="No nearby devices">
          <MonitorX size={32} className={styles.emptyIcon} />
          <div className={styles.emptyTitle}>No nearby devices</div>
          <div className={styles.emptyText}>
            Make sure Lanshare is open on the other device and both devices are
            connected to the same network.
          </div>
          <div className={styles.emptyActions}>
            <button
              className={styles.scanBtn}
              onClick={on_refresh_devices}
              disabled={is_refreshing}
            >
              <RefreshCw
                size={14}
                className={is_refreshing ? styles.spinning : ""}
              />
              <span>{is_refreshing ? "Scanning…" : "Scan Again"}</span>
            </button>
            <button
              className={styles.troubleshootBtn}
              onClick={() => set_show_troubleshooting((value) => !value)}
              aria-expanded={show_troubleshooting}
            >
              Having trouble?
              <ChevronDown
                size={14}
                className={
                  show_troubleshooting ? styles.chevronOpen : styles.chevron
                }
              />
            </button>
          </div>
          {show_troubleshooting && (
            <div
              className={styles.troubleshooting}
              aria-label="Troubleshooting tips"
            >
              {network_warnings.length > 0 && (
                <div
                  style={{
                    color: "#fbbf24",
                    fontWeight: 600,
                    marginBottom: "4px",
                  }}
                >
                  Active Network Issues:
                  {network_warnings.map((w, i) => (
                    <div
                      key={i}
                      style={{
                        fontWeight: 400,
                        marginTop: "2px",
                        color: "#fde68a",
                      }}
                    >
                      • {w}
                    </div>
                  ))}
                </div>
              )}
              <div>Confirm both devices are on the same LAN</div>
              <div>
                Check firewall permissions (allow LANShare on Private Networks)
              </div>
              <div>Check whether a VPN or virtual adapter is interfering</div>
              <div>Confirm Lanshare is running on the recipient device</div>
              <div>Check network discovery restrictions</div>
            </div>
          )}
        </section>
      ) : (
        <section className={styles.deviceSection}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionMeta}>
                {discovery_status === "discovering" && " · discovering"}
              </div>
            </div>
            {has_recipient && (
              <button
                className={styles.clearSelectionBtn}
                onClick={clear_selection}
              >
                Change device
              </button>
            )}
          </div>

          <div className={styles.deviceGrid}>
            {devices.map((device) => (
              <DeviceCard
                key={`${device.name.toLowerCase().trim()}-${device.ip}`}
                device={device}
                is_selected={selected_device_id === device.id}
                on_select={(dev) => set_selected_device_id(dev.id)}
                action_label={
                  selected_device_id === device.id
                    ? "Selected"
                    : "Send to this device"
                }
              />
            ))}
          </div>
        </section>
      )}

      {(has_devices || active_transfer) && (
        <section className={styles.transferArea}>
          {active_transfer ? (
            active_transfer.direction === "incoming" ? (
              <IncomingTransfer
                transfer={active_transfer}
                on_accept={async () => {
                  if (!active_transfer) return;
                  const resp = await window.electronAPI?.transferRespond?.(
                    active_transfer.id,
                    true,
                  );
                  if (resp?.ok) {
                  } else {
                    try {
                      const body = resp?.body || "";
                      let parsed = null as any;
                      try {
                        parsed = JSON.parse(body);
                      } catch {}
                      const code = parsed?.code ?? undefined;
                      const message =
                        parsed?.message ??
                        (body ? String(body) : "Failed to accept transfer");
                      if (on_notify)
                        on_notify("Failed to accept transfer", message, code);
                    } catch (e) {
                      if (on_notify)
                        on_notify(
                          "Failed to accept transfer",
                          "An unknown error occurred",
                        );
                    }
                    on_cancel_transfer();
                  }
                }}
                on_decline={async () => {
                  if (!active_transfer) return;
                  const resp = await window.electronAPI?.transferRespond?.(
                    active_transfer.id,
                    false,
                  );
                  if (resp && !resp.ok) {
                    try {
                      const body = resp?.body || "";
                      let parsed = null as any;
                      try {
                        parsed = JSON.parse(body);
                      } catch {}
                      const code = parsed?.code ?? undefined;
                      const message =
                        parsed?.message ??
                        (body ? String(body) : "Failed to decline transfer");
                      if (on_notify)
                        on_notify("Failed to decline transfer", message, code);
                    } catch (e) {
                      if (on_notify)
                        on_notify(
                          "Failed to decline transfer",
                          "An unknown error occurred",
                        );
                    }
                  }
                  on_cancel_transfer();
                }}
              />
            ) : (
              <TransferProgress
                transfer={active_transfer}
                on_cancel={on_cancel_transfer}
              />
            )
          ) : has_recipient ? (
            <DropZone
              is_dragging={is_dragging}
              selected_device_name={selected_device?.name}
              has_recipient={drop_zone_enabled}
              staged_count={staged_files?.length ?? 0}
              on_select_files={handle_select_files}
              on_select_folder={handle_select_folder}
            />
          ) : (
            <div className={styles.guidanceState}>
              <div className={styles.guidanceTitle}>
                Select a device to start sending
              </div>
              <div className={styles.guidanceText}>
                Files and folders can be added once you choose a recipient.
              </div>
            </div>
          )}
        </section>
      )}

      {staged_files && selected_device && !active_transfer && (
        <SendConfirmation
          device={selected_device}
          files={staged_files}
          on_cancel={() => set_staged_files(null)}
          on_send={() => {
            on_initiate_transfer(selected_device, staged_files);
            set_staged_files(null);
          }}
        />
      )}

      {is_dragging && !has_recipient && (
        <div className={styles.dragHint} role="status" aria-live="polite">
          Select a device first to send files.
        </div>
      )}
    </div>
  );
};
