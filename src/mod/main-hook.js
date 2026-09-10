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
  const DEBUG_LOG_FILE = path.join(userDataDir, 'bgc-debug.log');

  function logDebug(msg) {
    try {
      fs.appendFileSync(DEBUG_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
    } catch (_) {}
  }
  global._bgcLog = logDebug;
  logDebug('Better Glorious Core main process hook initialized.');

  const DEFAULT_POWER_CONFIG = {
    ecoModeEnabled: true,
    ecoModeThreshold: 20,       // Battery percentage to activate Eco Mode (<= 20%)
    turnOffRgbOnLock: true,     // Turn off or dim RGB when Windows is locked / screen off
    idleSleepTimeoutMinutes: 3, // Inactivity timeout in minutes (0 = disabled)
    estimateBatteryLife: true,  // Calculate & display hours remaining in tooltip
    osdEnabled: true,           // On-Screen Display HUD for DPI cycling
    osdDurationMs: 1500,        // OSD display duration before auto-fade
    osdPosition: 'bottom-right' // 'bottom-right', 'top-right', 'bottom-center', 'top-center'
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

  let defaultDeviceName = 'Model D 2 Wireless';
  let currentDpiStage = 1;
  let totalDpiStages = 4;
  let lastKnownDpi = 800;
  let cachedDpiStages = [
    { value: 400, color: '#FFA40D' },
    { value: 800, color: '#26B4FF' },
    { value: 1600, color: '#FF2626' },
    { value: 3200, color: '#18B30A' }
  ];

  function loadInitialProfileData() {
    try {
      const devFile = path.join(userDataDir, 'datastore', 'Devices.json');
      const profFile = path.join(userDataDir, 'datastore', 'DeviceProfiles.json');

      if (fs.existsSync(profFile)) {
        const profData = JSON.parse(fs.readFileSync(profFile, 'utf8'));
        const profiles = profData?.profiles || (Array.isArray(profData) ? profData : []);
        for (const p of profiles) {
          const perf = p?.mousePerformanceRecord || p?.mousePerformanceState;
          if (perf && Array.isArray(perf.DpiStage) && perf.DpiStage.length > 0) {
            cachedDpiStages = perf.DpiStage;
            totalDpiStages = perf.DpiStage.length;
            if (typeof perf.dpiSelectIndex === 'number') {
              currentDpiStage = perf.dpiSelectIndex + 1;
            }
            const activeStage = cachedDpiStages[currentDpiStage - 1] || cachedDpiStages[0];
            if (activeStage && typeof activeStage.value === 'number') {
              lastKnownDpi = activeStage.value;
            }
            break;
          }
        }
      }

      if (fs.existsSync(devFile)) {
        const devData = JSON.parse(fs.readFileSync(devFile, 'utf8'));
        const instances = devData?.deviceInstances || [];
        if (instances.length > 0 && instances[0].productId) {
          defaultDeviceName = instances[0].productId;
        }
      }
    } catch (_) {}
  }

  loadInitialProfileData();

  loadPowerConfig();

  // -------------------------------------------------------------
  // System Tray Live Battery, Eco Mode & Power Estimations
  // -------------------------------------------------------------
  let activeTray = null;
  const OriginalTray = electron ? electron.Tray : null;

  function registerActiveTray(trayInstance) {
    if (trayInstance) {
      activeTray = trayInstance;
      global._bgcTray = trayInstance;
    }
  }

  global._bgcOnTrayCreated = function (trayInstance) {
    registerActiveTray(trayInstance);
    logDebug('Tray registered via global._bgcOnTrayCreated');
    setTimeout(() => updateTrayBattery(), 100);
  };

  if (OriginalTray && OriginalTray.prototype) {
    const origSetToolTip = OriginalTray.prototype.setToolTip;
    OriginalTray.prototype.setToolTip = function (tip) {
      registerActiveTray(this);
      if (tip && !tip.includes('\n')) {
        this._baseToolTip = tip;
      }
      const fullTip = formatTrayTooltip(this._baseToolTip || 'Better Glorious Core');
      return origSetToolTip ? origSetToolTip.call(this, fullTip) : undefined;
    };

    const origSetContextMenu = OriginalTray.prototype.setContextMenu;
    if (origSetContextMenu) {
      OriginalTray.prototype.setContextMenu = function (...args) {
        registerActiveTray(this);
        return origSetContextMenu.apply(this, args);
      };
    }

    const origSetTitle = OriginalTray.prototype.setTitle;
    if (origSetTitle) {
      OriginalTray.prototype.setTitle = function (...args) {
        registerActiveTray(this);
        return origSetTitle.apply(this, args);
      };
    }

    class BetterTray extends OriginalTray {
      constructor(...args) {
        super(...args);
        registerActiveTray(this);
        this._baseToolTip = 'Better Glorious Core';
        logDebug('BetterTray constructor invoked');
        setTimeout(() => updateTrayBattery(), 100);
      }
      setToolTip(tip) {
        registerActiveTray(this);
        if (tip && !tip.includes('\n')) {
          this._baseToolTip = tip;
        }
        const fullTip = formatTrayTooltip(this._baseToolTip || 'Better Glorious Core');
        return super.setToolTip(fullTip);
      }
    }
    Object.setPrototypeOf(BetterTray, OriginalTray);
    try {
      Object.defineProperty(electron, 'Tray', {
        configurable: true,
        enumerable: true,
        get: () => BetterTray,
        set: () => {}
      });
    } catch (_) {
      try { electron.Tray = BetterTray; } catch (_) {}
    }
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
    const hrs = Math.round(hoursRemaining);
    if (hoursRemaining < 1) {
      return `~${Math.round(hoursRemaining * 60)}m remaining`;
    } else if (hoursRemaining < 24) {
      return `~${hrs}h remaining`;
    } else {
      const days = (hoursRemaining / 24).toFixed(1);
      return `~${hrs}h remaining (~${days}d)`;
    }
  }

  function normalizeDeviceId(id) {
    let raw = id;
    if (!raw || raw === 'default' || raw === 'mouse' || raw === 'Wireless Mouse') {
      raw = defaultDeviceName || 'Model D 2 Wireless';
    }
    return String(raw)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
      .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatTrayTooltip(baseText = 'Better Glorious Core') {
    let tooltipText = baseText || 'Better Glorious Core';
    if (_deviceBatteryStates.size === 0) {
      loadBatteryCache();
    }

    const seenNames = new Set();
    for (const [rawId, state] of _deviceBatteryStates.entries()) {
      const name = normalizeDeviceId(rawId);
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      const chargingIcon = state.isCharging ? ' ⚡ Charging' : '';
      const ecoStr = state.ecoActive ? ' 🔋 [Eco]' : '';

      if (state.isCharging) {
        tooltipText += `\n${name}: ${state.level}%${chargingIcon}`;
      } else {
        tooltipText += `\n${name}: ${state.level}%${ecoStr}`;
      }
    }

    if (tooltipText.length > 125) {
      tooltipText = tooltipText.substring(0, 122) + '...';
    }
    return tooltipText;
  }

  function updateTrayBattery(deviceId, level, isCharging) {
    if (deviceId && typeof level === 'number') {
      const normId = normalizeDeviceId(deviceId);
      const existing = _deviceBatteryStates.get(normId) || { history: [] };
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

      _deviceBatteryStates.set(normId, newState);

      // Clean up any un-normalized duplicate keys
      for (const k of Array.from(_deviceBatteryStates.keys())) {
        if (k !== normId && normalizeDeviceId(k) === normId) {
          _deviceBatteryStates.delete(k);
        }
      }

      saveBatteryCache();

      // Broadcast update to renderer windows so in-app UI gets real-time telemetry
      broadcastToWindows('bgc:battery-update', {
        deviceId: normId,
        level,
        isCharging,
        estimate: calculateBatteryEstimate(newState)
      });

      // Check Eco Mode state transition
      checkEcoModeTransition(normId, newState, existing.ecoActive);
    }

    const tray = activeTray || global._bgcTray;
    if (tray && typeof tray.setToolTip === 'function') {
      try {
        const fullTip = formatTrayTooltip(tray._baseToolTip || 'Better Glorious Core');
        logDebug(`Tray tooltip updated: "${fullTip.replace(/\n/g, ' \\n ')}" (len=${fullTip.length})`);
        if (typeof OriginalTray?.prototype?.setToolTip === 'function') {
          OriginalTray.prototype.setToolTip.call(tray, fullTip);
        } else {
          tray.setToolTip(fullTip);
        }
      } catch (_) {}
    }
  }

  // Recurring refresh to ensure live battery and time remaining estimate are always accurate
  setInterval(() => {
    try {
      const tray = activeTray || global._bgcTray;
      if (tray && typeof tray.setToolTip === 'function') {
        const fullTip = formatTrayTooltip(tray._baseToolTip || 'Better Glorious Core');
        if (typeof OriginalTray?.prototype?.setToolTip === 'function') {
          OriginalTray.prototype.setToolTip.call(tray, fullTip);
        } else {
          tray.setToolTip(fullTip);
        }
      }
    } catch (_) {}
  }, 15000);

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
  // On-Screen Display (OSD) / DPI Overlay Window Manager
  // -------------------------------------------------------------
  let osdWindow = null;
  let osdHideTimeout = null;
  const osdHtmlPath = path.join(modDir, 'osd.html');
  let osdHtmlContent = '';
  try {
    if (fs.existsSync(osdHtmlPath)) {
      osdHtmlContent = fs.readFileSync(osdHtmlPath, 'utf8');
    }
  } catch (_) {}

  function calculateOsdPosition(posSetting = 'bottom-right', winWidth = 300, winHeight = 95) {
    try {
      const screen = electron ? electron.screen : null;
      if (!screen || typeof screen.getPrimaryDisplay !== 'function') {
        return { x: 100, y: 100 };
      }
      const primaryDisplay = screen.getPrimaryDisplay();
      const area = primaryDisplay.workArea || primaryDisplay.bounds;
      const margin = 28;

      let x, y;
      switch (posSetting) {
        case 'top-right':
          x = area.x + area.width - winWidth - margin;
          y = area.y + margin;
          break;
        case 'bottom-center':
          x = area.x + Math.floor((area.width - winWidth) / 2);
          y = area.y + area.height - winHeight - margin;
          break;
        case 'top-center':
          x = area.x + Math.floor((area.width - winWidth) / 2);
          y = area.y + margin;
          break;
        case 'bottom-right':
        default:
          x = area.x + area.width - winWidth - margin;
          y = area.y + area.height - winHeight - margin;
          break;
      }
      return { x: Math.round(x), y: Math.round(y) };
    } catch (_) {
      return { x: 100, y: 100 };
    }
  }

  let isOsdReady = false;
  let pendingOsdData = null;
  let isOsdInitialized = false;

  function createOsdWindow() {
    if (!BrowserWindow || osdWindow || !electron) return null;

    try {
      const { x, y } = calculateOsdPosition(powerConfig.osdPosition);

      osdWindow = new BrowserWindow({
        width: 300,
        height: 95,
        x,
        y,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        show: false,
        hasShadow: false,
        resizable: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          sandbox: false
        }
      });

      try {
        if (typeof osdWindow.setIgnoreMouseEvents === 'function') {
          osdWindow.setIgnoreMouseEvents(true);
        }
      } catch (_) {}

      try {
        if (typeof osdWindow.setVisibleOnAllWorkspaces === 'function') {
          osdWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        }
      } catch (_) {}

      try {
        if (typeof osdWindow.setAlwaysOnTop === 'function') {
          osdWindow.setAlwaysOnTop(true, 'screen-saver');
        }
      } catch (_) {}

      if (osdHtmlContent) {
        osdWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(osdHtmlContent)}`);
      } else if (fs.existsSync(osdHtmlPath)) {
        osdWindow.loadFile(osdHtmlPath);
      }

      osdWindow.webContents.on('did-finish-load', () => {
        isOsdReady = true;
        logDebug('OSD window loaded and ready');
        if (pendingOsdData) {
          const data = pendingOsdData;
          pendingOsdData = null;
          showDpiOsd(data);
        }
      });

      osdWindow.on('closed', () => {
        osdWindow = null;
        isOsdReady = false;
      });

      return osdWindow;
    } catch (err) {
      console.error('[Better Glorious Core] Failed to create OSD window:', err.message);
      return null;
    }
  }

  // Preload OSD window on app ready
  if (app && app.whenReady) {
    app.whenReady().then(() => {
      setTimeout(() => {
        try {
          if (!osdWindow && powerConfig.osdEnabled) {
            createOsdWindow();
          }
        } catch (_) {}
      }, 1000);
    });
  }

  function showDpiOsd(data) {
    if (!powerConfig.osdEnabled) return;

    logDebug(`showDpiOsd invoked: data=${JSON.stringify(data)}, isOsdReady=${isOsdReady}, hasOsdWindow=${Boolean(osdWindow)}`);

    if (!osdWindow || osdWindow.isDestroyed()) {
      createOsdWindow();
    }

    if (!isOsdReady || !osdWindow || !osdWindow.webContents || osdWindow.isDestroyed()) {
      pendingOsdData = data;
      return;
    }

    try {
      if (osdHideTimeout) {
        clearTimeout(osdHideTimeout);
        osdHideTimeout = null;
      }

      const { x, y } = calculateOsdPosition(powerConfig.osdPosition);
      try {
        osdWindow.setPosition(x, y);
      } catch (_) {}

      const payloadJson = JSON.stringify(data);
      if (osdWindow.webContents && !osdWindow.webContents.isDestroyed()) {
        osdWindow.webContents.executeJavaScript(`
          if (typeof window.updateDpi === 'function') {
            window.updateDpi(${payloadJson});
          }
        `).catch(() => {});
        try {
          osdWindow.webContents.send('bgc:osd-dpi', data);
        } catch (_) {}
      }

      try {
        osdWindow.setAlwaysOnTop(true, 'screen-saver');
        osdWindow.moveTop();
        if (typeof osdWindow.showInactive === 'function') {
          osdWindow.showInactive();
        } else {
          osdWindow.show();
        }
      } catch (_) {}

      const duration = Number(powerConfig.osdDurationMs) || 1500;
      osdHideTimeout = setTimeout(() => {
        try {
          if (osdWindow && !osdWindow.isDestroyed()) {
            if (osdWindow.webContents && !osdWindow.webContents.isDestroyed()) {
              osdWindow.webContents.executeJavaScript(`
                if (typeof window.hideDpi === 'function') {
                  window.hideDpi();
                }
              `).catch(() => {});
              try {
                osdWindow.webContents.send('bgc:osd-hide');
              } catch (_) {}
            }
            setTimeout(() => {
              try {
                if (osdWindow && !osdWindow.isDestroyed()) {
                  osdWindow.hide();
                }
              } catch (_) {}
            }, 250);
          }
        } catch (_) {}
      }, duration);
    } catch (err) {
      console.error('[Better Glorious Core] OSD show error:', err.message);
    }
  }

  function getActiveMouseAndHandler() {
    try {
      const devClass = global._bgcDeviceClass;
      if (devClass && Array.isArray(devClass.gloriousDevices)) {
        const mouse = devClass.gloriousDevices.find(d => 
          d?.supportedDeviceData?.category === 'Mouse' || 
          d?.supportedDeviceData?.category === 'mouse' ||
          d?.rendererState?.productId?.toLowerCase().includes('model')
        );
        if (mouse) {
          const handler = (typeof devClass.getDeviceHandler === 'function')
            ? devClass.getDeviceHandler(mouse.supportedDeviceData?.productId)
            : null;
          return { device: mouse, handler };
        }
      }
    } catch (_) {}
    return { device: null, handler: null };
  }

  let isApplyingDpi = false;
  let pendingDpiPerf = null;

  async function applyHardwareDpi(handler, device, perfState) {
    if (!handler || typeof handler.setPerformance !== 'function' || !device) return;
    if (isApplyingDpi) {
      pendingDpiPerf = { handler, device, perfState };
      return;
    }
    isApplyingDpi = true;
    try {
      logDebug(`Applying hardware DPI via setPerformance: stageIndex=${perfState.dpiSelectIndex + 1}`);
      await handler.setPerformance(device.rendererState, perfState);
      logDebug(`Hardware DPI setPerformance completed successfully`);
    } catch (err) {
      logDebug(`handler.setPerformance error: ${err?.message || err}`);
    } finally {
      isApplyingDpi = false;
      if (pendingDpiPerf) {
        const next = pendingDpiPerf;
        pendingDpiPerf = null;
        applyHardwareDpi(next.handler, next.device, next.perfState);
      }
    }
  }

  let lastDpiClickTime = 0;
  function triggerDpiCycle(direction = 'up', explicitStage = null, devName = null) {
    const now = Date.now();
    if (explicitStage === null && now - lastDpiClickTime < 150) {
      return; // Debounce hardware switch chatter
    }
    lastDpiClickTime = now;

    if (typeof explicitStage === 'number') {
      currentDpiStage = Math.max(1, Math.min(totalDpiStages || 4, explicitStage));
    } else if (direction === 'down') {
      currentDpiStage = currentDpiStage <= 1 ? (totalDpiStages || 4) : currentDpiStage - 1;
    } else {
      currentDpiStage = (currentDpiStage % (totalDpiStages || 4)) + 1;
    }

    let activeColor;
    let activeDpi = lastKnownDpi;
    if (Array.isArray(cachedDpiStages) && cachedDpiStages.length >= currentDpiStage) {
      const stageObj = cachedDpiStages[currentDpiStage - 1];
      if (stageObj) {
        activeDpi = stageObj.value || lastKnownDpi;
        activeColor = stageObj.color ? (stageObj.color.startsWith('#') ? stageObj.color : '#' + stageObj.color) : undefined;
      }
    }

    logDebug(`triggerDpiCycle: stage=${currentDpiStage}, dpi=${activeDpi}, dir=${direction}`);
    showDpiOsd({
      dpi: activeDpi,
      stageIndex: currentDpiStage,
      totalStages: totalDpiStages || 4,
      color: activeColor,
      deviceName: devName || defaultDeviceName || 'Model D 2 Wireless'
    });

    const { device: activeDev, handler: activeHandler } = getActiveMouseAndHandler();
    if (activeDev && activeHandler) {
      const perfState = activeDev.rendererState?.currentProfileData?.mousePerformanceState;
      if (perfState) {
        perfState.dpiSelectIndex = currentDpiStage - 1;
        applyHardwareDpi(activeHandler, activeDev, perfState);
      }
    }
  }

  // Exposed for direct invocation by Glorious Core handlers or patches
  global._bgcOnDpiButtonPress = function (buttonId, device, handler) {
    const now = Date.now();
    if (now - lastDpiClickTime < 150) {
      return; // Debounce hardware switch chatter
    }
    lastDpiClickTime = now;

    logDebug(`_bgcOnDpiButtonPress received: buttonId=${buttonId}`);
    
    let activeDev = device;
    let activeHandler = handler;
    if (!activeDev || !activeHandler) {
      const found = getActiveMouseAndHandler();
      if (!activeDev) activeDev = found.device;
      if (!activeHandler) activeHandler = found.handler;
    }

    const devName = activeDev?.supportedDeviceData?.name || activeDev?.rendererState?.deviceName || defaultDeviceName || 'Model D 2 Wireless';
    const profile = activeDev?.rendererState?.currentProfileData;
    const perfState = profile?.mousePerformanceState;

    if (perfState && Array.isArray(perfState.DpiStage) && perfState.DpiStage.length > 0) {
      const stages = perfState.DpiStage;
      const total = stages.length;
      let currIdx = typeof perfState.dpiSelectIndex === 'number' ? perfState.dpiSelectIndex : 0;
      let nextIdx;
      if (buttonId === 6) { // DPICycleDown
        nextIdx = (currIdx - 1 + total) % total;
      } else { // DPICycleUp / button 5
        nextIdx = (currIdx + 1) % total;
      }
      perfState.dpiSelectIndex = nextIdx;
      currentDpiStage = nextIdx + 1;
      totalDpiStages = total;
      cachedDpiStages = stages;

      const activeStage = stages[nextIdx];
      lastKnownDpi = activeStage.value;

      logDebug(`Cycling DPI button: nextIdx=${nextIdx} (stage ${currentDpiStage}/${total}, ${lastKnownDpi} DPI, color ${activeStage.color})`);

      // 1. Show OSD
      showDpiOsd({
        dpi: activeStage.value,
        stageIndex: currentDpiStage,
        totalStages: total,
        color: activeStage.color ? (activeStage.color.startsWith('#') ? activeStage.color : '#' + activeStage.color) : undefined,
        deviceName: devName
      });

      // 2. Hardware update: switch sensor DPI and hardware LED
      if (activeHandler && activeDev) {
        applyHardwareDpi(activeHandler, activeDev, perfState);
      }

      // 3. Emit to UI window if open
      try {
        if (typeof EventManager !== 'undefined' && typeof EventManager.emit === 'function' && typeof AppChannel !== 'undefined' && typeof DeviceChannel !== 'undefined') {
          EventManager.emit(AppChannel.SendToWindow, DeviceChannel.PropertyUpdate_Performance, activeDev.rendererState);
        }
      } catch (_) {}
    } else {
      if (buttonId === 6) {
        triggerDpiCycle('down', null, devName);
      } else {
        triggerDpiCycle('up', null, devName);
      }
    }
  };

  // Register global DPI telemetry event listener
  global._bgcOnDpiUpdate = function (data) {
    if (data && typeof data.stageIndex === 'number') {
      currentDpiStage = data.stageIndex;
    }
    if (data && typeof data.dpi === 'number') {
      lastKnownDpi = data.dpi;
    }
    showDpiOsd(data);
  };

  // Intercept EventManager.emit from Glorious Core for battery and DPI updates
  global._bgcOnEventManagerEmit = function (eventName, ...args) {
    try {
      // Find payload object flexibly
      let payload = null;
      for (const arg of [eventName, ...args]) {
        if (arg && typeof arg === 'object') {
          if (arg.hardwareStatus || arg.currentProfileData || arg.mousePerformanceState || typeof arg.batteryLevel === 'number') {
            payload = arg;
            break;
          }
        }
      }
      if (!payload) {
        payload = args[1] || args[0] || eventName;
      }

      // 1. Hardware Status (Battery Level & Charging State)
      const hw = (payload && payload.hardwareStatus) ? payload.hardwareStatus : (payload && typeof payload.batteryLevel === 'number' ? payload : null);
      if (hw && typeof hw.batteryLevel === 'number') {
        const name = payload.deviceName || payload.productName || payload.name || payload.productId || 'Wireless Mouse';
        const isCharging = Boolean(hw.isCharging);
        updateTrayBattery(name, hw.batteryLevel, isCharging);
        checkLowBatteryNotification(name, hw.batteryLevel, isCharging);
      }

      // 2. Mouse Performance & DPI Changes
      const perf = payload?.currentProfileData?.mousePerformanceState || payload?.mousePerformanceState || (Array.isArray(payload?.DpiStage) ? payload : null);
      if (perf && Array.isArray(perf.DpiStage) && perf.DpiStage.length > 0) {
        cachedDpiStages = perf.DpiStage;
        totalDpiStages = perf.DpiStage.length;
        const stageIdx = typeof perf.dpiSelectIndex === 'number' ? perf.dpiSelectIndex : 0;
        const stageObj = perf.DpiStage[stageIdx] || perf.DpiStage[0];

        if (stageObj) {
          const newStage = stageIdx + 1;
          const newDpi = stageObj.value;
          const hasChanged = (currentDpiStage !== newStage || lastKnownDpi !== newDpi);
          currentDpiStage = newStage;
          lastKnownDpi = newDpi;

          if (hasChanged && isOsdInitialized) {
            showDpiOsd({
              dpi: newDpi,
              stageIndex: newStage,
              totalStages: totalDpiStages,
              color: stageObj.color ? (stageObj.color.startsWith('#') ? stageObj.color : '#' + stageObj.color) : undefined,
              profileName: payload?.currentProfileData?.name || 'Profile',
              deviceName: payload?.productId || payload?.name || 'Wireless Mouse'
            });
          }
          isOsdInitialized = true;
        }
      }
    } catch (err) {
      console.error('[Better Glorious Core] EventManager emit hook error:', err);
    }
  };

  // Intercept raw HID data packets from #deviceDataCallback
  global._bgcOnDeviceData = function (data, deviceInfo) {
    try {
      if (!data || data.length < 2) return;

      const b0 = data[0];
      const b1 = data[1];

      // Battery Packet (e.g. [6, 251, level, isCharging] or stripped [251, level, isCharging])
      if ((b0 === 6 && b1 === 251) || b0 === 251) {
        const offset = b0 === 6 ? 2 : 1;
        const level = data[offset];
        if (typeof level === 'number' && level >= 0 && level <= 100) {
          const isCharging = Boolean(data[offset + 1]);
          const devName = deviceInfo?.name || deviceInfo?.productId || 'Wireless Mouse';
          updateTrayBattery(devName, level, isCharging);
        }
        return;
      }

      // Explicit DPI Stage Packet (e.g. [3, 2, stageIndex] or stripped [2, stageIndex])
      if ((b0 === 3 && b1 === 2 && typeof data[2] === 'number') || (b0 === 2 && typeof b1 === 'number' && b1 >= 0 && b1 <= 10)) {
        const stageIdx = (b0 === 3 ? data[2] : b1);
        const stage = stageIdx + 1;
        triggerDpiCycle('set', stage, deviceInfo?.name || defaultDeviceName);
        return;
      }

      // Physical Mouse Button Click Packet (Report 6, Command 249/247/248 or Report 4/7 or stripped)
      const isButtonReport = (
        (b0 === 6 && (b1 === 249 || b1 === 247 || b1 === 248)) ||
        (b0 === 4 && (b1 === 249 || b1 === 247 || b1 === 248)) ||
        (b0 === 7 && b1 === 83) ||
        (b0 === 249 || b0 === 247 || b0 === 248)
      );

      if (isButtonReport) {
        const b2 = data[2];
        const b3 = data[3];
        // Button IDs from Glorious DeviceButtonMapping: 5 = DPICycleUp, 6 = DPICycleDown, 8 = DPIShift
        const isDpiUp = (b3 === 5 || b2 === 5 || (b0 === 249 && (b1 === 5 || b2 === 5)));
        const isDpiDown = (b3 === 6 || b2 === 6 || (b0 === 249 && (b1 === 6 || b2 === 6)));
        const isDpiShift = (b3 === 8 || b2 === 8 || b3 === 20 || b2 === 20);

        if (isDpiUp || isDpiDown || isDpiShift) {
          if (typeof global._bgcOnDpiButtonPress === 'function') {
            global._bgcOnDpiButtonPress(isDpiDown ? 6 : 5);
          } else {
            const devName = deviceInfo?.name || defaultDeviceName || 'Model D 2 Wireless';
            if (isDpiDown) {
              triggerDpiCycle('down', null, devName);
            } else {
              triggerDpiCycle('up', null, devName);
            }
          }
        }
      }
    } catch (_) {}
  };

  // -------------------------------------------------------------
  // IPC Handlers for Power Management Settings & Stats
  // -------------------------------------------------------------
  if (ipcMain && ipcMain.handle) {
    const originalHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = function (channel, handler) {
      const chUpper = typeof channel === 'string' ? channel.toUpperCase() : '';
      if (chUpper.includes('MOUSEPERFORMANCE') || chUpper.includes('PROPERTYUPDATE')) {
        const wrappedHandler = async function (event, ...args) {
          try {
            const data = args[0];
            const perf = data?.mousePerformanceState || data?.currentProfileData?.mousePerformanceState;
            if (perf && typeof perf.dpiSelectIndex === 'number') {
              const newStage = perf.dpiSelectIndex + 1;
              if (Array.isArray(perf.DpiStage)) {
                cachedDpiStages = perf.DpiStage;
                totalDpiStages = perf.DpiStage.length;
              }
              const stageObj = cachedDpiStages[newStage - 1];
              if (stageObj) {
                currentDpiStage = newStage;
                lastKnownDpi = stageObj.value;
                logDebug(`IPC DPI change: stage=${newStage}, dpi=${stageObj.value}`);
                showDpiOsd({
                  dpi: stageObj.value,
                  stageIndex: newStage,
                  totalStages: totalDpiStages,
                  color: stageObj.color ? (stageObj.color.startsWith('#') ? stageObj.color : '#' + stageObj.color) : undefined,
                  deviceName: defaultDeviceName || 'Model D 2 Wireless'
                });
              }
            }
          } catch (_) {}
          return handler(event, ...args);
        };
        return originalHandle(channel, wrappedHandler);
      }
      return originalHandle(channel, handler);
    };

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
    ipcMain.handle('bgc:get-osd-state', () => ({
      enabled: Boolean(powerConfig.osdEnabled),
      position: powerConfig.osdPosition,
      durationMs: powerConfig.osdDurationMs
    }));
  }

  if (ipcMain && ipcMain.on) {
    ipcMain.on('bgc:trigger-dpi-osd', (event, data) => {
      showDpiOsd(data);
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
  calculateBatteryEstimate: typeof calculateBatteryEstimate !== 'undefined' ? calculateBatteryEstimate : null,
  calculateOsdPosition: typeof calculateOsdPosition !== 'undefined' ? calculateOsdPosition : null,
  showDpiOsd: typeof showDpiOsd !== 'undefined' ? showDpiOsd : null,
  formatTrayTooltip: typeof formatTrayTooltip !== 'undefined' ? formatTrayTooltip : null,
  normalizeDeviceId: typeof normalizeDeviceId !== 'undefined' ? normalizeDeviceId : null
};


