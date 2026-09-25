import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  Notification,
  shell,
} from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

ipcMain.on("update:install", () => {
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
    openAsHidden: process.platform === "darwin",
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
        "LANShare backend access was blocked by system permissions or security software.",
    };
  }

  if (
    full_log.includes("cannot find") ||
    full_log.includes("no such file or directory") ||
    full_log.includes("executable file not found")
  ) {
    return {
      code: "BINARY_NOT_FOUND",
      error: "The LANShare backend executable could not be found.",
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
      const response = await fetch(`${initial_url}/api/health`);

      if (response.ok) {
        const health_data = await response.json().catch(() => ({}));

        let actual_port = default_backend_port;

        try {
          const state_response = await fetch(`${initial_url}/api/state`);

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
      preload: preload_path,
    },
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

ipcMain.handle("backend:get-url", () => backend_url);

ipcMain.handle("backend:status", async () => {
  if (backend_status.state === "running") {
    try {
      const response = await fetch(`${backend_url}/api/health`);

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

ipcMain.handle("backend:restart", async () => {
  await stop_backend();
  return await start_backend();
});

ipcMain.on("window:minimize", () => {
  main_window?.minimize();
});

ipcMain.on("window:maximize", () => {
  if (!main_window) return;

  if (main_window.isMaximized()) {
    main_window.unmaximize();
  } else {
    main_window.maximize();
  }
});

ipcMain.on("window:close", () => {
  main_window?.close();
});

ipcMain.handle("files:select", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
  });

  if (result.canceled) return null;

  return result.filePaths.map((file_path) => {
    const stats = fsSync.statSync(file_path);

    return {
      name: path.basename(file_path),
      path: file_path,
      sizeBytes: stats.size,
      isDirectory: stats.isDirectory(),
    };
  });
});

ipcMain.handle("folder:select", async () => {
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
    sizeBytes: 0,
    isDirectory: true,
  };
});

ipcMain.handle("settings:get", async () => {
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

ipcMain.handle("settings:save", async (_event, settings) => {
  await write_settings(settings);

  nativeTheme.themeSource = settings.theme ?? "system";

  if (typeof settings.autoStart === "boolean") {
    apply_auto_start(settings.autoStart);
  }

  try {
    await push_settings_to_backend();
  } catch (e) {
    console.warn("Failed to push settings to backend:", e);
  }

  return true;
});

ipcMain.handle(
  "backend:fetch",
  async (_event, path_name: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};

    if (init?.headers) {
      Object.assign(headers, init.headers as Record<string, string>);
    }

    if (admin_token) {
      headers["X-Lanshare-Token"] = admin_token;
    }

    const response = await fetch(`${backend_url}${path_name}`, {
      ...init,
      headers,
    });

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      body: text,
    };
  },
);

ipcMain.handle(
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

ipcMain.handle("backend:state", async () => {
  const response = await fetch(`${backend_url}/api/state`);
  return response.json();
});

ipcMain.handle("folder:open", async (_event, folder_path?: string) => {
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

ipcMain.handle("notify", async (_event, title: string, body: string) => {
  await show_notification(title, body);
  return true;
});

app.whenReady().then(async () => {
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
