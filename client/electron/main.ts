import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  Notification,
  session,
  shell,
} from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import crypto from "node:crypto";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const default_backend_port = 43821;
const settings_path = path.join(
  app.getPath("userData"),
  "lanshare-settings.json",
);

let backend_process: ChildProcessWithoutNullStreams | null = null;
let backend_url = `http://127.0.0.1:${default_backend_port}`;
let main_window: BrowserWindow | null = null;
let backend_port = default_backend_port;
let admin_token: string | null = null;

function auth_headers(): Record<string, string> {
  return admin_token ? { "X-Lanshare-Token": admin_token } : {};
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.setFeedURL({
  provider: "github",
  owner: "getawife",
  repo: "lanshare",
});

autoUpdater.on("checking-for-update", () => {
  main_window?.webContents.send("update:checking");
});

autoUpdater.on("update-available", (info) => {
  main_window?.webContents.send("update:available", {
    version: info.version,
  });
});

autoUpdater.on("update-not-available", () => {
  main_window?.webContents.send("update:not-available");
});

autoUpdater.on("download-progress", (progress) => {
  main_window?.webContents.send("update:progress", {
    percent: progress.percent,
    bytesPerSecond: progress.bytesPerSecond,
    transferred: progress.transferred,
    total: progress.total,
  });
});

autoUpdater.on("update-downloaded", (info) => {
  main_window?.webContents.send("update:downloaded", {
    version: info.version,
  });
});

autoUpdater.on("error", (error) => {
  console.error("[Updater Error]", error);

  main_window?.webContents.send("update:error", {
    message: error.message,
  });
});

const dev_server_origin = "http://127.0.0.1:5173";

function is_app_url(url: string): boolean {
  if (!app.isPackaged) return url.startsWith(dev_server_origin);
  return url.startsWith(pathToFileURL(path.join(__dirname, "../dist")).href);
}

function is_trusted_sender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  if (!main_window || event.sender !== main_window.webContents) return false;
  return is_app_url(event.senderFrame?.url ?? "");
}

function secure_handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!is_trusted_sender(event)) throw new Error("Untrusted IPC sender");
    return listener(event, ...args);
  });
}

function secure_on(
  channel: string,
  listener: (event: IpcMainEvent, ...args: any[]) => void,
) {
  ipcMain.on(channel, (event, ...args) => {
    if (!is_trusted_sender(event)) return;
    listener(event, ...args);
  });
}

const allowed_backend_routes = new Set([
  "/api/transfer",
  "/api/cancel-transfer",
]);

const allowed_themes = ["system", "light", "dark"];

function sanitize_settings(
  input: unknown,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const raw = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = { ...base };
  const text = (key: string, max: number) => {
    const value = raw[key];
    if (typeof value === "string") out[key] = value.trim().slice(0, max);
  };
  const flag = (key: string) => {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  };
  text("deviceName", 64);
  text("currentNetwork", 100);
  flag("autoStart");
  flag("showNotifications");
  flag("askBeforeAccepting");
  flag("autoAcceptTrusted");
  if (typeof raw.downloadFolder === "string") {
    const folder = raw.downloadFolder.trim();
    if (folder === "" || path.isAbsolute(folder)) out.downloadFolder = folder;
  }
  if (typeof raw.theme === "string" && allowed_themes.includes(raw.theme)) {
    out.theme = raw.theme;
  }
  return out;
}

secure_on("update:install", () => {
  autoUpdater.quitAndInstall();
});

