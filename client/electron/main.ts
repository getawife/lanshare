import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPath = path.join(
  app.getPath("userData"),
  "lanshare-settings.json",
);
let backendProcess: ChildProcessWithoutNullStreams | null = null;
let backendUrl = "http://127.0.0.1:43821";
let mainWindow: BrowserWindow | null = null;
const backendPort = Number(process.env.LANSHARE_HTTP_PORT ?? "43821") || 43821;

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeSettings(settings: unknown) {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}

function backendBinaryPath() {
  return path.join(
    process.resourcesPath,
    "backend",
    process.platform === "win32" ? "lanshare-backend.exe" : "lanshare-backend",
  );
}

type BackendErrorCode =
  | "PORT_IN_USE"
  | "BLOCKED_BY_FIREWALL"
  | "BINARY_NOT_FOUND"
  | "HEALTHCHECK_TIMEOUT"
  | "BACKEND_CRASH"
  | "UNKNOWN";

interface BackendStatus {
  state: "starting" | "running" | "error" | "stopped";
  url: string;
  code?: BackendErrorCode;
  error?: string;
  errorDetails?: string;
  networkWarnings?: string[];
  diagnostics?: any;
}

let backendStatus: BackendStatus = {
  state: "stopped",
  url: `http://127.0.0.1:${backendPort}`,
};

const backendLogs: string[] = [];

function appendBackendLog(chunk: string) {
  const lines = chunk.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    console.log(`[Backend Log] ${line}`);
    backendLogs.push(line);
    if (backendLogs.length > 100) backendLogs.shift();
  }
}

function analyzeBackendError(): { code: BackendErrorCode; error: string } {
  const fullLog = backendLogs.join("\n").toLowerCase();
  if (
    fullLog.includes("address may already be in use") ||
    fullLog.includes("address already in use") ||
    fullLog.includes("bind: only one usage of each socket address") ||
    fullLog.includes("wsaeaddrinuse")
  ) {
    return {
      code: "PORT_IN_USE",
      error: `Port ${backendPort} is already in use by another instance or application. Close conflicting applications or choose another port.`,
    };
  }
  if (
    fullLog.includes("permission denied") ||
    fullLog.includes("access is denied") ||
    fullLog.includes("wsaeacces") ||
    fullLog.includes("firewall")
  ) {
    return {
      code: "BLOCKED_BY_FIREWALL",
      error: "LANShare backend access was blocked by system permissions or security/firewall software.",
    };
  }
  if (
    fullLog.includes("cannot find") ||
    fullLog.includes("no such file or directory") ||
    fullLog.includes("executable file not found")
  ) {
    return {
      code: "BINARY_NOT_FOUND",
      error: "Backend executable or Go compiler could not be located.",
    };
  }
  return {
    code: "BACKEND_CRASH",
    error: "Backend process terminated unexpectedly on startup.",
  };
}

async function startBackend(): Promise<BackendStatus> {
  if (backendProcess && !backendProcess.killed) {
    return backendStatus;
  }

  backendLogs.length = 0;
  backendStatus = {
    state: "starting",
    url: `http://127.0.0.1:${backendPort}`,
  };

  const binary = backendBinaryPath();
  const isPackaged = app.isPackaged;
  const command = isPackaged ? binary : "go";
  const args = isPackaged ? [] : ["run", "."];
  const cwd = path.resolve(__dirname, "../../backend");

  if (isPackaged && !fsSync.existsSync(binary)) {
    backendStatus = {
      state: "error",
      url: `http://127.0.0.1:${backendPort}`,
      code: "BINARY_NOT_FOUND",
      error: `Packaged backend binary was not found at: ${binary}`,
      errorDetails: `Expected binary path does not exist.`,
    };
    return backendStatus;
  }

  try {
    backendProcess = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: "pipe",
      env: {
        ...process.env,
        GOTOOLCHAIN: "local",
      },
    });
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    backendStatus = {
      state: "error",
      url: `http://127.0.0.1:${backendPort}`,
      code: err?.code === "ENOENT" ? "BINARY_NOT_FOUND" : "BLOCKED_BY_FIREWALL",
      error: `Failed to spawn backend process: ${errorMsg}`,
      errorDetails: errorMsg,
    };
    return backendStatus;
  }

  backendProcess.stdout?.on("data", (data) => {
    appendBackendLog(data.toString());
  });

  backendProcess.stderr?.on("data", (data) => {
    appendBackendLog(data.toString());
  });

  backendProcess.on("error", (err: any) => {
    console.error("[Backend Process Error]", err);
    const code: BackendErrorCode = err?.code === "ENOENT" ? "BINARY_NOT_FOUND" : "BLOCKED_BY_FIREWALL";
    backendStatus = {
      state: "error",
      url: `http://127.0.0.1:${backendPort}`,
      code,
      error: `Backend process error: ${err.message}`,
      errorDetails: backendLogs.join("\n") || err.stack || err.message,
    };
  });

  backendProcess.on("exit", (code, signal) => {
    console.log(`[Backend Exit] code=${code} signal=${signal}`);
    backendProcess = null;
    if (backendStatus.state === "starting" || backendStatus.state === "running") {
      const analyzed = analyzeBackendError();
      backendStatus = {
        state: "error",
        url: `http://127.0.0.1:${backendPort}`,
        code: analyzed.code,
        error: analyzed.error,
        errorDetails: backendLogs.join("\n") || `Process exited with code ${code}, signal ${signal}`,
      };
    }
  });

  const cleanup = () => {
    if (backendProcess && !backendProcess.killed) {
      backendProcess.kill();
    }
  };
  app.once("before-quit", cleanup);

  return await waitForBackend();
}

