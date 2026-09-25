import React, { useEffect, useState } from "react";
import { TitleBar } from "./components/TitleBar/TitleBar.js";
import { Navigation, view_tab } from "./components/Navigation/Navigation.js";
import { BackendStatusBanner } from "./components/BackendStatusBanner/BackendStatusBanner.js";
import { Home } from "./pages/Home.js";
import { Transfers } from "./pages/Transfers.js";
import { SettingsPage } from "./pages/Settings.js";
import {
  app_settings,
  backend_status,
  device,
  file_item,
  transfer_record,
} from "./shared/types.js";

type app_notice = {
  id: string;
  title: string;
  details: string;
  code?: string | undefined;
  created_at: number;
};

export const App: React.FC = () => {
  const [active_tab, set_active_tab] = useState<view_tab>("devices");
  const [devices_map, set_devices_map] = useState<Map<string, device>>(
    new Map(),
  );
  const [is_connected, set_is_connected] = useState(false);
  const [backend_status, set_backend_status] = useState<backend_status | null>(
    null,
  );
  const [is_restarting_backend, set_is_restarting_backend] = useState(false);
  const [discovery_status, set_discovery_status] = useState<
    "discovering" | "found" | "empty"
  >("discovering");
  const [active_transfer, set_active_transfer] = useState<transfer_record>();
  const [transfer_history, set_transfer_history] = useState<transfer_record[]>(
    [],
  );
  const [notices, set_notices] = useState<app_notice[]>([]);
  const [expanded_notice_id, set_expanded_notice_id] = useState<string | null>(
    null,
  );
  const [settings, set_settings] = useState<app_settings>({
    deviceName: "Lanshare",
    autoStart: false,
    showNotifications: true,
    downloadFolder: "",
    askBeforeAccepting: true,
    autoAcceptTrusted: false,
    currentNetwork: "Unknown",
    theme: "dark",
  });
  const [settings_loaded, set_settings_loaded] = useState(false);

  const upsert_transfer_record = (record: transfer_record) => {
    set_transfer_history((prev) => {
      const next = prev.filter((item) => item.id !== record.id);
      return [record, ...next];
    });
  };

  const safe_text = (value: string) =>
    value
      .replace(/https?:\/\/[^\s]+/g, "[redacted-url]")
      .replace(/[A-Za-z]:\\[^\s]+/g, "[redacted-path]")
      .replace(/\/(?:[^/\s]+\/)*[^/\s]+/g, "[redacted-path]")
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[redacted-ip]");

  const push_notice = (notice: Omit<app_notice, "id" | "created_at">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    set_notices((prev) =>
      [{ id, created_at: Date.now(), ...notice }, ...prev].slice(0, 3),
    );
    window.setTimeout(() => {
      set_notices((prev) => prev.filter((item) => item.id !== id));
    }, 10000);
  };

  const parse_error_body = async (response?: { body?: string }) => {
    if (!response?.body)
      return {
        code: undefined as string | undefined,
        message: "Something went wrong",
      };
    try {
      const parsed = JSON.parse(response.body) as {
        code?: string;
        message?: string;
      };
      return {
        code: typeof parsed.code === "string" ? parsed.code : undefined,
        message:
          typeof parsed.message === "string"
            ? parsed.message
            : "Something went wrong",
      };
    } catch {
      return {
        code: undefined,
        message: safe_text(response.body || "Something went wrong"),
      };
    }
  };

  const record_from_transfer_event = (payload: any): transfer_record | null => {
    if (!payload?.id) return null;
    const files: file_item[] = Array.isArray(payload.files)
      ? payload.files.map((file: any) => ({
          name:
            file.name ??
            (typeof file.relativePath === "string"
              ? (file.relativePath.split(/[\\/]/).pop() ?? "File")
              : "File"),
          path: file.path ?? "",
          size: Number(file.size ?? file.sizeBytes ?? 0),
          is_dir: Boolean(file.isDir ?? file.isDirectory),
        }))
      : [];
    const total_size = files.reduce(
      (sum: number, file: file_item) => sum + file.size,
      0,
    );
    const total_size_bytes = Number(payload.totalSizeBytes ?? total_size);
    const bytes_transferred = Number(
      payload.bytesTransferred ??
        (payload.state === "completed" ? total_size_bytes : 0),
    );
    return {
      id: String(payload.id),
      direction: payload.direction === "incoming" ? "incoming" : "outgoing",
      device_name: payload.deviceName ?? payload.peerName ?? "Nearby device",
      files,
      total_size_bytes,
      bytes_transferred,
      speed_bytes_per_sec: Number(payload.speedBytesPerSec ?? 0),
      state: payload.state ?? "pending",
      timestamp: new Date(),
      error_message: payload.errorMessage,
    };
  };

  const [is_refreshing, set_is_refreshing] = useState(false);

  const handle_refresh_devices = async () => {
    set_is_refreshing(true);
    set_discovery_status("discovering");
    await fetch_state();
    setTimeout(() => {
      set_is_refreshing(false);
    }, 700);
  };

  const fetch_state = async () => {
    try {
      const status = await window.electronAPI?.getBackendStatus?.();
      if (status) {
        set_backend_status(status);
      }
      const state = await window.electronAPI?.getBackendState?.();
      const peers: device[] = state?.peers ?? [];

      set_devices_map((prev_map) => {
        const current_ids = new Set<string>();
        for (const peer of peers) {
          current_ids.add(peer.id);
          prev_map.set(peer.id, peer);
        }

        for (const id of prev_map.keys()) {
          if (!current_ids.has(id)) {
            prev_map.delete(id);
          }
        }

        return prev_map;
      });

      set_is_connected(true);
      set_discovery_status(peers.length > 0 ? "found" : "empty");
    } catch {
      set_is_connected(false);
      set_discovery_status("discovering");
      const status = await window.electronAPI?.getBackendStatus?.();
      if (status) set_backend_status(status);
    }
  };

  const handle_restart_backend = async () => {
    set_is_restarting_backend(true);
    try {
      const status = await window.electronAPI?.restartBackend?.();
      if (status) {
        set_backend_status(status);
      }
      await fetch_state();
    } catch (err: any) {
      push_notice({
        title: "Restart Failed",
        details: err?.message || "Failed to restart backend engine.",
      });
    } finally {
      set_is_restarting_backend(false);
    }
  };

  useEffect(() => {
    void fetch_state();
    const timer = window.setInterval(fetch_state, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.electronAPI?.getSettings().then((saved) => {
      if (saved) set_settings((prev) => ({ ...prev, ...saved, theme: "dark" }));
      set_settings_loaded(true);
    });
  }, []);

  useEffect(() => {
    let source: EventSource | undefined;
    let cancelled = false;

    const connect_events = async () => {
      const backend_url = await window.electronAPI?.getBackendUrl?.();
      if (cancelled || !backend_url) return;
      source = new EventSource(`${backend_url}/api/events`);

      source.addEventListener("peer", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const new_device: device | undefined = payload?.data;
          if (!new_device || !new_device.id) return;

          set_devices_map((prev_map) => {
            prev_map.set(new_device.id, new_device);
            return prev_map;
          });

          set_discovery_status("found");
        } catch {
          void 0;
        }
      });

      source.addEventListener("transfer", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const record = record_from_transfer_event(payload?.data);
          if (!record) return;
          upsert_transfer_record(record);

          if (record.state === "transferring") {
            set_active_transfer(record);
            return;
          }

          if (
            record.state === "completed" ||
            record.state === "failed" ||
            record.state === "cancelled"
          ) {
            set_active_transfer((current) =>
              current?.id === record.id ? undefined : current,
            );

            const file_count = record.files.length;
            const file_word = file_count === 1 ? "file" : "files";

            if (record.state === "completed") {
              const title =
                record.direction === "outgoing"
                  ? "Transfer complete"
                  : "Files received";
              const body =
                record.direction === "outgoing"
                  ? `Sent ${file_count} ${file_word} to ${record.device_name}`
                  : `Received ${file_count} ${file_word} from ${record.device_name}`;
              void window.electronAPI?.notify?.(title, body);
            } else if (record.state === "failed") {
              void window.electronAPI?.notify?.(
                "Transfer failed",
                `Could not transfer ${file_word} with ${record.device_name}`,
              );
            }
          }
        } catch {
          void 0;
        }
      });

      source.addEventListener("incoming-transfer-request", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data)?.data;
          if (!payload || !payload.transferId) return;
          const files: file_item[] = Array.isArray(payload.files)
            ? payload.files.map((f: any) => ({
                name:
                  f.name ??
                  (typeof f.relativePath === "string"
                    ? (f.relativePath.split(/[\\/]/).pop() ?? "File")
                    : "File"),
                path: "",
                size: Number(f.size ?? 0),
                is_dir: Boolean(f.isDir ?? false),
              }))
            : [];
          const record: transfer_record = {
            id: String(payload.transferId),
            direction: "incoming",
            device_name:
              payload.deviceName ?? payload.peerId ?? "Nearby device",
            files,
            total_size_bytes: files.reduce((s, f) => s + f.size, 0),
            bytes_transferred: 0,
            speed_bytes_per_sec: 0,
            state: "pending",
            timestamp: new Date(),
          };
          upsert_transfer_record(record);
          set_active_transfer(record);
          set_active_tab("devices");

          const file_count = record.files.length;
          const file_word = file_count === 1 ? "file" : "files";
          void window.electronAPI?.notify?.(
            `${record.device_name} wants to send you ${file_count} ${file_word}`,
            "Open Lanshare to accept or decline.",
          );
        } catch {
          void 0;
        }
      });
    };

    void connect_events();
    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);

  useEffect(() => {
    if (!settings_loaded) return;
    void window.electronAPI?.saveSettings(settings);
  }, [settings, settings_loaded]);

  const handle_initiate_transfer = async (
    device: device,
    files: file_item[],
  ) => {
    if (!files.length) return;
    const total_size = files.reduce(
      (sum: number, file: file_item) => sum + file.size,
      0,
    );
    const transfer_id = String(Date.now());
    const record: transfer_record = {
      id: transfer_id,
      direction: "outgoing",
      device_name: device.name,
      files,
      total_size_bytes: total_size,
      bytes_transferred: 0,
      speed_bytes_per_sec: 0,
      state: "transferring",
      timestamp: new Date(),
    };
    set_active_transfer(record);

    try {
      const response = await window.electronAPI?.fetchBackend?.(
        "/api/transfer",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            transferId: transfer_id,
            peerId: device.id,
            files: files.map((file) => ({
              path: file.path,
              name: file.name,
              size: file.size,
              isDir: file.is_dir,
            })),
          }),
        },
      );

      if (!response?.ok) {
        const parsed = await parse_error_body(response);
        push_notice({
          title: parsed.code
            ? `Transfer failed (${parsed.code})`
            : "Transfer failed",
          code: parsed.code ?? undefined,
          details: parsed.message,
        });
        const failed = {
          ...record,
          state: "failed" as const,
          error_message: parsed.message,
        };
        set_active_transfer(undefined);
        upsert_transfer_record(failed);
        return;
      }
    } catch (error) {
      const failed = { ...record, state: "failed" as const };
      set_active_transfer(undefined);
      upsert_transfer_record(failed);
      const details =
        error instanceof Error ? safe_text(error.message) : "Unknown error";
      push_notice({
        title: "Transfer failed",
        details,
      });
    }
  };

  const handle_retry_transfer = (record: transfer_record) => {
    if (record.direction !== "outgoing" || !record.files.length) {
      push_notice({
        title: "Cannot retry transfer",
        details:
          "Only outgoing transfers with valid source files can be retried.",
      });
      return;
    }
    const matching_device = Array.from(devices_map.values()).find(
      (d) =>
        d.name.toLowerCase().trim() === record.device_name.toLowerCase().trim(),
    );
    if (!matching_device) {
      push_notice({
        title: "Device unavailable",
        details: `Cannot reach "${record.device_name}". Ensure the recipient device is powered on and connected to the network.`,
      });
      return;
    }
    void handle_initiate_transfer(matching_device, record.files);
  };

  return (
    <div className="app-layout">
      <TitleBar
        is_connected={is_connected}
        discovery_status={discovery_status}
      />
      <BackendStatusBanner
        status={backend_status}
        on_restart={handle_restart_backend}
        is_restarting={is_restarting_backend}
      />
      <div className="content-container">
        <Navigation
          active_tab={active_tab}
          on_select_tab={set_active_tab}
          active_transfers_count={active_transfer ? 1 : 0}
        />
        <main className="main-viewport">
          {active_tab === "devices" && (
            <Home
              devices={Array.from(devices_map.values())}
              on_refresh_devices={handle_refresh_devices}
              is_refreshing={is_refreshing}
              active_transfer={active_transfer}
              on_initiate_transfer={handle_initiate_transfer}
              on_cancel_transfer={() => set_active_transfer(undefined)}
              discovery_status={discovery_status}
              is_connected={is_connected}
              on_notify={(title, details, code) =>
                push_notice({ title, details, code: code ?? undefined })
              }
            />
          )}
          {active_tab === "transfers" && (
            <Transfers
              records={transfer_history}
              on_clear_history={() => set_transfer_history([])}
              on_retry_transfer={handle_retry_transfer}
            />
          )}
          {active_tab === "settings" && (
            <SettingsPage
              settings={settings}
              on_update_settings={(updates) =>
                set_settings((prev) => ({ ...prev, ...updates }))
              }
            />
          )}
        </main>
      </div>
      <div
        className="notice-stack"
        aria-live="polite"
        aria-relevant="additions"
      >
        {notices.map((notice) => (
          <button
            key={notice.id}
            type="button"
            className="notice-card"
            onClick={() => {
              set_expanded_notice_id((current) =>
                current === notice.id ? null : notice.id,
              );
            }}
            title="Click to expand or collapse"
          >
            <div className="notice-title">{notice.title}</div>
            <div className="notice-details">
              {expanded_notice_id === notice.id
                ? notice.details
                : notice.code
                  ? `Error code: ${notice.code}`
                  : "Click to view details"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default App;
