# 🪟 ShortsDirector on Windows

Two ways to get the app installed. **Option 1 needs nothing on your PC.**

---

## Option 1 — Download a prebuilt installer (easiest) ⭐

GitHub builds the Windows `.exe` for you on its own Windows servers.

### 1a. From Actions (any time)
1. Open the repo on GitHub → **Actions** tab.
2. Click **“Build Windows Installer”** → **Run workflow** → **Run**.
3. Wait ~5–10 min for the green check.
4. Open the finished run → scroll to **Artifacts** →
   download **`ShortsDirector-Windows-Installer`** (a zip).
5. Unzip → run **`ShortsDirector-Setup-<version>.exe`** → follow the installer.

### 1b. From a Release (permanent link)
If a maintainer pushes a version tag (e.g. `v0.1.0`), the same workflow attaches
the `.exe` to a **GitHub Release**. Go to the repo’s **Releases** page and
download it directly — no Actions needed.

> To create a release yourself:
> ```bash
> git tag v0.1.0
> git push origin v0.1.0
> ```
> The installer appears under **Releases** a few minutes later.

---

## Option 2 — Build it on your own PC

Requires **Node.js 18+** ([nodejs.org](https://nodejs.org)). Nothing else —
FFmpeg is bundled.

1. Download the repo (green **Code** button → **Download ZIP**, then unzip),
   or `git clone`.
2. In the project folder, **double-click `build-windows.bat`**.
   (Or run it in a terminal.)
3. When it finishes, the **`dist-desktop`** folder opens automatically.
4. Run **`ShortsDirector-Setup-<version>.exe`** to install.

---

## After installing

- Launch **ShortsDirector** from the Start Menu or desktop shortcut.
- It opens as a normal desktop window. Drop your clips + type a one-line brief →
  **Quick Generate** or **Review & Edit**.
- Everything runs on your PC — no internet needed for the free features, no
  usage bills.

### Optional upgrades (still free-friendly, no Google)
Set environment variables before launching for smarter scripts / spoken voice:
- `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` — e.g. Groq / OpenRouter
- `TTS_API_KEY`, `TTS_BASE_URL`, `TTS_MODEL`, `TTS_VOICE` — spoken narration

The app works fully without any of these.

## Notes
- The installer isn’t code-signed, so Windows SmartScreen may warn on first run
  (“More info → Run anyway”). This is normal for indie/unsigned apps.
- First launch downloads a small headless Chromium once (used for rendering).
