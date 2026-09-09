# Better Glorious Core ⚡

> Open-source modding framework and automated patcher for the official **Glorious Core v2.x** Electron application (Windows).

Similar in spirit to *BetterDiscord* or *ReVanced*, **Better Glorious Core** distributes **strictly mod code and patch automation**—never proprietary vendor binaries. This keeps the repository lightweight, secure, and fully compliant for open-source distribution.

---

## ✨ Features

- 🔍 **Intelligent Detection**: Auto-locates Glorious Core across standard paths (`Program Files`, `AppData/Programs`) and the Windows Registry, with support for custom directory overrides.
- 🛡️ **Fail-Safe Stock Backups**: Automatically creates `app.asar.original` before touching a single file. Guaranteed never to overwrite existing backups.
- 🔄 **One-Command Rollback**: Instant restore to 100% clean vendor stock with `npm run restore` (or `--restore`).
- 🛑 **Process Safety**: Verifies that Glorious Core is closed prior to modifying files, preventing file locks and archive corruption.
- 🔋 **Battery Percentage & Telemetry Fix**: Unhides numerical percentage text (`showValue: true`) and resolves the unpadded hex VID/PID comparison bug (`0x93a` vs `0x093a`) that permanently freezes wireless mice (such as Model D 2 Wireless) at 100%.
- 🛡️ **Telemetry & Analytics Blocker**: Neutralizes Sentry error reporting and installs a network-level interceptor blocking outgoing traffic to Mixpanel, Google Analytics, Sentry, and Glorious tracking domains.
- 🎨 **Sleek Custom Aesthetics**: Injects modern dark mode styling, custom scrollbars, and non-intrusive status indicators without modifying minified vendor bundles directly.
- 🔌 **Dynamic Mod Loader**: Injects an Electron `BrowserWindow` lifecycle hook into the main process, allowing live CSS and JavaScript injection into the renderer at runtime.
- 📦 **Native Dependency Unpacking**: Pre-configured with Glorious Core's required unpacking glob: `{*.node,*@koromix*,*jszip*,*keytar*}`.
- 🚀 **Portable Executable Support**: Ready to compile into a single standalone `.exe` using `npm run build`.

---

## 📂 Project Architecture

```
Better-Glorious-Core/
├── package.json
├── README.md
├── src/
│   ├── index.js               # CLI entry point (interactive menu & CLI flags)
│   ├── detector.js            # Installation detector (Registry, AppData, Program Files)
│   ├── process.js             # Windows process detection (tasklist) & safety checks
│   ├── asar.js                # Safe @electron/asar extractor & repacker with unpack rules
│   ├── backup.js              # Permanent backup manager (app.asar.original)
│   ├── restorer.js            # Stock rollback engine
│   ├── patches/
│   │   ├── index.js           # Patch runner & registry
│   │   ├── branding.js        # Rebrands app metadata, IPC pipe handle, & titles
│   │   ├── hook-loader.js     # Injects mod loader into out/main/index.js
│   │   ├── battery.js         # Battery UI percentage & HID hex telemetry fix
│   │   └── telemetry.js       # Sentry & analytics blocker
│   └── mod/
│       ├── main-hook.js       # Main process runtime hook: browser window interceptor & network blocker
│       ├── renderer-hook.js   # Injected into DOM: banner, mod API, status badge
│       └── theme.css          # Modern dark CSS enhancements
└── test/
    ├── fixture.js             # Mock Glorious Core v2 generator
    └── patcher.test.js        # Automated unit and integration test suite
```

---

## 🚀 Quick Start

### Requirements
- **Windows 10 / 11**
- **Node.js v18+** (or prebuilt standalone `.exe`)
- **Glorious Core v2.x** installed

### Installation & Patching

```bash
# Clone the repository
git clone https://github.com/AllanRoz/Better-Glorious-Core.git
cd Better-Glorious-Core

# Install dependencies
npm install

# Run the interactive CLI patcher
npm start
```

Or run directly with convenience scripts:

```bash
# Install the Better Glorious Core mod
npm run patch

# Check current installation and patch status
npm run status

# Restore original stock Glorious Core
npm run restore
```

---

## 💻 CLI Flags & Options

```
Usage: better-glorious-core [options]

Automated patcher and mod injector for Glorious Core v2.x

Options:
  -V, --version       output the version number
  -p, --patch         Patch Glorious Core with Better Glorious Core mod
  -r, --restore       Restore original stock Glorious Core from backup
  -s, --status        Show installation and patch status
  --path <path>       Specify custom Glorious Core installation directory
  -f, --force         Skip confirmation prompts
  --kill              Automatically terminate running Glorious Core processes
  --unpack <pattern>  Custom unpack glob pattern for asar repacking (default: {*.node,*@koromix*,*jszip*,*keytar*})
  -h, --help          display help for command
```

### Examples

```bash
# Non-interactive patch specifying custom installation path
node src/index.js --path "D:\Games\Glorious Core" --patch -f

# Restore stock application and terminate any running instance
node src/index.js --restore --kill -f
```

---

## 🛠️ How It Works

1. **Detection**: `src/detector.js` inspects `HKCU`/`HKLM` uninstall registry keys and standard `%LOCALAPPDATA%\Programs\Glorious Core` or `C:\Program Files\Glorious Core`.
2. **Safety Check**: `src/process.js` checks Windows tasklist for running Glorious instances to avoid locked file errors.
3. **Pristine Backup**: `src/backup.js` copies `<resources>/app.asar` to `<resources>/app.asar.original`. If this file already exists, it is **never overwritten**, ensuring your original vendor software is permanently preserved.
4. **Extraction**: `src/asar.js` extracts the archive into an isolated temporary workspace.
5. **Branding & IPC**: `src/patches/branding.js` updates `package.json`, renames the IPC pipe handle name so it won't collide with stock instances, and updates window and system tray titles.
6. **Mod Hook Injection**: `src/patches/hook-loader.js` embeds `src/mod/` into the package and inserts a minimal, non-destructive `require('./mod/main-hook.js')` into the main process entry point.
7. **Repack**: `src/asar.js` repacks the archive with the unpack rule `{*.node,*@koromix*,*jszip*,*keytar*}` and atomically replaces `app.asar`.
8. **Runtime Mod**: When Glorious Core starts, `main-hook.js` intercepts Electron `BrowserWindow` creation, injecting `theme.css` and `renderer-hook.js` whenever the UI loads.

---

## 🧪 Testing

The repository contains an offline test harness that synthesizes a mock Glorious Core v2 ASAR archive and runs the complete detection, backup, patch, repack, unpack glob, and rollback cycle:

```bash
npm test
```

---

## 🔨 Building Portable Executable

To generate a standalone `.exe` that does not require users to install Node.js:

```bash
npm run build
```

This compiles the patcher into `dist/better-glorious-core.exe`.

---

## ⚖️ Disclaimer

Better Glorious Core is an unofficial third-party project and is not affiliated with, endorsed by, or associated with Glorious LLC. Glorious Core is a registered trademark of Glorious LLC. This project complies with fair use by distributing zero proprietary binaries or assets.

## 📄 License

MIT © [Better Glorious Core Contributors](LICENSE)