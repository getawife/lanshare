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

function startBackend() {
  const binary = backendBinaryPath();
  const command = app.isPackaged ? binary : "go";
  const args = app.isPackaged ? [] : ["run", "."];
  const cwd = path.resolve(__dirname, "../../backend");
  backendProcess = spawn(command, args, {
    cwd,
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      GOTOOLCHAIN: "local",
    },
  });

  const cleanup = () => {
    if (backendProcess && !backendProcess.killed) {
      backendProcess.kill();
    }
  };

  backendProcess.on("exit", () => {
    backendProcess = null;
  });
  app.once("before-quit", cleanup);
  return waitForBackend().then((url) => {
    backendUrl = url;
  });
}

async function waitForBackend() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const url = `http://127.0.0.1:${backendPort}`;
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return url;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return backendUrl;
}

async function stopBackend() {
  if (!backendProcess) return;
  const proc = backendProcess;
  backendProcess = null;
  proc.kill();
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
