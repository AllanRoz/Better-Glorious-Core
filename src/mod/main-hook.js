/**
 * Better Glorious Core - Main Process Hook
 * Loaded during Electron startup from out/main/index.js
 */
const fs = require('fs');
const path = require('path');

let electron = null;
try {
  electron = require('electron');
} catch (_) {}

const { app, BrowserWindow, powerMonitor, ipcMain } = electron || {};

if (electron) {
  console.log('\x1b[33m[Better Glorious Core]\x1b[0m Main process hook initialized.');
}

  // Load CSS and Renderer script from adjacent mod directory
  const modDir = __dirname;
  const themePath = path.join(modDir, 'theme.css');
  const rendererHookPath = path.join(modDir, 'renderer-hook.js');

  const themeCss = fs.existsSync(themePath) ? fs.readFileSync(themePath, 'utf8') : '';
  const rendererJs = fs.existsSync(rendererHookPath) ? fs.readFileSync(rendererHookPath, 'utf8') : '';

  /**
   * Broadcasts an IPC message to all active BrowserWindow instances
   */
  function broadcastToWindows(channel, ...args) {
    try {
      if (BrowserWindow && BrowserWindow.getAllWindows) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (win && win.webContents && !win.webContents.isDestroyed()) {
            win.webContents.send(channel, ...args);
          }
        });
      }
    } catch (_) {}
  }

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
  // Power & Battery Configuration Management
  // -------------------------------------------------------------
  const userDataDir = (app && app.getPath) ? app.getPath('userData') : (process.env.APPDATA || __dirname);
  const POWER_CONFIG_FILE = path.join(userDataDir, 'bgc-power-config.json');
  const BATTERY_CACHE_FILE = path.join(userDataDir, 'bgc-battery-cache.json');

  const DEFAULT_POWER_CONFIG = {
    ecoModeEnabled: true,
    ecoModeThreshold: 20,       // Battery percentage to activate Eco Mode (<= 20%)
    turnOffRgbOnLock: true,     // Turn off or dim RGB when Windows is locked / screen off
    idleSleepTimeoutMinutes: 3, // Inactivity timeout in minutes (0 = disabled)
    estimateBatteryLife: true   // Calculate & display hours remaining in tooltip
  };

  let powerConfig = { ...DEFAULT_POWER_CONFIG };

  function loadPowerConfig() {
    try {
      if (fs.existsSync(POWER_CONFIG_FILE)) {
        const raw = JSON.parse(fs.readFileSync(POWER_CONFIG_FILE, 'utf8'));
        if (typeof raw === 'object' && raw !== null) {
          powerConfig = { ...DEFAULT_POWER_CONFIG, ...raw };
        }
      }
    } catch (_) {}
  }

  function savePowerConfig() {
    try {
      fs.writeFileSync(POWER_CONFIG_FILE, JSON.stringify(powerConfig, null, 2), 'utf8');
    } catch (_) {}
  }

  loadPowerConfig();

  // -------------------------------------------------------------
  // System Tray Live Battery, Eco Mode & Power Estimations
  // -------------------------------------------------------------
  let activeTray = null;
  const OriginalTray = electron ? electron.Tray : null;

  if (OriginalTray) {
    class BetterTray extends OriginalTray {
      constructor(...args) {
        super(...args);
        activeTray = this;
        global._bgcTray = this;
        setTimeout(() => updateTrayBattery(), 100);
      }
    }
    Object.setPrototypeOf(BetterTray, OriginalTray);
    if (electron) electron.Tray = BetterTray;
  }

  const _deviceBatteryStates = new Map();
  const _lastNotified = new Map(); // deviceId -> timestamp

  function loadBatteryCache() {
    try {
      if (fs.existsSync(BATTERY_CACHE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(BATTERY_CACHE_FILE, 'utf8'));
        if (typeof raw === 'object' && raw !== null) {
          for (const [k, v] of Object.entries(raw)) {
            _deviceBatteryStates.set(k, v);
          }
        }
      }
    } catch (_) {}
  }

  function saveBatteryCache() {
    try {
      const obj = {};
      for (const [k, v] of _deviceBatteryStates.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(BATTERY_CACHE_FILE, JSON.stringify(obj), 'utf8');
    } catch (_) {}
  }

  loadBatteryCache();

  /**
   * Calculates estimated battery discharge time or charging completion
   * @param {object} state
   * @returns {string|null}
   */
  function calculateBatteryEstimate(state) {
    if (!powerConfig.estimateBatteryLife || !state || typeof state.level !== 'number') {
      return null;
    }

    const { level, isCharging, history } = state;

    if (isCharging) {
      if (level >= 100) return 'Fully Charged';
      // Estimate charge time remaining (standard mice charge at ~40-60% per hr)
      const remainingPercent = 100 - level;
      const estimatedMinutes = Math.round((remainingPercent / 50) * 60);
      return estimatedMinutes < 60
        ? `~${estimatedMinutes}m to full`
        : `~${Math.floor(estimatedMinutes / 60)}h ${estimatedMinutes % 60}m to full`;
    }

    // When discharging: compute rate from history if available
    let ratePerHour = null;
    if (Array.isArray(history) && history.length >= 2) {
      const oldest = history[0];
      const newest = history[history.length - 1];
      const hoursDiff = (newest.time - oldest.time) / (1000 * 60 * 60);
      const levelDiff = oldest.level - newest.level;

      if (hoursDiff >= 0.05 && levelDiff > 0) {
        const computedRate = levelDiff / hoursDiff;
        // Sanity check: rate between 0.5% and 20% per hour
        if (computedRate >= 0.5 && computedRate <= 20) {
          ratePerHour = computedRate;
        }
      }
    }

    // Default discharge rate fallback (~1.6% per hr for typical 70-80h mouse battery)
    if (!ratePerHour) {
      ratePerHour = 1.6;
    }

    const hoursRemaining = Math.max(0.5, level / ratePerHour);
    if (hoursRemaining < 1) {
      return `~${Math.round(hoursRemaining * 60)}m remaining`;
    } else if (hoursRemaining < 24) {
      return `~${Math.round(hoursRemaining)}h remaining`;
    } else {
      const days = (hoursRemaining / 24).toFixed(1);
      return `~${days}d remaining`;
    }
  }

  function updateTrayBattery(deviceId, level, isCharging) {
    if (deviceId && typeof level === 'number') {
      const existing = _deviceBatteryStates.get(deviceId) || { history: [] };
      const history = Array.isArray(existing.history) ? [...existing.history] : [];

      const now = Date.now();
      // Record history if not charging and level changed or 5 mins passed
      if (!isCharging) {
        if (history.length === 0 || history[history.length - 1].level !== level || (now - history[history.length - 1].time > 5 * 60 * 1000)) {
          history.push({ time: now, level });
          if (history.length > 15) history.shift();
        }
      } else {
        // Clear discharge history when plugged in
        history.length = 0;
      }

      const ecoActive = Boolean(
        powerConfig.ecoModeEnabled && !isCharging && level <= powerConfig.ecoModeThreshold
      );

      const newState = {
        level,
        isCharging,
        time: now,
        ecoActive,
        history
      };

      _deviceBatteryStates.set(deviceId, newState);
      saveBatteryCache();

      // Check Eco Mode state transition
      checkEcoModeTransition(deviceId, newState, existing.ecoActive);
    }

    const tray = activeTray || global._bgcTray;
    if (tray && typeof tray.setToolTip === 'function') {
      let tooltipText = 'Better Glorious Core';
      for (const [id, state] of _deviceBatteryStates.entries()) {
        const chargingIcon = state.isCharging ? ' ⚡ (Charging' : '';
        const name = (id && id !== 'default') ? id : 'Wireless Mouse';
        const estimate = calculateBatteryEstimate(state);
        const estimateStr = estimate ? ` (${estimate})` : '';
        const ecoStr = state.ecoActive ? ' 🔋 [Eco Mode]' : '';

        if (state.isCharging) {
          tooltipText += `\n${name}: ${state.level}%${chargingIcon}${estimateStr ? `, ${estimateStr.trim()}` : ''})`;
        } else {
          tooltipText += `\n${name}: ${state.level}%${estimateStr}${ecoStr}`;
        }
      }
      try {
        tray.setToolTip(tooltipText);
      } catch (_) {}
    }
  }

  /**
   * Handles Eco Mode transitions and notifications
   */
  function checkEcoModeTransition(deviceId, currentState, wasEcoActive) {
    if (!powerConfig.ecoModeEnabled) return;

    if (currentState.ecoActive && !wasEcoActive) {
      // Engaged Eco Mode
      broadcastToWindows('bgc:power-mode', {
        deviceId,
        ecoMode: true,
        level: currentState.level
      });

      sendNotification(
        '🔋 Low Battery Eco Mode Engaged',
        `Wireless mouse is at ${currentState.level}%. RGB lighting is dimmed to extend battery life.`
      );
    } else if (!currentState.ecoActive && wasEcoActive) {
      // Disengaged Eco Mode
      broadcastToWindows('bgc:power-mode', {
        deviceId,
        ecoMode: false,
        level: currentState.level
      });

      sendNotification(
        '⚡ Normal Power Mode Restored',
        `Wireless mouse battery is at ${currentState.level}%. Full lighting restored.`
      );
    }
  }

  function checkLowBatteryNotification(deviceId, level, isCharging) {
    if (isCharging) return; // Do not alert when charging

    const now = Date.now();
    const lastAlert = _lastNotified.get(deviceId) || 0;
    const cooldownMs = 15 * 60 * 1000; // 15-minute cooldown per device

    if (level <= 15 && (now - lastAlert > cooldownMs)) {
      _lastNotified.set(deviceId, now);
      const isCritical = level <= 5;
      sendNotification(
        isCritical ? '⚠️ Critical Mouse Battery!' : '🔋 Low Mouse Battery Warning',
        `Your wireless mouse battery is at ${level}%. Please plug in USB power soon!`,
        isCritical ? 'critical' : 'normal'
      );
    }
  }

  function sendNotification(title, body, urgency = 'normal') {
    try {
      const Notification = electron ? electron.Notification : null;
      if (Notification && Notification.isSupported && Notification.isSupported()) {
        const notification = new Notification({
          title,
          body,
          urgency
        });
        notification.show();
      }
    } catch (err) {
      console.error('[Better Glorious Core] Notification error:', err.message);
    }
  }

  // Register battery telemetry event listener
  global._bgcOnBatteryUpdate = function (deviceId, level, isCharging) {
    updateTrayBattery(deviceId, level, isCharging);
    checkLowBatteryNotification(deviceId, level, isCharging);
  };

  // -------------------------------------------------------------
  // Electron powerMonitor & Inactivity Standby
  // -------------------------------------------------------------
  let isSystemLockedOrSuspended = false;
  let isSystemIdle = false;

  function handleSystemLockOrSuspend(eventType) {
    if (!powerConfig.turnOffRgbOnLock) return;
    isSystemLockedOrSuspended = true;
    console.log(`\x1b[33m[Better Glorious Core]\x1b[0m System ${eventType} detected. Dimming/Turning off RGB.`);
    broadcastToWindows('bgc:system-sleep', { active: true, reason: eventType });
  }

  function handleSystemUnlockOrResume(eventType) {
    isSystemLockedOrSuspended = false;
    console.log(`\x1b[32m[Better Glorious Core]\x1b[0m System ${eventType} detected. Restoring lighting.`);
    broadcastToWindows('bgc:system-sleep', { active: false, reason: eventType });

    // Request immediate battery refresh
    if (typeof global._bgcRequestBatteryStats === 'function') {
      try {
        global._bgcRequestBatteryStats();
      } catch (_) {}
    }
  }

  if (powerMonitor && powerMonitor.on) {
    try {
      powerMonitor.on('lock-screen', () => handleSystemLockOrSuspend('lock-screen'));
      powerMonitor.on('suspend', () => handleSystemLockOrSuspend('suspend'));
      powerMonitor.on('unlock-screen', () => handleSystemUnlockOrResume('unlock-screen'));
      powerMonitor.on('resume', () => handleSystemUnlockOrResume('resume'));
    } catch (err) {
      console.error('[Better Glorious Core] PowerMonitor listener error:', err.message);
    }
  }

  // Periodic Idle Sleep Check
  if (powerMonitor && typeof powerMonitor.getSystemIdleTime === 'function') {
    setInterval(() => {
      if (isSystemLockedOrSuspended) return;
      if (!powerConfig.idleSleepTimeoutMinutes || powerConfig.idleSleepTimeoutMinutes <= 0) return;

      try {
        const idleSeconds = powerMonitor.getSystemIdleTime();
        const thresholdSeconds = powerConfig.idleSleepTimeoutMinutes * 60;

        if (idleSeconds >= thresholdSeconds && !isSystemIdle) {
          isSystemIdle = true;
          broadcastToWindows('bgc:system-idle', { idle: true });
        } else if (idleSeconds < 5 && isSystemIdle) {
          isSystemIdle = false;
          broadcastToWindows('bgc:system-idle', { idle: false });
        }
      } catch (_) {}
    }, 15000);
  }

  // -------------------------------------------------------------
  // IPC Handlers for Power Management Settings & Stats
  // -------------------------------------------------------------
  if (ipcMain && ipcMain.handle) {
    ipcMain.handle('bgc:get-power-config', () => powerConfig);
    ipcMain.handle('bgc:set-power-config', (event, newConfig) => {
      if (typeof newConfig === 'object' && newConfig !== null) {
        powerConfig = { ...powerConfig, ...newConfig };
        savePowerConfig();
        updateTrayBattery();
      }
      return powerConfig;
    });
    ipcMain.handle('bgc:get-battery-stats', () => {
      const result = {};
      for (const [k, v] of _deviceBatteryStates.entries()) {
        result[k] = {
          ...v,
          estimate: calculateBatteryEstimate(v)
        };
      }
      return result;
    });
  }

  // -------------------------------------------------------------
  // Network-level Telemetry & Analytics Blocker
  // -------------------------------------------------------------
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
      const session = electron ? electron.session : null;
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



module.exports = {
  initialized: true,
  DEFAULT_POWER_CONFIG: typeof DEFAULT_POWER_CONFIG !== 'undefined' ? DEFAULT_POWER_CONFIG : null,
  calculateBatteryEstimate: typeof calculateBatteryEstimate !== 'undefined' ? calculateBatteryEstimate : null
};

