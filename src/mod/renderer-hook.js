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
  let _latestBatteryHistory = [];

  let initialFallbackLevel = 80;
  try {
    const cached = localStorage.getItem('bgc_bat_current') || localStorage.getItem('bgc_bat_Model D 2 Wireless') || localStorage.getItem('bgc_bat_mouse');
    if (cached && !isNaN(Number(cached))) initialFallbackLevel = Number(cached);
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
    battery: {
      openGraph: function (deviceId) {
        openBatteryGraphModal(deviceId);
      },
      closeGraph: function () {
        closeBatteryGraphModal();
      },
      getHistory: async function (deviceId) {
        return await fetchHistory(deviceId);
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

  async function fetchHistory(deviceId) {
    if (ipcRenderer && ipcRenderer.invoke) {
      try {
        const hist = await ipcRenderer.invoke('bgc:get-battery-history', deviceId);
        if (Array.isArray(hist) && hist.length > 0) {
          _latestBatteryHistory = hist;
        }
      } catch (_) {}
    }
    return _latestBatteryHistory;
  }

  // Mount or update UI status badge (clickable to open graph)
  function updateBadge() {
    let badge = document.getElementById('bgc-status-badge');
    if (!_ecoModeActive) {
      if (badge) badge.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'bgc-status-badge';
      badge.style.cursor = 'pointer';
      badge.title = 'Click to view battery history graph 📈';
      badge.addEventListener('click', () => openBatteryGraphModal());
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

        // If graph modal is currently open, refresh its content live
        const modal = document.getElementById('bgc-battery-graph-modal');
        if (modal && modal.style.display !== 'none') {
          updateGraphModalContent(modal, data.deviceId);
        }
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
    _latestBatteryState.level = n;
    _latestBatteryState.isCharging = Boolean(isChg);
    _lastBatteryLevel = n;
    try {
      localStorage.setItem('bgc_bat_current', String(n));
      localStorage.setItem('bgc_bat_Model D 2 Wireless', String(n));
    } catch (_) {}

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

  // -------------------------------------------------------------
  // Battery Telemetry History Graph Modal & SVG Generator
  // -------------------------------------------------------------

  function formatTimeAgo(ms) {
    const secs = Math.max(0, Math.floor(ms / 1000));
    if (secs < 60) return 'Just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function calculateVelocity(history) {
    if (!Array.isArray(history) || history.length < 2) return null;
    const isChg = Boolean(history[history.length - 1].isCharging);
    const pts = [];
    for (let i = history.length - 1; i >= 0; i--) {
      if (Boolean(history[i].isCharging) !== isChg) break;
      pts.unshift(history[i]);
    }
    if (pts.length < 2) return null;
    const oldest = pts[0];
    const newest = pts[pts.length - 1];
    const hrs = (newest.time - oldest.time) / 3600000;
    if (hrs <= 0.01) return null;
    const diff = newest.level - oldest.level;
    const rate = Math.abs(diff / hrs).toFixed(1);
    return isChg ? `+${rate}% / hr` : `-${rate}% / hr`;
  }

  function generateBatterySvg(history, currentLevel, isCharging) {
    const W = 570;
    const H = 210;
    const padL = 44;
    const padR = 24;
    const padT = 16;
    const padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const getY = (lvl) => padT + plotH - (Math.max(0, Math.min(100, lvl)) / 100) * plotH;

    // Y Gridlines (100, 75, 50, 25, 0)
    let gridLinesSvg = '';
    [100, 75, 50, 25, 0].forEach((pct) => {
      const y = getY(pct);
      gridLinesSvg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-dasharray="4 4" stroke-width="1" />`;
      gridLinesSvg += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="10" font-family="sans-serif">${pct}%</text>`;
    });

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const tMin = now - ONE_DAY_MS;
    const tMax = now;
    const timeSpan = ONE_DAY_MS;

    // Filter data to past 24 hours
    let data = (Array.isArray(history) && history.length > 0)
      ? history.filter((p) => (now - p.time) <= ONE_DAY_MS)
      : [];

    if (data.length === 0) {
      data = [{ time: now, level: currentLevel, isCharging: Boolean(isCharging) }];
    }

    // Anchor baseline back to 24 hours ago with oldest known reading
    if (data[0].time > tMin + 60000) {
      data.unshift({
        time: tMin,
        level: data[0].level,
        isCharging: data[0].isCharging,
        isAnchor: true
      });
    }

    // Anchor up to Now
    if (now - data[data.length - 1].time > 60000) {
      data.push({
        time: now,
        level: currentLevel,
        isCharging: Boolean(isCharging),
        isAnchor: true
      });
    }

    const getX = (t) => padL + Math.max(0, Math.min(1, (t - tMin) / timeSpan)) * plotW;

    const points = data.map((p) => ({
      x: getX(p.time),
      y: getY(p.level),
      level: p.level,
      isCharging: Boolean(p.isCharging),
      time: p.time,
      isAnchor: Boolean(p.isAnchor)
    }));

    // Generate area polygon path
    let areaPathD = `M ${points[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)}`;
    areaPathD += ` L ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      areaPathD += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
    }
    areaPathD += ` L ${points[points.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

    // Generate colored trajectory line segments
    // Green (charging / going up), Amber (discharging / going down)
    let segmentsSvg = '';
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const isUpward = p2.isCharging || (p2.level > p1.level);
      const strokeColor = isUpward ? '#10b981' : '#f59e0b';
      const glowStyle = isUpward
        ? 'filter: drop-shadow(0 0 3px rgba(16, 185, 129, 0.6));'
        : 'filter: drop-shadow(0 0 3px rgba(245, 158, 11, 0.6));';

      segmentsSvg += `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" style="${glowStyle}" />`;
    }

    // Data dots
    let dotsSvg = '';
    points.forEach((pt) => {
      if (pt.isAnchor && points.length > 2) return; // Skip synthetic anchor from dot rendering
      const dotColor = pt.isCharging ? '#10b981' : '#f59e0b';
      const timeStr = new Date(pt.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const statusStr = pt.isCharging ? '⚡ Charging' : '🔋 Discharging';
      const tipData = `${pt.level}% (${statusStr}) • ${timeStr}`;

      dotsSvg += `<circle class="bgc-chart-dot" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4" fill="${dotColor}" stroke="#151821" stroke-width="1.5" data-tip="${tipData}" />`;
    });

    // 24-hour timeline labels (24h ago, 18h ago, 12h ago, 6h ago, Now)
    const timeLabels = [
      { offset: ONE_DAY_MS, label: '24h ago' },
      { offset: ONE_DAY_MS * 0.75, label: '18h ago' },
      { offset: ONE_DAY_MS * 0.5, label: '12h ago' },
      { offset: ONE_DAY_MS * 0.25, label: '6h ago' },
      { offset: 0, label: 'Now' }
    ];
    let timeLabelsSvg = '';
    timeLabels.forEach((item, i) => {
      const fraction = 1 - (item.offset / ONE_DAY_MS);
      const x = padL + fraction * plotW;
      const anchor = i === 0 ? 'start' : (i === timeLabels.length - 1 ? 'end' : 'middle');
      timeLabelsSvg += `<text x="${x.toFixed(1)}" y="${(padT + plotH + 18).toFixed(1)}" text-anchor="${anchor}" fill="rgba(255,255,255,0.45)" font-size="10" font-family="sans-serif">${item.label}</text>`;
    });

    const currentModeColor = isCharging ? '#10b981' : '#f59e0b';

    return `
      <svg class="bgc-svg-chart" viewBox="0 0 ${W} ${H}">
        <defs>
          <linearGradient id="bgcAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="${currentModeColor}" stop-opacity="0.25" />
            <stop offset="100%" stop-color="${currentModeColor}" stop-opacity="0.01" />
          </linearGradient>
        </defs>
        ${gridLinesSvg}
        <path d="${areaPathD}" fill="url(#bgcAreaGrad)" />
        ${segmentsSvg}
        ${dotsSvg}
        ${timeLabelsSvg}
      </svg>
    `;
  }

  function updateGraphModalContent(overlay, targetDeviceId) {
    const devName = targetDeviceId || _latestBatteryState.deviceId || 'Wireless Mouse';

    // Pick the most accurate level available (from history, DOM, or state)
    let lvl = typeof _latestBatteryState.level === 'number' ? _latestBatteryState.level : 80;
    if (Array.isArray(_latestBatteryHistory) && _latestBatteryHistory.length > 0) {
      const lastPt = _latestBatteryHistory[_latestBatteryHistory.length - 1];
      if (typeof lastPt.level === 'number') {
        lvl = lastPt.level;
        _latestBatteryState.level = lvl;
      }
    }
    const domVal = document.querySelector('[class*="battery-pill"] [class*="value"], [class*="_battery-pill_"] [class*="_value_"]');
    if (domVal && domVal.textContent) {
      const m = domVal.textContent.match(/(\d{1,3})%/);
      if (m) {
        lvl = parseInt(m[1], 10);
        _latestBatteryState.level = lvl;
      }
    }

    const isChg = Boolean(_latestBatteryState.isCharging);
    const est = _latestBatteryState.estimate || (isChg ? 'Charging' : 'Normal');
    const velocity = calculateVelocity(_latestBatteryHistory) || (isChg ? 'Charging (USB)' : 'Normal Drain');

    const statePillClass = isChg ? 'charging' : 'discharging';
    const stateIcon = isChg ? '⚡' : '🔋';
    const stateText = isChg ? 'Charging' : 'Discharging';

    const svgHtml = generateBatterySvg(_latestBatteryHistory, lvl, isChg);

    overlay.innerHTML = `
      <div class="bgc-battery-graph-card" id="bgc-graph-card">
        <div class="bgc-graph-header">
          <div>
            <div class="bgc-graph-title">
              <span>📈</span>
              <span>${devName} — Past 24 Hours</span>
            </div>
            <div class="bgc-graph-subtitle">Battery Discharge & Charge Timeline (24-Hour Window)</div>
          </div>
          <button class="bgc-graph-close" id="bgc-close-btn" title="Close">✕</button>
        </div>

        <div class="bgc-graph-metrics">
          <div class="bgc-metric-chip">
            <div class="bgc-metric-label">Current Battery</div>
            <div class="bgc-metric-val ${statePillClass}">${stateIcon} ${lvl}% ${stateText}</div>
          </div>
          <div class="bgc-metric-chip">
            <div class="bgc-metric-label">Velocity / Rate</div>
            <div class="bgc-metric-val ${statePillClass}">${velocity}</div>
          </div>
          <div class="bgc-metric-chip">
            <div class="bgc-metric-label">${isChg ? 'Time to Full' : 'Estimated Runtime'}</div>
            <div class="bgc-metric-val ${statePillClass}">${est}</div>
          </div>
        </div>

        <div class="bgc-svg-container" id="bgc-svg-box">
          ${svgHtml}
          <div class="bgc-graph-tooltip" id="bgc-dot-tooltip" style="display: none; opacity: 0;"></div>
        </div>

        <div class="bgc-graph-footer">
          <div class="bgc-graph-legend">
            <div class="bgc-legend-item">
              <div class="bgc-legend-dot charging"></div>
              <span>Charging (Upward Trend)</span>
            </div>
            <div class="bgc-legend-item">
              <div class="bgc-legend-dot discharging"></div>
              <span>Discharging (Downward Trend)</span>
            </div>
          </div>
          <div>Past 24 hours of telemetry recorded continuously</div>
        </div>
      </div>
    `;

    // Close button handler
    const closeBtn = overlay.querySelector('#bgc-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeBatteryGraphModal);
    }

    // Interactive tooltip handling on SVG dots
    const tooltip = overlay.querySelector('#bgc-dot-tooltip');
    const svgBox = overlay.querySelector('#bgc-svg-box');
    const dots = overlay.querySelectorAll('.bgc-chart-dot');

    if (tooltip && svgBox) {
      dots.forEach((dot) => {
        dot.addEventListener('mouseenter', (e) => {
          const tipText = dot.getAttribute('data-tip');
          if (tipText) {
            tooltip.textContent = tipText;
            tooltip.style.display = 'block';
            tooltip.style.opacity = '1';
            const cx = parseFloat(dot.getAttribute('cx')) || 0;
            const cy = parseFloat(dot.getAttribute('cy')) || 0;
            tooltip.style.left = `${cx}px`;
            tooltip.style.top = `${cy - 10}px`;
          }
        });
        dot.addEventListener('mouseleave', () => {
          tooltip.style.opacity = '0';
          tooltip.style.display = 'none';
        });
      });
    }
  }

  async function openBatteryGraphModal(targetDeviceId) {
    let overlay = document.getElementById('bgc-battery-graph-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'bgc-battery-graph-modal';
      overlay.className = 'bgc-battery-graph-overlay';
      document.body.appendChild(overlay);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeBatteryGraphModal();
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeBatteryGraphModal();
      });
    }

    // 1. Check DOM for current percentage as instant ground truth
    const domVal = document.querySelector('[class*="battery-pill"] [class*="value"], [class*="_battery-pill_"] [class*="_value_"]');
    if (domVal && domVal.textContent) {
      const m = domVal.textContent.match(/(\d{1,3})%/);
      if (m) {
        _latestBatteryState.level = parseInt(m[1], 10);
      }
    }

    // 2. Fetch full stats from main process
    if (ipcRenderer && ipcRenderer.invoke) {
      try {
        const stats = await ipcRenderer.invoke('bgc:get-battery-stats');
        if (stats && typeof stats === 'object') {
          const key = targetDeviceId || Object.keys(stats)[0];
          if (key && stats[key]) {
            const dev = stats[key];
            _latestBatteryState.deviceId = key;
            if (typeof dev.level === 'number') _latestBatteryState.level = dev.level;
            if (typeof dev.isCharging === 'boolean') _latestBatteryState.isCharging = dev.isCharging;
            if (dev.estimate) _latestBatteryState.estimate = dev.estimate;
            if (Array.isArray(dev.history) && dev.history.length > 0) {
              _latestBatteryHistory = dev.history;
            }
          }
        }
      } catch (_) {}
    }

    await fetchHistory(targetDeviceId);

    // 3. Reconcile with latest point from history
    if (Array.isArray(_latestBatteryHistory) && _latestBatteryHistory.length > 0) {
      const lastHist = _latestBatteryHistory[_latestBatteryHistory.length - 1];
      if (typeof lastHist.level === 'number') {
        _latestBatteryState.level = lastHist.level;
        _latestBatteryState.isCharging = Boolean(lastHist.isCharging);
      }
    }

    updateGraphModalContent(overlay, targetDeviceId);
    overlay.style.display = 'flex';
  }

  function closeBatteryGraphModal() {
    const overlay = document.getElementById('bgc-battery-graph-modal');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Enhance existing or dynamically rendered battery pills in the DOM
  function enhanceBatteryPillsInDOM() {
    try {
      // 1. Clean up duplicate graph buttons across the entire document
      const allBtns = document.querySelectorAll('.bgc-graph-pill-btn');
      if (allBtns.length > 1) {
        for (let i = 1; i < allBtns.length; i++) {
          allBtns[i].remove();
        }
      }

      const pills = document.querySelectorAll('[class*="battery-pill"], [class*="_battery-pill_"]');
      pills.forEach((pill) => {
        // Only target the specific leaf element that directly houses the value element
        const valElem = pill.querySelector('[class*="value"], [class*="_value_"]');
        if (!valElem) return; // Skip outer wrappers that don't directly host the value

        // Make pill clickable to open graph
        if (!pill.dataset.bgcGraphHooked) {
          pill.dataset.bgcGraphHooked = 'true';
          pill.title = 'Click to view 24h battery history graph 📈';
          pill.addEventListener('click', (e) => {
            e.stopPropagation();
            openBatteryGraphModal();
          });
        }

        // Inject strictly ONE sleek 📈 icon if none exists in this pill or document
        const hasBtn = pill.querySelector('.bgc-graph-pill-btn') || document.querySelector('.bgc-graph-pill-btn');
        if (!hasBtn) {
          const btn = document.createElement('span');
          btn.className = 'bgc-graph-pill-btn';
          btn.innerHTML = '📈';
          btn.title = 'View 24h Battery History Graph';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openBatteryGraphModal();
          });
          if (valElem.parentNode) {
            valElem.parentNode.insertBefore(btn, valElem.nextSibling);
          } else {
            pill.appendChild(btn);
          }
        }

        if (valElem.textContent) {
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

  async function loadInitialBatteryData() {
    if (ipcRenderer && ipcRenderer.invoke) {
      try {
        const stats = await ipcRenderer.invoke('bgc:get-battery-stats');
        if (stats && typeof stats === 'object') {
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
            if (Array.isArray(dev.history)) _latestBatteryHistory = dev.history;
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRendererHooks);
  } else {
    initRendererHooks();
  }
})();