async function read_settings() {
  try {
    const raw = await fs.readFile(settings_path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function write_settings(settings: unknown) {
  await fs.mkdir(path.dirname(settings_path), { recursive: true });
  await fs.writeFile(settings_path, JSON.stringify(settings, null, 2), "utf8");
}

function apply_auto_start(enabled: boolean) {
  if (!app.isPackaged) return;

  app.setLoginItemSettings({
    openAtLogin: enabled,
  });
}

async function show_notification(title: string, body: string) {
  if (!Notification.isSupported()) return;
  if (main_window && main_window.isFocused()) return;

  const saved = await read_settings();
  if (saved && saved.showNotifications === false) return;

  const notification = new Notification({ title, body });

  notification.on("click", () => {
    if (!main_window) {
      create_window();
      return;
    }
    if (main_window.isMinimized()) main_window.restore();
    main_window.show();
    main_window.focus();
  });

  notification.show();
}

function backend_binary_path() {
  const backend_root = path.join(process.resourcesPath, "backend");

  if (process.platform === "win32") {
    const candidates = [
      path.join(backend_root, "windows", process.arch, "lanshare-backend.exe"),
      path.join(backend_root, "windows", "lanshare-backend.exe"),
      path.join(backend_root, "lanshare-backend.exe"),
    ];

    return (
      candidates.find((candidate) => fsSync.existsSync(candidate)) ??
      candidates[0]
    );
  }

  if (process.platform === "darwin") {
    const candidates = [
      path.join(backend_root, "macos", process.arch, "lanshare-backend"),
      path.join(backend_root, "macos", "lanshare-backend"),
      path.join(backend_root, "lanshare-backend"),
    ];

    return (
      candidates.find((candidate) => fsSync.existsSync(candidate)) ??
      candidates[0]
    );
  }

  if (process.platform === "linux") {
    const candidates = [
      path.join(backend_root, "linux", process.arch, "lanshare-backend"),
      path.join(backend_root, "linux", "lanshare-backend"),
      path.join(backend_root, "lanshare-backend"),
    ];

    return (
      candidates.find((candidate) => fsSync.existsSync(candidate)) ??
      candidates[0]
    );
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

type backend_error_code =
  | "PORT_IN_USE"
  | "BLOCKED_BY_FIREWALL"
  | "BINARY_NOT_FOUND"
  | "HEALTHCHECK_TIMEOUT"
  | "BACKEND_CRASH"
  | "UNKNOWN";

interface backend_status {
  state: "starting" | "running" | "error" | "stopped";
  url: string;
  code?: backend_error_code;
  error?: string;
  errorDetails?: string;
  networkWarnings?: string[];
  diagnostics?: any;
}

let backend_status: backend_status = {
  state: "stopped",
  url: backend_url,
};

const backend_logs: string[] = [];

function append_backend_log(chunk: string) {
  const lines = chunk.split(/\r?\n/).filter((line) => line.trim().length > 0);

  for (const line of lines) {
    console.log(`[Backend Log] ${line}`);
    backend_logs.push(line);

    if (backend_logs.length > 100) {
      backend_logs.shift();
    }
  }
}

function analyze_backend_error(): {
  code: backend_error_code;
  error: string;
} {
  const full_log = backend_logs.join("\n").toLowerCase();

  if (
    full_log.includes("address may already be in use") ||
    full_log.includes("address already in use") ||
    full_log.includes("bind: only one usage of each socket address") ||
    full_log.includes("wsaeaddrinuse")
  ) {
    return {
      code: "PORT_IN_USE",
      error: `Backend port ${backend_port} could not be bound.`,
    };
  }

  if (
    full_log.includes("permission denied") ||
    full_log.includes("access is denied") ||
    full_log.includes("wsaeacces") ||
    full_log.includes("firewall")
  ) {
    return {
      code: "BLOCKED_BY_FIREWALL",
      error:
        "Lanshare backend access was blocked by system permissions or security software.",
    };
  }

  if (
    full_log.includes("cannot find") ||
    full_log.includes("no such file or directory") ||
    full_log.includes("executable file not found")
  ) {
    return {
      code: "BINARY_NOT_FOUND",
      error: "The Lanshare backend executable could not be found.",
    };
  }

  return {
    code: "BACKEND_CRASH",
    error: "Backend process terminated unexpectedly on startup.",
  };
}

function set_backend_port(port: number) {
  backend_port = port;
  backend_url = `http://127.0.0.1:${port}`;
}

async function start_backend(): Promise<backend_status> {
  if (backend_process && !backend_process.killed) {
    return backend_status;
  }

  backend_logs.length = 0;

  set_backend_port(default_backend_port);

  backend_status = {
    state: "starting",
    url: backend_url,
  };

  const binary = backend_binary_path();
  const is_packaged = app.isPackaged;
  const command = is_packaged ? binary : "go";
  const args = is_packaged ? [] : ["run", "."];

  const development_cwd = path.resolve(__dirname, "../../backend");

  if (is_packaged && !fsSync.existsSync(binary)) {
    backend_status = {
      state: "error",
      url: backend_url,
      code: "BINARY_NOT_FOUND",
      error: `Packaged backend binary was not found at: ${binary}`,
      errorDetails: "Expected backend executable does not exist.",
    };

    return backend_status;
  }

  if (!is_packaged && !fsSync.existsSync(development_cwd)) {
    backend_status = {
      state: "error",
      url: backend_url,
      code: "BINARY_NOT_FOUND",
      error: `Backend development directory was not found at: ${development_cwd}`,
      errorDetails: "Expected Go backend directory does not exist.",
    };

    return backend_status;
  }

  try {
    if (!admin_token) {
      admin_token = crypto.randomBytes(16).toString("hex");
    }

    backend_process = spawn(command, args, {
      cwd: is_packaged ? path.dirname(binary) : development_cwd,
      windowsHide: true,
      stdio: "pipe",
      env: {
        ...process.env,
        GOTOOLCHAIN: "local",
        LANSHARE_HTTP_PORT: String(default_backend_port),
        LANSHARE_ADMIN_TOKEN: admin_token,
        LANSHARE_USER_DATA_DIR: app.getPath("userData"),
      },
    });
  } catch (err: any) {
    const error_msg = err?.message || String(err);

    backend_status = {
      state: "error",
      url: backend_url,
      code: err?.code === "ENOENT" ? "BINARY_NOT_FOUND" : "UNKNOWN",
      error: `Failed to spawn backend process: ${error_msg}`,
      errorDetails: error_msg,
    };

    return backend_status;
  }

  backend_process.stdout?.on("data", (data) => {
    append_backend_log(data.toString());
  });

  backend_process.stderr?.on("data", (data) => {
    append_backend_log(data.toString());
  });

  backend_process.on("error", (err: any) => {
    console.error("[Backend Process Error]", err);

    const code: backend_error_code =
      err?.code === "ENOENT" ? "BINARY_NOT_FOUND" : "UNKNOWN";

    backend_status = {
      state: "error",
      url: backend_url,
      code,
      error: `Backend process error: ${err.message}`,
      errorDetails: backend_logs.join("\n") || err.stack || err.message,
    };
  });

  backend_process.on("exit", (code, signal) => {
    console.log(`[Backend Exit] code=${code} signal=${signal}`);

    backend_process = null;

    if (
      backend_status.state === "starting" ||
      backend_status.state === "running"
    ) {
      const analyzed = analyze_backend_error();

      backend_status = {
        state: "error",
        url: backend_url,
        code: analyzed.code,
        error: analyzed.error,
        errorDetails:
          backend_logs.join("\n") ||
          `Process exited with code ${code}, signal ${signal}`,
      };
    }
  });

  return await wait_for_backend();
}

async function wait_for_backend(): Promise<backend_status> {
  const initial_url = `http://127.0.0.1:${default_backend_port}`;

  for (let i = 0; i < 60; i += 1) {
    if (backend_status.state === "error") {
      return backend_status;
    }

    try {
      const response = await fetch(`${initial_url}/api/health`, {
        headers: auth_headers(),
      });

      if (response.ok) {
        const health_data = await response.json().catch(() => ({}));

        let actual_port = default_backend_port;

        try {
          const state_response = await fetch(`${initial_url}/api/state`, {
            headers: auth_headers(),
          });

          if (state_response.ok) {
            const state = await state_response.json();

            if (
              Number.isInteger(state.httpPort) &&
              state.httpPort > 0 &&
              state.httpPort <= 65535
            ) {
              actual_port = state.httpPort;
            }
          }
        } catch {
          actual_port = default_backend_port;
        }

        set_backend_port(actual_port);

        backend_status = {
          state: "running",
          url: backend_url,
          diagnostics: health_data.diagnostics,
          networkWarnings: health_data.diagnostics?.warnings ?? [],
        };

        return backend_status;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (backend_status.state === "starting") {
    backend_status = {
      state: "error",
      url: backend_url,
      code: "HEALTHCHECK_TIMEOUT",
      error: "Backend service did not respond to local health checks.",
      errorDetails:
        backend_logs.join("\n") ||
        `No response received on 127.0.0.1:${default_backend_port} within timeout.`,
    };
  }

  return backend_status;
}

async function push_settings_to_backend() {
  try {
    const s = (await read_settings()) ?? {};

    const cfg = {
      deviceName: s.deviceName ?? "Lanshare Desktop",
      askBeforeAccepting: s.askBeforeAccepting ?? true,
      autoAcceptTrusted: s.autoAcceptTrusted ?? false,
      downloadFolder: s.downloadFolder ?? "",
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (admin_token) {
      headers["X-Lanshare-Token"] = admin_token;
    }

    await fetch(`${backend_url}/api/settings`, {
      method: "POST",
      headers,
      body: JSON.stringify(cfg),
    });
  } catch (e) {
    console.warn("push_settings_to_backend failed:", e);
  }
}

async function stop_backend() {
  if (!backend_process) {
    backend_status = {
      state: "stopped",
      url: backend_url,
    };

    return;
  }

  const proc = backend_process;
  backend_process = null;

  try {
    if (process.platform === "win32" && proc.pid) {
      spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    try {
      proc.kill();
    } catch {}
  }

  backend_status = {
    state: "stopped",
    url: backend_url,
  };
}

const preload_path = path.join(__dirname, "preload.cjs");

console.log("[Electron Init] Target preload path:", preload_path);

if (!fsSync.existsSync(preload_path)) {
  throw new Error(`Preload script not found: ${preload_path}`);
}

function create_window() {
  main_window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    frame: false,
    backgroundColor: "#101318",
    icon: path.join(__dirname, "../src/assets/icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: preload_path,
    },
  });

  main_window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  main_window.webContents.on("will-navigate", (event, url) => {
    if (!is_app_url(url)) event.preventDefault();
  });
  main_window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  main_window.webContents.on(
    "preload-error",
    (_event, failed_preload_path, error) => {
      console.error("[Electron] PRELOAD ERROR");
      console.error("[Electron] Path:", failed_preload_path);
      console.error("[Electron] Error:", error);
    },
  );

  main_window.on("closed", () => {
    main_window = null;
  });

  if (!app.isPackaged) {
    void main_window.loadURL("http://127.0.0.1:5173");
  } else {
    void main_window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

secure_handle("backend:get-url", () => backend_url);

secure_handle(
  "backend:events-url",
  () =>
    `${backend_url}/api/events?token=${encodeURIComponent(admin_token ?? "")}`,
);

secure_handle("backend:status", async () => {
  if (backend_status.state === "running") {
    try {
      const response = await fetch(`${backend_url}/api/health`, {
        headers: auth_headers(),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));

        backend_status.diagnostics = data.diagnostics;
        backend_status.networkWarnings = data.diagnostics?.warnings ?? [];
      } else {
        backend_status.state = "error";
        backend_status.error =
          "Backend health check returned an unhealthy response.";
      }
    } catch {
      backend_status.state = "error";
      backend_status.error =
        "Could not communicate with local backend service.";
    }
  }

  return backend_status;
});

secure_handle("backend:restart", async () => {
  await stop_backend();
  return await start_backend();
});

secure_on("window:minimize", () => {
  main_window?.minimize();
});

secure_on("window:maximize", () => {
  if (!main_window) return;

  if (main_window.isMaximized()) {
    main_window.unmaximize();
  } else {
    main_window.maximize();
  }
});

secure_on("window:close", () => {
  main_window?.close();
});

async function folder_size(root: string): Promise<number> {
  let total = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full_path = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(full_path);
      } else if (entry.isFile()) {
        try {
          total += (await fs.stat(full_path)).size;
        } catch {
          void 0;
        }
      }
    }
  }
  return total;
}

secure_handle("files:select", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
  });

  if (result.canceled) return null;

  return result.filePaths.map((file_path) => {
    const stats = fsSync.statSync(file_path);

    return {
      name: path.basename(file_path),
      path: file_path,
      size: stats.size,
      is_dir: stats.isDirectory(),
    };
  });
});

secure_handle("folder:select", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const folder_path = result.filePaths[0];

  return {
    name: path.basename(folder_path),
    path: folder_path,
    size: await folder_size(folder_path),
    is_dir: true,
  };
});

secure_handle("settings:get", async () => {
  return (
    (await read_settings()) ?? {
      deviceName: "Lanshare Desktop",
      autoStart: false,
      showNotifications: true,
      downloadFolder: "",
      askBeforeAccepting: true,
      autoAcceptTrusted: false,
      currentNetwork: "Unknown",
      theme: "dark",
    }
  );
});

secure_handle("settings:save", async (_event, settings) => {
  const clean = sanitize_settings(settings, (await read_settings()) ?? {});
  await write_settings(clean);

  const theme = clean.theme;
  nativeTheme.themeSource =
    typeof theme === "string" && allowed_themes.includes(theme)
      ? (theme as "system" | "light" | "dark")
      : "system";

  if (typeof clean.autoStart === "boolean") {
    apply_auto_start(clean.autoStart);
  }

  try {
    await push_settings_to_backend();
  } catch (e) {
    console.warn("Failed to push settings to backend:", e);
  }

  return true;
});

secure_handle(
  "backend:fetch",
  async (_event, path_name: string, init?: RequestInit) => {
    if (
      typeof path_name !== "string" ||
      !allowed_backend_routes.has(path_name.split("?")[0] ?? "")
    ) {
      throw new Error("Invalid backend path");
    }

    const headers: Record<string, string> = {};

    if (init?.headers) {
      Object.assign(headers, init.headers as Record<string, string>);
    }

    if (admin_token) {
      headers["X-Lanshare-Token"] = admin_token;
    }

    const method = init?.method === "POST" ? "POST" : "GET";
    const response = await fetch(`${backend_url}${path_name}`, {
      method,
      headers,
      ...(method === "POST" && typeof init?.body === "string"
        ? { body: init.body }
        : {}),
    });

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      body: text,
    };
  },
);

secure_handle(
  "transfer:respond",
  async (_event, transfer_id: string, accept: boolean) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (admin_token) {
      headers["X-Lanshare-Token"] = admin_token;
    }

    const response = await fetch(`${backend_url}/api/respond-transfer`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        transferId: transfer_id,
        accept,
      }),
    });

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      body: text,
    };
  },
);

