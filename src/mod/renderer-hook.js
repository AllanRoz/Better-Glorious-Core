/**
 * Better Glorious Core - Renderer Process Hook
 * Automatically injected into Glorious Core renderer window.
 */
(function () {
  if (window.__BETTER_GLORIOUS_CORE_LOADED__) return;
  window.__BETTER_GLORIOUS_CORE_LOADED__ = true;

  console.log(
    '%c Better Glorious Core %c v1.0.0 Active 🚀 ',
    'background: #ffb800; color: #111; font-weight: bold; border-radius: 4px 0 0 4px; padding: 2px 6px;',
    'background: #1e222d; color: #fff; border-radius: 0 4px 4px 0; padding: 2px 6px;'
  );

  let _ecoModeActive = false;
  let _lastBatteryLevel = null;

  // Resolve ipcRenderer if exposed
  let ipcRenderer = null;
  try {
    if (window.require) {
      const electron = window.require('electron');
      ipcRenderer = electron.ipcRenderer;
    }
  } catch (_) {}

  // Expose modding & power API to window
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
    }
  };

  // Mount or update UI status badge
  function updateBadge() {
    let badge = document.getElementById('bgc-status-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'bgc-status-badge';
      document.body.appendChild(badge);
    }

    if (_ecoModeActive) {
      const levelText = typeof _lastBatteryLevel === 'number' ? ` (${_lastBatteryLevel}%)` : '';
      badge.innerHTML = `<span class="bgc-accent">⚡</span>Better Glorious Core<span class="bgc-eco-badge">🔋 Eco Mode${levelText}</span>`;
      badge.classList.add('bgc-eco-active');
    } else {
      badge.innerHTML = '<span class="bgc-accent">⚡</span>Better Glorious Core';
      badge.classList.remove('bgc-eco-active');
    }
  }

  // Hook IPC messages from main process
  if (ipcRenderer && ipcRenderer.on) {
    ipcRenderer.on('bgc:power-mode', (event, data) => {
      if (data && typeof data.ecoMode === 'boolean') {
        _ecoModeActive = data.ecoMode;
        if (typeof data.level === 'number') {
          _lastBatteryLevel = data.level;
        }
        updateBadge();
      }
    });

    ipcRenderer.on('bgc:battery-update', (event, data) => {
      if (data) {
        if (typeof data.level === 'number') {
          _lastBatteryLevel = data.level;
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
  window._bgcFormatBattery = function (val, isChg) {
    if (val == null || isNaN(val)) return void 0;
    const n = Number(val);
    if (isChg) {
      if (n >= 100) return '100%';
      const mins = Math.round(((100 - n) / 50) * 60);
      return mins > 0 && mins < 180 ? `${n}% (~${mins}m)` : `${n}% (Charging)`;
    }
    let rate = 1.6;
    if (typeof window._bgcDischargeRate === 'number' && window._bgcDischargeRate >= 0.5 && window._bgcDischargeRate <= 20) {
      rate = window._bgcDischargeRate;
    }
    const hrs = Math.max(1, Math.round(n / rate));
    return `${n}% (~${hrs}h)`;
  };

  // Enhance existing or dynamically rendered battery pills in the DOM
  function enhanceBatteryPillsInDOM() {
    try {
      const pills = document.querySelectorAll('[class*="battery-pill"], [class*="_battery-pill_"]');
      pills.forEach((pill) => {
        const valElem = pill.querySelector('[class*="value"], [class*="_value_"]');
        if (valElem && valElem.textContent) {
          const txt = valElem.textContent.trim();
          const match = txt.match(/^(\d{1,3})%$/);
          if (match) {
            const num = parseInt(match[1], 10);
            const isCharging = pill.className.includes('charging');
            const formatted = window._bgcFormatBattery(num, isCharging);
            if (formatted && formatted !== txt) {
              valElem.textContent = formatted;
            }
          }
        }
      });
    } catch (_) {}
  }

  function initRendererHooks() {
    updateBadge();
    enhanceBatteryPillsInDOM();

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRendererHooks);
  } else {
    initRendererHooks();
  }
})();

