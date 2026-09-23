import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, } from "electron";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKEND_PORT = 43821;
const settingsPath = path.join(app.getPath("userData"), "lanshare-settings.json");
let backendProcess = null;
let backendUrl = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
let mainWindow = null;
let backendPort = DEFAULT_BACKEND_PORT;
let adminToken = null;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.setFeedURL({
    provider: "github",
    owner: "getawife",
    repo: "lanshare",
});
autoUpdater.on("checking-for-update", () => {
    mainWindow?.webContents.send("update:checking");
});
autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update:available", {
        version: info.version,
    });
});
autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("update:progress", {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
    });
});
autoUpdater.on("update-downloaded", (info) => {
    mainWindow?.webContents.send("update:downloaded", {
        version: info.version,
    });
});
autoUpdater.on("error", (error) => {
    console.error("[Updater Error]", error);
    mainWindow?.webContents.send("update:error", {
        message: error.message,
    });
});
ipcMain.on("update:install", () => {
    autoUpdater.quitAndInstall();
});
async function readSettings() {
    try {
        const raw = await fs.readFile(settingsPath, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function writeSettings(settings) {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}
function backendBinaryPath() {
    const backendRoot = path.join(process.resourcesPath, "backend");
    if (process.platform === "win32") {
        const candidates = [
            path.join(backendRoot, "windows", process.arch, "lanshare-backend.exe"),
            path.join(backendRoot, "windows", "lanshare-backend.exe"),
            path.join(backendRoot, "lanshare-backend.exe"),
        ];
        return (candidates.find((candidate) => fsSync.existsSync(candidate)) ??
            candidates[0]);
    }
    if (process.platform === "darwin") {
        const candidates = [
            path.join(backendRoot, "macos", process.arch, "lanshare-backend"),
            path.join(backendRoot, "macos", "lanshare-backend"),
            path.join(backendRoot, "lanshare-backend"),
        ];
        return (candidates.find((candidate) => fsSync.existsSync(candidate)) ??
            candidates[0]);
    }
    if (process.platform === "linux") {
        const candidates = [
            path.join(backendRoot, "linux", process.arch, "lanshare-backend"),
            path.join(backendRoot, "linux", "lanshare-backend"),
            path.join(backendRoot, "lanshare-backend"),
        ];
        return (candidates.find((candidate) => fsSync.existsSync(candidate)) ??
            candidates[0]);
    }
    throw new Error(`Unsupported platform: ${process.platform}`);
}
let backendStatus = {
    state: "stopped",
    url: backendUrl,
};
const backendLogs = [];
function appendBackendLog(chunk) {
    const lines = chunk.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
        console.log(`[Backend Log] ${line}`);
        backendLogs.push(line);
        if (backendLogs.length > 100) {
            backendLogs.shift();
        }
    }
}
function analyzeBackendError() {
    const fullLog = backendLogs.join("\n").toLowerCase();
    if (fullLog.includes("address may already be in use") ||
        fullLog.includes("address already in use") ||
        fullLog.includes("bind: only one usage of each socket address") ||
        fullLog.includes("wsaeaddrinuse")) {
        return {
            code: "PORT_IN_USE",
            error: `Backend port ${backendPort} could not be bound.`,
        };
    }
    if (fullLog.includes("permission denied") ||
        fullLog.includes("access is denied") ||
        fullLog.includes("wsaeacces") ||
        fullLog.includes("firewall")) {
        return {
            code: "BLOCKED_BY_FIREWALL",
            error: "LANShare backend access was blocked by system permissions or security software.",
        };
    }
    if (fullLog.includes("cannot find") ||
        fullLog.includes("no such file or directory") ||
        fullLog.includes("executable file not found")) {
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
function setBackendPort(port) {
    backendPort = port;
    backendUrl = `http://127.0.0.1:${port}`;
}
async function startBackend() {
    if (backendProcess && !backendProcess.killed) {
        return backendStatus;
    }
    backendLogs.length = 0;
    setBackendPort(DEFAULT_BACKEND_PORT);
    backendStatus = {
        state: "starting",
        url: backendUrl,
    };
    const binary = backendBinaryPath();
    const isPackaged = app.isPackaged;
    const command = isPackaged ? binary : "go";
    const args = isPackaged ? [] : ["run", "."];
    const developmentCwd = path.resolve(__dirname, "../../backend");
    if (isPackaged && !fsSync.existsSync(binary)) {
        backendStatus = {
            state: "error",
            url: backendUrl,
            code: "BINARY_NOT_FOUND",
            error: `Packaged backend binary was not found at: ${binary}`,
            errorDetails: "Expected backend executable does not exist.",
        };
        return backendStatus;
    }
    if (!isPackaged && !fsSync.existsSync(developmentCwd)) {
        backendStatus = {
            state: "error",
            url: backendUrl,
            code: "BINARY_NOT_FOUND",
            error: `Backend development directory was not found at: ${developmentCwd}`,
            errorDetails: "Expected Go backend directory does not exist.",
        };
        return backendStatus;
    }
    try {
        if (!adminToken) {
            adminToken = crypto.randomBytes(16).toString("hex");
        }
        backendProcess = spawn(command, args, {
            cwd: isPackaged ? path.dirname(binary) : developmentCwd,
            windowsHide: true,
            stdio: "pipe",
            env: {
                ...process.env,
                GOTOOLCHAIN: "local",
                LANSHARE_HTTP_PORT: String(DEFAULT_BACKEND_PORT),
                LANSHARE_ADMIN_TOKEN: adminToken,
            },
        });
    }
    catch (err) {
        const errorMsg = err?.message || String(err);
        backendStatus = {
            state: "error",
            url: backendUrl,
            code: err?.code === "ENOENT" ? "BINARY_NOT_FOUND" : "UNKNOWN",
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
    backendProcess.on("error", (err) => {
        console.error("[Backend Process Error]", err);
        const code = err?.code === "ENOENT" ? "BINARY_NOT_FOUND" : "UNKNOWN";
        backendStatus = {
            state: "error",
            url: backendUrl,
            code,
            error: `Backend process error: ${err.message}`,
            errorDetails: backendLogs.join("\n") || err.stack || err.message,
        };
    });
    backendProcess.on("exit", (code, signal) => {
        console.log(`[Backend Exit] code=${code} signal=${signal}`);
        backendProcess = null;
        if (backendStatus.state === "starting" ||
            backendStatus.state === "running") {
            const analyzed = analyzeBackendError();
            backendStatus = {
                state: "error",
                url: backendUrl,
                code: analyzed.code,
                error: analyzed.error,
                errorDetails: backendLogs.join("\n") ||
                    `Process exited with code ${code}, signal ${signal}`,
            };
        }
    });
    return await waitForBackend();
}
async function waitForBackend() {
    const initialUrl = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
    for (let i = 0; i < 60; i += 1) {
        if (backendStatus.state === "error") {
            return backendStatus;
        }
        try {
            const response = await fetch(`${initialUrl}/api/health`);
            if (response.ok) {
                const healthData = await response.json().catch(() => ({}));
                let actualPort = DEFAULT_BACKEND_PORT;
                try {
                    const stateResponse = await fetch(`${initialUrl}/api/state`);
                    if (stateResponse.ok) {
                        const state = await stateResponse.json();
                        if (Number.isInteger(state.httpPort) &&
                            state.httpPort > 0 &&
                            state.httpPort <= 65535) {
                            actualPort = state.httpPort;
                        }
                    }
                }
                catch {
                    actualPort = DEFAULT_BACKEND_PORT;
                }
                setBackendPort(actualPort);
                backendStatus = {
                    state: "running",
                    url: backendUrl,
                    diagnostics: healthData.diagnostics,
                    networkWarnings: healthData.diagnostics?.warnings ?? [],
                };
                return backendStatus;
            }
        }
        catch {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (backendStatus.state === "starting") {
        backendStatus = {
            state: "error",
            url: backendUrl,
            code: "HEALTHCHECK_TIMEOUT",
            error: "Backend service did not respond to local health checks.",
            errorDetails: backendLogs.join("\n") ||
                `No response received on 127.0.0.1:${DEFAULT_BACKEND_PORT} within timeout.`,
        };
    }
    return backendStatus;
}
async function pushSettingsToBackend() {
    try {
        const s = (await readSettings()) ?? {};
        const cfg = {
            deviceName: s.deviceName ?? "Lanshare Desktop",
            askBeforeAccepting: s.askBeforeAccepting ?? true,
            autoAcceptTrusted: s.autoAcceptTrusted ?? false,
            downloadFolder: s.downloadFolder ?? "",
        };
        const headers = {
            "Content-Type": "application/json",
        };
        if (adminToken) {
            headers["X-Lanshare-Token"] = adminToken;
        }
        await fetch(`${backendUrl}/api/settings`, {
            method: "POST",
            headers,
            body: JSON.stringify(cfg),
        });
    }
    catch (e) {
        console.warn("pushSettingsToBackend failed:", e);
    }
}
async function stopBackend() {
    if (!backendProcess) {
        backendStatus = {
            state: "stopped",
            url: backendUrl,
        };
        return;
    }
    const proc = backendProcess;
    backendProcess = null;
    try {
        if (process.platform === "win32" && proc.pid) {
            spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], {
                windowsHide: true,
                stdio: "ignore",
            });
        }
        else {
            proc.kill("SIGTERM");
        }
    }
    catch {
        try {
            proc.kill();
        }
        catch { }
    }
    backendStatus = {
        state: "stopped",
        url: backendUrl,
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
    mainWindow.webContents.on("preload-error", (_event, failedPreloadPath, error) => {
        console.error("[Electron] PRELOAD ERROR");
        console.error("[Electron] Path:", failedPreloadPath);
        console.error("[Electron] Error:", error);
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    if (!app.isPackaged) {
        void mainWindow.loadURL("http://127.0.0.1:5173");
    }
    else {
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
            }
            else {
                backendStatus.state = "error";
                backendStatus.error =
                    "Backend health check returned an unhealthy response.";
            }
        }
        catch {
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
    mainWindow?.minimize();
});
ipcMain.on("window:maximize", () => {
    if (!mainWindow)
        return;
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    }
    else {
        mainWindow.maximize();
    }
});
ipcMain.on("window:close", () => {
    mainWindow?.close();
});
ipcMain.handle("files:select", async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
    });
    if (result.canceled)
        return null;
    return result.filePaths.map((filePath) => {
        const stats = fsSync.statSync(filePath);
        return {
            name: path.basename(filePath),
            path: filePath,
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
    const folderPath = result.filePaths[0];
    return {
        name: path.basename(folderPath),
        path: folderPath,
        sizeBytes: 0,
        isDirectory: true,
    };
});
ipcMain.handle("settings:get", async () => {
    return ((await readSettings()) ?? {
        deviceName: "Lanshare Desktop",
        autoStart: false,
        showNotifications: true,
        downloadFolder: "",
        askBeforeAccepting: true,
        autoAcceptTrusted: false,
        currentNetwork: "Unknown",
        theme: "dark",
        clipboardSync: false,
    });
});
ipcMain.handle("settings:save", async (_event, settings) => {
    await writeSettings(settings);
    nativeTheme.themeSource = settings.theme ?? "system";
    try {
        await pushSettingsToBackend();
    }
    catch (e) {
        console.warn("Failed to push settings to backend:", e);
    }
    return true;
});
ipcMain.handle("backend:fetch", async (_event, pathName, init) => {
    const headers = {};
    if (init?.headers) {
        Object.assign(headers, init.headers);
    }
    if (adminToken) {
        headers["X-Lanshare-Token"] = adminToken;
    }
    const response = await fetch(`${backendUrl}${pathName}`, {
        ...init,
        headers,
    });
    const text = await response.text();
    return {
        ok: response.ok,
        status: response.status,
        body: text,
    };
});
ipcMain.handle("transfer:respond", async (_event, transferId, accept) => {
    const headers = {
        "Content-Type": "application/json",
    };
    if (adminToken) {
        headers["X-Lanshare-Token"] = adminToken;
    }
    const response = await fetch(`${backendUrl}/api/respond-transfer`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            transferId,
            accept,
        }),
    });
    const text = await response.text();
    return {
        ok: response.ok,
        status: response.status,
        body: text,
    };
});
ipcMain.handle("backend:state", async () => {
    const response = await fetch(`${backendUrl}/api/state`);
    return response.json();
});
ipcMain.handle("folder:open", async (_event, folderPath) => {
    let target = folderPath && folderPath.trim() !== ""
        ? folderPath
        : app.getPath("downloads");
    try {
        const stats = await fs.stat(target);
        if (!stats.isDirectory()) {
            shell.showItemInFolder(target);
            return true;
        }
    }
    catch {
        target = app.getPath("downloads");
    }
    await shell.openPath(target);
    return true;
});
app.whenReady().then(async () => {
    await startBackend();
    try {
        await pushSettingsToBackend();
    }
    catch (e) {
        console.warn("Failed to push settings to backend:", e);
    }
    createWindow();
    if (app.isPackaged) {
        await autoUpdater.checkForUpdatesAndNotify();
    }
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
app.on("before-quit", () => {
    void stopBackend();
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
