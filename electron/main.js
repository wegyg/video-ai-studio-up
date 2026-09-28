/**
 * Electron main process for ShortsDirector Desktop.
 *
 * Boots the existing Next.js app in-process (production mode) on a free
 * localhost port, waits until it responds, then opens it in a native window.
 * All rendering happens locally on the user's machine (fast, no cloud limits).
 * Free by default; optional API keys still work via env.
 */
const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const isDev = !app.isPackaged;
// In a packaged app, the Next project lives under resources/app (asar-unpacked
// pieces are resolved by the pipeline). In dev we run from the repo root.
const APP_DIR = isDev ? path.join(__dirname, "..") : path.join(process.resourcesPath, "app");

let mainWindow = null;
let nextServer = null;

/** Find an available localhost port. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Poll the server until it answers (or time out). */
function waitForServer(port, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/" }, (res) => {
        res.destroy();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) return reject(new Error("Next server did not start in time"));
        setTimeout(tick, 400);
      });
    };
    tick();
  });
}

/** Start Next.js in production mode inside this process. */
async function startNext(port) {
  // Route generated files to the user's app-data folder (writable in a packaged app).
  process.env.SD_WORK_DIR = process.env.SD_WORK_DIR || path.join(app.getPath("userData"), "jobs");
  process.env.NODE_ENV = "production";
  // Keep a single Chromium tab per render on typical laptops.
  process.env.RENDER_MEDIA_CONCURRENCY = process.env.RENDER_MEDIA_CONCURRENCY || "1";
  process.env.RENDER_CONCURRENCY = process.env.RENDER_CONCURRENCY || "1";

  // Ensure Remotion's headless Chromium shell is present (first launch may
  // fetch it once into a writable cache). Non-fatal if it can't — the render
  // step will surface a clear error.
  try {
    const { ensureBrowser } = require(path.join(APP_DIR, "node_modules", "@remotion", "renderer"));
    if (typeof ensureBrowser === "function") await ensureBrowser();
  } catch (e) {
    console.warn("[remotion] ensureBrowser skipped:", e && e.message);
  }

  // Require Next from the app's node_modules.
  const next = require(path.join(APP_DIR, "node_modules", "next"));
  const nextApp = next({ dev: false, dir: APP_DIR });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  nextServer = http.createServer((req, res) => handle(req, res));
  await new Promise((resolve) => nextServer.listen(port, "127.0.0.1", resolve));
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: "ShortsDirector",
    backgroundColor: "#0a060e",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links (e.g. docs) in the user's browser, not the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(target);
    return { action: "deny" };
  });

  // When the user downloads an MP4/thumbnail, save it to their Downloads folder
  // and reveal it in Explorer/Finder so it's easy to find (nice desktop touch).
  mainWindow.webContents.session.on("will-download", (_event, item) => {
    const downloads = app.getPath("downloads");
    const dest = path.join(downloads, item.getFilename());
    item.setSavePath(dest);
    item.once("done", (_e, state) => {
      if (state === "completed") {
        try {
          shell.showItemInFolder(dest);
        } catch {
          /* ignore */
        }
      }
    });
  });

  mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    const port = await getFreePort();
    await startNext(port);
    await waitForServer(port);
    createWindow(`http://127.0.0.1:${port}`);
  } catch (err) {
    dialog.showErrorBox("ShortsDirector failed to start", String(err && err.stack ? err.stack : err));
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && mainWindow == null) {
      // window was closed on macOS; nothing to re-create without the port — quit path handles it
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  try {
    nextServer && nextServer.close();
  } catch {
    /* ignore */
  }
});
