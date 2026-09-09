/**
 * Better Glorious Core - Main Process Hook
 * Loaded during Electron startup from out/main/index.js
 */
const fs = require('fs');
const path = require('path');

try {
  const electron = require('electron');
  const { app, BrowserWindow } = electron;

  console.log('\x1b[33m[Better Glorious Core]\x1b[0m Main process hook initialized.');

  // Load CSS and Renderer script from adjacent mod directory
  const modDir = __dirname;
  const themePath = path.join(modDir, 'theme.css');
  const rendererHookPath = path.join(modDir, 'renderer-hook.js');

  const themeCss = fs.existsSync(themePath) ? fs.readFileSync(themePath, 'utf8') : '';
  const rendererJs = fs.existsSync(rendererHookPath) ? fs.readFileSync(rendererHookPath, 'utf8') : '';

  /**
   * Injects mod styling and scripts into a target BrowserWindow
   */
  function attachModToWindow(win) {
    if (!win || !win.webContents) return;

    const wc = win.webContents;

    wc.on('dom-ready', () => {
      try {
        if (themeCss) {
          wc.insertCSS(themeCss).catch(() => {});
        }
        if (rendererJs) {
          wc.executeJavaScript(rendererJs).catch(() => {});
        }
      } catch (err) {
        console.error('[Better Glorious Core] Failed injecting into window:', err.message);
      }
    });

    // Optional: support F12 devtools toggle
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
        wc.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  // Attach to any existing windows
  if (BrowserWindow && BrowserWindow.getAllWindows) {
    BrowserWindow.getAllWindows().forEach(attachModToWindow);
  }

  // Hook all future browser windows
  if (app && app.on) {
    app.on('browser-window-created', (event, win) => {
      attachModToWindow(win);
    });
  }

  // -------------------------------------------------------------
  // System Tray Live Battery Tooltip & Low-Battery Notifications
  // -------------------------------------------------------------
  let activeTray = null;
  const OriginalTray = electron.Tray;

  if (OriginalTray) {
    class BetterTray extends OriginalTray {
      constructor(...args) {
        super(...args);
        activeTray = this;
        global._bgcTray = this;
      }
    }
    Object.setPrototypeOf(BetterTray, OriginalTray);
    electron.Tray = BetterTray;
  }

  const _deviceBatteryStates = new Map();
  const _lastNotified = new Map(); // deviceId -> timestamp

  function updateTrayBattery(deviceId, level, isCharging) {
    _deviceBatteryStates.set(deviceId, { level, isCharging, time: Date.now() });

    const tray = activeTray || global._bgcTray;
    if (tray && typeof tray.setToolTip === 'function') {
      let tooltipText = 'Better Glorious Core';
      for (const [id, state] of _deviceBatteryStates.entries()) {
        const chargingIcon = state.isCharging ? ' ⚡ (Charging)' : '';
        const name = (id && id !== 'default') ? id : 'Wireless Mouse';
        tooltipText += `\n${name}: ${state.level}%${chargingIcon}`;
      }
      try {
        tray.setToolTip(tooltipText);
      } catch (_) {}
    }
  }

  function checkLowBatteryNotification(deviceId, level, isCharging) {
    if (isCharging) return; // Do not alert when charging

    const now = Date.now();
    const lastAlert = _lastNotified.get(deviceId) || 0;
    const cooldownMs = 15 * 60 * 1000; // 15-minute cooldown per device

    if (level <= 15 && (now - lastAlert > cooldownMs)) {
      _lastNotified.set(deviceId, now);

      try {
        const { Notification } = electron;
        if (Notification && Notification.isSupported && Notification.isSupported()) {
          const isCritical = level <= 5;
          const notification = new Notification({
            title: isCritical ? '⚠️ Critical Mouse Battery!' : '🔋 Low Mouse Battery Warning',
            body: `Your wireless mouse battery is at ${level}%. Please plug in USB power soon!`,
            urgency: isCritical ? 'critical' : 'normal'
          });
          notification.show();
        }
      } catch (err) {
        console.error('[Better Glorious Core] Notification error:', err.message);
      }
    }
  }

  // Register battery telemetry event listener
  global._bgcOnBatteryUpdate = function (deviceId, level, isCharging) {
    updateTrayBattery(deviceId, level, isCharging);
    checkLowBatteryNotification(deviceId, level, isCharging);
  };

  // Network-level Telemetry & Analytics Blocker
  const TELEMETRY_URL_PATTERNS = [
    '*://*.sentry.io/*',
    '*://*.mixpanel.com/*',
    '*://*.google-analytics.com/*',
    '*://*.googletagmanager.com/*',
    '*://*.stats.gloriousgaming.com/*',
    '*://*.telemetry.gloriousgaming.com/*',
    '*://*.gloriousgaming.com/api/telemetry/*',
    '*://*.gloriousgaming.com/api/analytics/*',
    '*://*.gloriousgaming.com/api/update*',
    '*://*.gloriousgaming.com/downloads/core*',
    '*://update.electronjs.org/*'
  ];

  function setupTelemetryBlocker() {
    try {
      const { session } = electron;
      if (session && session.defaultSession && session.defaultSession.webRequest) {
        session.defaultSession.webRequest.onBeforeRequest(
          { urls: TELEMETRY_URL_PATTERNS },
          (details, callback) => {
            // Cancel telemetry and analytics network requests
            callback({ cancel: true });
          }
        );
        console.log('\x1b[32m[Better Glorious Core]\x1b[0m Telemetry & Analytics network blocker active.');
      }
    } catch (err) {
      console.error('[Better Glorious Core] Failed to register network blocker:', err.message);
    }
  }

  if (app && app.isReady && app.isReady()) {
    setupTelemetryBlocker();
  } else if (app && app.whenReady) {
    app.whenReady().then(setupTelemetryBlocker).catch(() => {});
  }
} catch (err) {
  console.error('[Better Glorious Core] Hook initialization error:', err);
}

module.exports = {
  initialized: true
};