async function waitForBackend(): Promise<BackendStatus> {
  const url = `http://127.0.0.1:${backendPort}`;
  for (let i = 0; i < 40; i += 1) {
    if (backendStatus.state === "error") {
      return backendStatus;
    }
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        backendUrl = url;
        backendStatus = {
          state: "running",
          url,
          diagnostics: data.diagnostics,
          networkWarnings: data.diagnostics?.warnings ?? [],
        };
        return backendStatus;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (backendStatus.state === "starting") {
    backendStatus = {
      state: "error",
      url,
      code: "HEALTHCHECK_TIMEOUT",
      error: "Backend service did not respond to local health checks. It may be blocked by firewall or antivirus software.",
      errorDetails: backendLogs.join("\n") || "No response received on 127.0.0.1 within timeout.",
    };
  }
  return backendStatus;
}

async function pushSettingsToBackend() {
  // Read persisted Electron settings and POST them to the local backend
  // so discovery advertisements include the user's current preferences.
  try {
    const s = (await readSettings()) ?? {};
    const cfg = {
      askBeforeAccepting: s.askBeforeAccepting ?? true,
      autoAcceptTrusted: s.autoAcceptTrusted ?? false,
      downloadFolder: s.downloadFolder ?? "",
    };
    await fetch(`${backendUrl}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
  } catch (e) {
    console.warn("pushSettingsToBackend failed:", e);
  }
}

async function stopBackend() {
  if (!backendProcess) return;
  const proc = backendProcess;
  backendProcess = null;
  proc.kill();
  backendStatus = {
    state: "stopped",
    url: `http://127.0.0.1:${backendPort}`,
  };
}

const preloadPath = path.join(__dirname, "preload.cjs");
console.log("[Electron Init] Target preload path:", preloadPath);
if (!fsSync.existsSync(preloadPath)) {
  throw new Error(`Preload script not found: ${preloadPath}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
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
      preload: preloadPath,
    },
  });

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("[Electron] PRELOAD ERROR");
    console.error("[Electron] Path:", preloadPath);
    console.error("[Electron] Error:", error);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (!app.isPackaged) {
    void mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("backend:get-url", () => backendUrl);
ipcMain.handle("backend:status", async () => {
  if (backendStatus.state === "running") {
    try {
      const response = await fetch(`${backendUrl}/api/health`);
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        backendStatus.diagnostics = data.diagnostics;
        backendStatus.networkWarnings = data.diagnostics?.warnings ?? [];
      } else {
        backendStatus.state = "error";
        backendStatus.error = "Backend health check returned an unhealthy response.";
      }
    } catch {
      backendStatus.state = "error";
      backendStatus.error = "Could not communicate with local backend service.";
    }
  }
  return backendStatus;
});
ipcMain.handle("backend:restart", async () => {
  await stopBackend();
  return await startBackend();
});
ipcMain.on("window:minimize", () => {
  console.log("[Electron] window:minimize received");
  mainWindow?.minimize();
});

ipcMain.on("window:maximize", () => {
  console.log("[Electron] window:maximize received");
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on("window:close", () => {
  console.log("[Electron] window:close received");
  mainWindow?.close();
});

ipcMain.handle("files:select", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled) return null;
  return result.filePaths.map((filePath) => ({
    name: path.basename(filePath),
    path: filePath,
    sizeBytes: 0,
    isDirectory: false,
  }));
});

ipcMain.handle("folder:select", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  const folderPath = result.filePaths[0];
  return {
    name: path.basename(folderPath),
    path: folderPath,
    sizeBytes: 0,
    isDirectory: true,
  };
});

ipcMain.handle("settings:get", async () => {
  return (
    (await readSettings()) ?? {
      deviceName: "LANShare Desktop",
      autoStart: false,
      showNotifications: true,
      downloadFolder: "",
      askBeforeAccepting: true,
      autoAcceptTrusted: false,
      currentNetwork: "Unknown",
      theme: "dark",
      clipboardSync: false,
    }
  );
});

ipcMain.handle("settings:save", async (_event, settings) => {
  await writeSettings(settings);
  nativeTheme.themeSource = settings.theme ?? "system";
  // Push updated settings to the backend so discovery broadcasts include the
  // current effective preferences (askBeforeAccepting, autoAcceptTrusted).
  try {
    await pushSettingsToBackend();
  } catch (e) {
    console.warn("Failed to push settings to backend:", e);
  }
  return true;
});

ipcMain.handle(
  "backend:fetch",
  async (_event, pathName: string, init?: RequestInit) => {
    const response = await fetch(`${backendUrl}${pathName}`, init);
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: text };
  },
);

ipcMain.handle("backend:state", async () => {
  const response = await fetch(`${backendUrl}/api/state`);
  return response.json();
});

ipcMain.handle("folder:open", async (_event, folderPath?: string) => {
  let target = folderPath && folderPath.trim() !== "" ? folderPath : app.getPath("downloads");
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

app.whenReady().then(async () => {
  await startBackend();
  // After backend is running, push the current Electron settings so the backend
  // will advertise them in its discovery packets.
  try {
    await pushSettingsToBackend();
  } catch (e) {
    console.warn("Failed to push settings to backend:", e);
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  void stopBackend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
