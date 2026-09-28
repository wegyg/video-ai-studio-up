/**
 * Electron main process for ShortsDirector Desktop.
 *
 * Boots the existing Next.js app in-process (production mode) on a free
 * localhost port, waits until it responds, then opens it in a native window.
 * All rendering happens locally on the user's machine (fast, no cloud limits).
 * Free by default; optional API keys still work via env.
 */
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const CREDIT = "개발: 몸의중심 이성진 · 1877-7323";

// Application menu with a Korean "정보(About)" item showing the developer credit.
function installMenu() {
  const template = [
    {
      label: "숏츠디렉터",
      submenu: [
        {
          label: "정보",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "정보",
              message: "숏츠디렉터",
              detail: `${CREDIT}\n\n영상과 한 줄로 만드는 CF 스타일 숏츠 제작기`,
              buttons: ["확인"],
            });
          },
        },
        { type: "separator" },
        { label: "종료", role: "quit" },
      ],
    },
    {
      label: "편집",
      submenu: [
        { label: "실행 취소", role: "undo" },
        { label: "다시 실행", role: "redo" },
        { type: "separator" },
        { label: "잘라내기", role: "cut" },
        { label: "복사", role: "copy" },
        { label: "붙여넣기", role: "paste" },
        { label: "모두 선택", role: "selectAll" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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
  // Let the render pipeline resolve bundled assets (remotion entry) relative to
  // the app dir, since the packaged app's CWD is the executable folder.
  process.env.SD_APP_DIR = APP_DIR;
  // Keep a single Chromium tab per render on typical laptops.
  process.env.RENDER_MEDIA_CONCURRENCY = process.env.RENDER_MEDIA_CONCURRENCY || "1";
  process.env.RENDER_CONCURRENCY = process.env.RENDER_CONCURRENCY || "1";

  // Resolve the bundled ffmpeg/ffprobe HERE (plain Node context, resolution
  // works) and hand absolute paths to the Next server via env. The server's
  // code is webpack-bundled, where require("ffmpeg-static") can't be trusted —
  // so passing explicit paths is the reliable fix for "spawn ffmpeg ENOENT".
  try {
    const ffmpegStatic = require(path.join(APP_DIR, "node_modules", "ffmpeg-static"));
    const ffmpegAbs = typeof ffmpegStatic === "string" ? ffmpegStatic : ffmpegStatic?.path;
    if (ffmpegAbs) process.env.FFMPEG_PATH = process.env.FFMPEG_PATH || ffmpegAbs;
  } catch (e) {
    /* leave FFMPEG_PATH unset -> resolver falls back */
  }
  try {
    const ffprobeStatic = require(path.join(APP_DIR, "node_modules", "ffprobe-static"));
    const ffprobeAbs = typeof ffprobeStatic === "string" ? ffprobeStatic : ffprobeStatic?.path;
    if (ffprobeAbs) process.env.FFPROBE_PATH = process.env.FFPROBE_PATH || ffprobeAbs;
  } catch (e) {
    /* leave FFPROBE_PATH unset -> resolver falls back */
  }

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

// Append a line to a boot log in userData (helps diagnose startup issues).
function bootLog(msg) {
  try {
    const fs = require("node:fs");
    const p = path.join(app.getPath("userData"), "boot.log");
    fs.appendFileSync(p, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* ignore */
  }
}

app.whenReady().then(async () => {
  try {
    installMenu();
    bootLog("app ready; APP_DIR=" + APP_DIR + " packaged=" + app.isPackaged);
    const port = await getFreePort();
    bootLog("free port = " + port);
    await startNext(port);
    bootLog("next server started; FFMPEG_PATH=" + (process.env.FFMPEG_PATH || "(unset)"));
    await waitForServer(port);
    bootLog("server responding; opening window");
    // Write the live URL so external tooling/tests can find it.
    try {
      require("node:fs").writeFileSync(
        path.join(app.getPath("userData"), "server-url.txt"),
        `http://127.0.0.1:${port}`,
      );
    } catch {
      /* ignore */
    }
    createWindow(`http://127.0.0.1:${port}`);
    bootLog("window created OK");
  } catch (err) {
    bootLog("STARTUP ERROR: " + (err && err.stack ? err.stack : err));
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