secure_handle("trust:list", async () => {
  const headers: Record<string, string> = {};
  if (admin_token) {
    headers["X-Lanshare-Token"] = admin_token;
  }
  const response = await fetch(`${backend_url}/api/trust`, { headers });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: text,
  };
});

secure_handle(
  "trust:set",
  async (_event, peer_id: string, trusted: boolean) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (admin_token) {
      headers["X-Lanshare-Token"] = admin_token;
    }
    const response = await fetch(`${backend_url}/api/trust`, {
      method: "POST",
      headers,
      body: JSON.stringify({ peerId: peer_id, trusted }),
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text,
    };
  },
);

secure_handle("backend:state", async () => {
  const response = await fetch(`${backend_url}/api/state`, {
    headers: auth_headers(),
  });
  return response.json();
});

secure_handle("folder:open", async (_event, folder_path?: string) => {
  if (folder_path !== undefined && typeof folder_path !== "string") {
    return false;
  }
  let target =
    folder_path && folder_path.trim() !== ""
      ? folder_path
      : app.getPath("downloads");

  try {
    const stats = await fs.stat(target);

    if (!stats.isDirectory()) {
      shell.showItemInFolder(target);
      return true;
    }
  } catch {
    target = app.getPath("downloads");
  }

  await shell.openPath(target);
  return true;
});

secure_handle("notify", async (_event, title: string, body: string) => {
  if (typeof title !== "string" || typeof body !== "string") return false;
  await show_notification(title.slice(0, 120), body.slice(0, 300));
  return true;
});

const has_single_instance_lock = app.requestSingleInstanceLock();

if (!has_single_instance_lock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!main_window) return;
    if (main_window.isMinimized()) main_window.restore();
    main_window.focus();
  });
}

app.whenReady().then(async () => {
  if (!has_single_instance_lock) return;

  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);

  await start_backend();

  try {
    await push_settings_to_backend();
  } catch (e) {
    console.warn("Failed to push settings to backend:", e);
  }

  const saved = await read_settings();
  apply_auto_start(Boolean(saved?.autoStart));

  create_window();

  if (app.isPackaged) {
    await autoUpdater.checkForUpdatesAndNotify();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      create_window();
    }
  });
});

app.on("before-quit", () => {
  void stop_backend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
