/**
 * Better Glorious Core - Renderer Process Hook
 * Automatically injected into Glorious Core renderer window.
 */
(function () {
  if (typeof window !== 'undefined' && window.__BETTER_GLORIOUS_CORE_LOADED__) return;
  if (typeof window !== 'undefined') {
    window.__BETTER_GLORIOUS_CORE_LOADED__ = true;
    console.log(
      '%c Better Glorious Core %c v1.0.0 Active 🚀 ',
      'background: #ffb800; color: #111; font-weight: bold; border-radius: 4px 0 0 4px; padding: 2px 6px;',
      'background: #1e222d; color: #fff; border-radius: 0 4px 4px 0; padding: 2px 6px;'
    );
  }

  let _ecoModeActive = false;
  let _lastBatteryLevel = null;
  let _latestBatteryHistory = [];

  let initialFallbackLevel = 80;
  try {
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem('bgc_bat_current') || localStorage.getItem('bgc_bat_Model D 2 Wireless') || localStorage.getItem('bgc_bat_mouse');
      if (cached && !isNaN(Number(cached))) initialFallbackLevel = Number(cached);
    }
  } catch (_) {}

  let _latestBatteryState = {
    level: initialFallbackLevel,
    isCharging: false,
    estimate: null,
    deviceId: 'Model D 2 Wireless'
  };

  // Resolve ipcRenderer if exposed
  let ipcRenderer = null;
  try {
    if (typeof window !== 'undefined' && window.require) {
      const electron = window.require('electron');
      ipcRenderer = electron.ipcRenderer;
    }
  } catch (_) {}

  // Expose modding & power API to window
  if (typeof window !== 'undefined') {
    window.BetterGloriousCore = {
      version: '1.0.0',
      installed: true,
      theme: {
        injectCSS: function (cssString) {
          const style = document.createElement('style');
          style.textContent = cssString;
          document.head.appendChild(style);
          return style;
        }
      },
    power: {
      isEcoModeActive: function () {
        return _ecoModeActive;
      },
      getConfig: async function () {
        if (ipcRenderer && ipcRenderer.invoke) {
          return await ipcRenderer.invoke('bgc:get-power-config');
        }
        return null;
      },
      setConfig: async function (config) {
        if (ipcRenderer && ipcRenderer.invoke) {
          return await ipcRenderer.invoke('bgc:set-power-config', config);
        }
        return null;
      },
      getBatteryStats: async function () {
        if (ipcRenderer && ipcRenderer.invoke) {
          return await ipcRenderer.invoke('bgc:get-battery-stats');
        }
        return null;
      }
    },
    battery: {
      openGraph: function () {},
      closeGraph: function () {},
      getHistory: async function () {
        return [];
      },
      getState: function () {
        return _latestBatteryState;
      }
    },
    osd: {
      trigger: function (dpiData) {
        if (ipcRenderer && ipcRenderer.send) {
          ipcRenderer.send('bgc:trigger-dpi-osd', dpiData);
          return true;
        }
        return false;
      },
      getState: async function () {
        if (ipcRenderer && ipcRenderer.invoke) {
          return await ipcRenderer.invoke('bgc:get-osd-state');
        }
        return null;
      }
    },
    polling: {
      getConfig: async function () {
        if (ipcRenderer && ipcRenderer.invoke) {
          return await ipcRenderer.invoke('bgc:get-polling-config');
        }
        return null;
      },
      setConfig: async function (config) {
        if (ipcRenderer && ipcRenderer.invoke) {
          return await ipcRenderer.invoke('bgc:set-polling-config', config);
        }
        return null;
      },
      trigger: function (pollingData) {
        if (ipcRenderer && ipcRenderer.send) {
          ipcRenderer.send('bgc:trigger-polling-osd', pollingData);
          return true;
        }
        return false;
      }
    }
  };
}

  async function fetchHistory(deviceId) {
    if (ipcRenderer && ipcRenderer.invoke) {
      try {
        const hist = await ipcRenderer.invoke('bgc:get-battery-history', deviceId);
        if (Array.isArray(hist) && hist.length > 0) {
          _latestBatteryHistory = hist;
        } else if (hist && typeof hist === 'object' && !Array.isArray(hist)) {
          const devKey = deviceId || _latestBatteryState.deviceId || Object.keys(hist)[0];
          if (devKey && Array.isArray(hist[devKey]) && hist[devKey].length > 0) {
            _latestBatteryHistory = hist[devKey];
          } else {
            const firstList = Object.values(hist).find(Array.isArray);
            if (firstList && firstList.length > 0) {
              _latestBatteryHistory = firstList;
            }
          }
        }
      } catch (_) {}
    }
    // Fallback to localStorage if history is still empty
    if ((!_latestBatteryHistory || _latestBatteryHistory.length === 0) && typeof localStorage !== 'undefined') {
      try {
        const localHist = localStorage.getItem('bgc_battery_history');
        if (localHist) {
          const parsed = JSON.parse(localHist);
          if (Array.isArray(parsed) && parsed.length > 0) {
            _latestBatteryHistory = parsed;
          }
        }
      } catch (_) {}
    }
    return _latestBatteryHistory;
  }

  // Mount or update UI status badge
  function updateBadge() {
    let badge = document.getElementById('bgc-status-badge');
    if (!_ecoModeActive) {
      if (badge) badge.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'bgc-status-badge';
      document.body.appendChild(badge);
    }

    const levelText = typeof _lastBatteryLevel === 'number' ? ` (${_lastBatteryLevel}%)` : '';
    badge.innerHTML = `<span class="bgc-eco-badge">🔋 Eco Mode${levelText}</span>`;
    badge.classList.add('bgc-eco-active');
  }

  // Hook IPC messages from main process
  if (ipcRenderer && ipcRenderer.on) {
    ipcRenderer.on('bgc:power-mode', (event, data) => {
      if (data && typeof data.ecoMode === 'boolean') {
        _ecoModeActive = data.ecoMode;
        if (typeof data.level === 'number') {
          _lastBatteryLevel = data.level;
          _latestBatteryState.level = data.level;
        }
        updateBadge();
      }
    });

    ipcRenderer.on('bgc:battery-update', (event, data) => {
      if (data) {
        if (typeof data.level === 'number') {
          _lastBatteryLevel = data.level;
          _latestBatteryState.level = data.level;
        }
        if (typeof data.isCharging === 'boolean') {
          _latestBatteryState.isCharging = data.isCharging;
        }
        if (data.deviceId) {
          _latestBatteryState.deviceId = data.deviceId;
        }
        if (data.estimate) {
          _latestBatteryState.estimate = data.estimate;
        }
        if (Array.isArray(data.history)) {
          _latestBatteryHistory = data.history;
        }
        enhanceBatteryPillsInDOM();
        updateBadge();
      }
    });

    ipcRenderer.on('bgc:system-sleep', (event, data) => {
      if (data && data.active) {
        document.body.classList.add('bgc-system-dimmed');
      } else {
        document.body.classList.remove('bgc-system-dimmed');
      }
    });
  }

  // Battery value formatter (e.g. 99% (~62h) next to battery icon)
  let _lastReportedTime = 0;
  let _lastReportedLevel = null;
  let _lastReportedCharging = null;
  let _selectedTimeRange = '24h';
  let _cachedAllDeviceStats = {};

  if (typeof window !== 'undefined') {
    window._bgcFormatBattery = function (val, isChg) {
      if (val == null || isNaN(val)) return void 0;
      const n = Math.max(0, Math.min(100, Math.round(Number(val))));
      _latestBatteryState.level = n;
      _latestBatteryState.isCharging = Boolean(isChg);
      _lastBatteryLevel = n;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('bgc_bat_current', String(n));
          localStorage.setItem('bgc_bat_' + (_latestBatteryState.deviceId || 'mouse'), String(n));
        }
      } catch (_) {}

      if (isChg) {
        return n >= 100 ? '100%' : `${n}% (Charging)`;
      }
      return `${n}%`;
    };
  }

  // Backwards-compatible stubs (battery chart removed to eliminate battery drain & simplify UI)
  function openBatteryGraphModal() {}

  function closeBatteryGraphModal() {
    const overlay = document.getElementById('bgc-battery-graph-modal');
    if (overlay) overlay.remove();
  }

  function generateBatterySvg() {
    return '';
  }

  function calculateVelocity() {
    return 0;
  }

  function formatTimeAgo() {
    return '';
  }

  function formatClockTime() {
    return '';
  }

  // Enhance existing or dynamically rendered battery pills in the DOM
  function enhanceBatteryPillsInDOM() {
    try {
      // 1. Clean up any lingering graph buttons
      const allBtns = document.querySelectorAll('.bgc-graph-pill-btn');
      allBtns.forEach((btn) => btn.remove());

      // 2. Clean up any lingering graph modal
      const modal = document.getElementById('bgc-battery-graph-modal');
      if (modal) modal.remove();

      let pills = document.querySelectorAll(
        '[class*="battery-pill"], [class*="_battery-pill_"], [class*="BatteryPill"], [class*="battery_pill"]'
      );
      if (pills.length === 0) {
        pills = document.querySelectorAll('[class*="battery" i], [class*="Battery"]');
      }

      pills.forEach((pill) => {
        // Find value element or text node containing percentage
        let valElem = pill.querySelector('[class*="value"], [class*="_value_"], [class*="percent" i]');
        if (!valElem && pill.textContent && /\d{1,3}%/.test(pill.textContent)) {
          valElem = pill;
        }
        if (!valElem) return;

        if (valElem.textContent) {
          const txt = valElem.textContent.trim();
          const match = txt.match(/^(\d{1,3})%/);
          if (match) {
            const num = parseInt(match[1], 10);
            const isCharging = pill.className.includes('charging') || (txt.toLowerCase().includes('charging'));
            const formatted = window._bgcFormatBattery ? window._bgcFormatBattery(num, isCharging) : `${num}%`;
            if (formatted && formatted !== txt) {
              valElem.textContent = formatted;
            }
          }
        }
      });
    } catch (_) {}
  }

  async function loadInitialBatteryData() {
    // 1. Restore cached telemetry history from localStorage
    try {
      if (typeof localStorage !== 'undefined') {
        const localHist = localStorage.getItem('bgc_battery_history');
        if (localHist) {
          const parsed = JSON.parse(localHist);
          if (Array.isArray(parsed) && parsed.length > 0) {
            _latestBatteryHistory = parsed;
          }
        }
      }
    } catch (_) {}

    // 2. Fetch live stats from main process
    if (ipcRenderer && ipcRenderer.invoke) {
      try {
        const stats = await ipcRenderer.invoke('bgc:get-battery-stats');
        if (stats && typeof stats === 'object') {
          _cachedAllDeviceStats = stats;
          const firstKey = Object.keys(stats)[0];
          if (firstKey && stats[firstKey]) {
            const dev = stats[firstKey];
            _latestBatteryState.deviceId = firstKey;
            if (typeof dev.level === 'number') {
              _latestBatteryState.level = dev.level;
              _lastBatteryLevel = dev.level;
            }
            if (typeof dev.isCharging === 'boolean') _latestBatteryState.isCharging = dev.isCharging;
            if (dev.estimate) _latestBatteryState.estimate = dev.estimate;
            if (Array.isArray(dev.history) && dev.history.length > 0) {
              _latestBatteryHistory = dev.history;
            }
          }
        }
      } catch (_) {}
    }
  }

  function initRendererHooks() {
    loadInitialBatteryData().then(() => {
      updateBadge();
      enhanceBatteryPillsInDOM();
    }).catch(() => {});

    try {
      const observer = new MutationObserver(() => {
        enhanceBatteryPillsInDOM();
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    } catch (_) {}

    setInterval(enhanceBatteryPillsInDOM, 2500);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initRendererHooks);
    } else {
      initRendererHooks();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      generateBatterySvg,
      calculateVelocity,
      formatTimeAgo,
      formatClockTime
    };
  }
})();
