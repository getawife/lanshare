import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPath = path.join(app.getPath("userData"), "lanshare-settings.json");
let backendProcess = null;
let backendUrl = "http://127.0.0.1:43821";
let mainWindow = null;
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
    return path.join(process.resourcesPath, "backend", process.platform === "win32" ? "lanshare-backend.exe" : "lanshare-backend");
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
            const response = await fetch("http://127.0.0.1:43821/api/health");
            if (response.ok)
                return "http://127.0.0.1:43821";
        }
        catch {
            // retry
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return backendUrl;
}
async function stopBackend() {
    if (!backendProcess)
        return;
    const proc = backendProcess;
    backendProcess = null;
    proc.kill();
}
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1120,
        height: 760,
        minWidth: 860,
        minHeight: 620,
        frame: false,
        backgroundColor: "#101318",
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, "preload.js"),
        },
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    if (!app.isPackaged)
        void mainWindow.loadURL("http://127.0.0.1:5173");
    else
        void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
}
ipcMain.handle("backend:get-url", () => backendUrl);
ipcMain.handle("files:select", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    if (result.canceled)
        return null;
    return result.filePaths.map((filePath) => ({
        name: path.basename(filePath),
        path: filePath,
        sizeBytes: 0,
        isDirectory: false,
    }));
});
ipcMain.handle("folder:select", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0])
        return null;
    const folderPath = result.filePaths[0];
    return { name: path.basename(folderPath), path: folderPath, sizeBytes: 0, isDirectory: true };
});
ipcMain.handle("settings:get", async () => {
    return ((await readSettings()) ?? {
        deviceName: "LANShare Desktop",
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
    return true;
});
ipcMain.handle("backend:fetch", async (_event, pathName, init) => {
    const response = await fetch(`${backendUrl}${pathName}`, init);
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: text };
});
ipcMain.handle("backend:state", async () => {
    const response = await fetch(`${backendUrl}/api/state`);
    return response.json();
});
app.whenReady().then(async () => {
    await startBackend();
    createWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
app.on("before-quit", () => {
    void stopBackend();
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        app.quit();
});
