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

      // Automatically capture telemetry point if empty or significant change or 15m passed
      const now = Date.now();
      const shouldRecord = (
        _latestBatteryHistory.length === 0 ||
        _lastReportedLevel !== n ||
        _lastReportedCharging !== Boolean(isChg) ||
        (now - _lastReportedTime >= 15 * 60 * 1000)
      );

      if (shouldRecord) {
        _lastReportedTime = now;
        _lastReportedLevel = n;
        _lastReportedCharging = Boolean(isChg);
        _latestBatteryHistory.push({
          time: now,
          level: n,
          isCharging: Boolean(isChg),
          isHourlyCheck: false
        });
        if (_latestBatteryHistory.length > 500) _latestBatteryHistory.shift();

        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('bgc_battery_history', JSON.stringify(_latestBatteryHistory));
            localStorage.setItem('bgc_battery_history_' + (_latestBatteryState.deviceId || 'mouse'), JSON.stringify(_latestBatteryHistory));
          }
        } catch (_) {}

        if (ipcRenderer && ipcRenderer.send) {
          try {
            ipcRenderer.send('bgc:report-battery', {
              deviceId: _latestBatteryState.deviceId || 'Wireless Mouse',
              level: n,
              isCharging: Boolean(isChg)
            });
          } catch (_) {}
        }

        const modal = document.getElementById('bgc-battery-graph-modal');
        if (modal && modal.style.display !== 'none') {
          updateGraphModalContent(modal, _latestBatteryState.deviceId);
        }
      }

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
  }

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

  function calculateSessionMetrics(history) {
    if (!Array.isArray(history) || history.length === 0) {
      return { min: 80, max: 80, count: 0, delta: 0 };
    }
    let min = 100;
    let max = 0;
    history.forEach((p) => {
      if (typeof p.level === 'number') {
        if (p.level < min) min = p.level;
        if (p.level > max) max = p.level;
      }
    });
    const first = history[0].level;
    const last = history[history.length - 1].level;
    const delta = typeof last === 'number' && typeof first === 'number' ? (last - first) : 0;
    return {
      min: min <= 100 ? min : 0,
      max: max >= 0 ? max : 100,
      count: history.length,
      delta
    };
  }

  function formatClockTime(timestamp) {
    try {
      const d = new Date(timestamp);
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function generateBatterySvg(history, currentLevel, isCharging, options) {
    const W = 570;
    const H = 225;
    const padL = 44;
    const padR = 24;
    const padT = 18;
    const padB = 34;
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

    const now = Date.now();
    const timeRange = (options && options.timeRange) ? options.timeRange : '24h';
    let timeSpan = 24 * 60 * 60 * 1000;
    if (timeRange === '6h') timeSpan = 6 * 60 * 60 * 1000;
    else if (timeRange === '12h') timeSpan = 12 * 60 * 60 * 1000;
    else if (timeRange === 'auto') {
      if (Array.isArray(history) && history.length >= 2) {
        const earliest = history[0].time;
        timeSpan = Math.max(2 * 60 * 60 * 1000, Math.min(24 * 60 * 60 * 1000, (now - earliest) * 1.15));
      }
    }
    const tMin = now - timeSpan;

    // Filter points to selected time window
    const rawData = (Array.isArray(history) && history.length > 0)
      ? history.filter((p) => typeof p.level === 'number' && typeof p.time === 'number' && (now - p.time) <= timeSpan)
      : [];

    rawData.sort((a, b) => a.time - b.time);

    const getX = (t) => padL + Math.max(0, Math.min(1, (t - tMin) / timeSpan)) * plotW;

    const points = rawData.map((p) => ({
      x: getX(p.time),
      y: getY(p.level),
      level: Math.max(0, Math.min(100, p.level)),
      isCharging: Boolean(p.isCharging),
      time: p.time,
      isHourlyCheck: Boolean(p.isHourlyCheck)
    }));

    // Area polygon path
    let areaPathD = '';
    if (points.length >= 2) {
      areaPathD = `M ${points[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)}`;
      areaPathD += ` L ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
      for (let i = 1; i < points.length; i++) {
        areaPathD += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
      }
      areaPathD += ` L ${points[points.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;
    } else if (points.length === 1) {
      const p0 = points[0];
      const endX = padL + plotW;
      areaPathD = `M ${p0.x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} L ${endX.toFixed(1)} ${p0.y.toFixed(1)} L ${endX.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;
    }

    // Trajectory line segments
    let segmentsSvg = '';
    if (points.length >= 2) {
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const isUpward = p2.isCharging || (p2.level > p1.level);
        const strokeColor = isUpward ? '#10b981' : (p2.level <= 20 ? '#ef4444' : '#f59e0b');
        const glowStyle = isUpward
          ? 'filter: drop-shadow(0 0 3px rgba(16, 185, 129, 0.6));'
          : (p2.level <= 20 ? 'filter: drop-shadow(0 0 3px rgba(239, 68, 68, 0.6));' : 'filter: drop-shadow(0 0 3px rgba(245, 158, 11, 0.6));');

        segmentsSvg += `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" style="${glowStyle}" />`;
      }
    } else if (points.length === 1) {
      const p0 = points[0];
      const endX = padL + plotW;
      const strokeColor = p0.isCharging ? '#10b981' : '#f59e0b';
      segmentsSvg += `<line x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${endX.toFixed(1)}" y2="${p0.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="2" stroke-dasharray="4 4" stroke-opacity="0.6" />`;
      segmentsSvg += `<circle cx="${p0.x.toFixed(1)}" cy="${p0.y.toFixed(1)}" r="9" fill="none" stroke="${strokeColor}" stroke-width="1.5" stroke-opacity="0.45" class="bgc-dot-pulse" />`;
    }

    // Data dots
    let dotsSvg = '';
    points.forEach((pt, idx) => {
      const dotColor = pt.isCharging ? '#10b981' : (pt.level <= 20 ? '#ef4444' : '#f59e0b');
      const timeStr = formatClockTime(pt.time);
      const agoStr = formatTimeAgo(now - pt.time);
      const statusStr = pt.isCharging ? '⚡ Charging' : '🔋 Discharging';
      let deltaStr = '';
      if (idx > 0) {
        const prev = points[idx - 1];
        const diff = pt.level - prev.level;
        deltaStr = diff > 0 ? ` (+${diff}%)` : (diff < 0 ? ` (${diff}%)` : ' (0%)');
      }
      const tipData = `${timeStr} (${agoStr}) • ${pt.level}%${deltaStr} [${statusStr}]`;

      dotsSvg += `<circle class="bgc-chart-dot" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.5" fill="${dotColor}" stroke="#151821" stroke-width="1.5" data-tip="${tipData}" />`;
    });

    // Empty state message when no data has been collected yet
    let emptyStateSvg = '';
    if (points.length === 0) {
      emptyStateSvg = `
        <text x="${(padL + plotW / 2).toFixed(1)}" y="${(padT + plotH / 2 - 6).toFixed(1)}" text-anchor="middle" fill="rgba(255,255,255,0.4)" font-size="13" font-family="sans-serif">No battery telemetry collected yet</text>
        <text x="${(padL + plotW / 2).toFixed(1)}" y="${(padT + plotH / 2 + 16).toFixed(1)}" text-anchor="middle" fill="rgba(255,255,255,0.22)" font-size="11" font-family="sans-serif">Checking battery percentage hourly</text>
      `;
    }

    // Timeline labels adapted to range
    let timeLabels = [];
    if (timeRange === '6h') {
      timeLabels = [
        { offset: timeSpan, label: '6h ago', time: tMin },
        { offset: timeSpan * 0.75, label: '4.5h ago', time: tMin + timeSpan * 0.25 },
        { offset: timeSpan * 0.5, label: '3h ago', time: tMin + timeSpan * 0.5 },
        { offset: timeSpan * 0.25, label: '1.5h ago', time: tMin + timeSpan * 0.75 },
        { offset: 0, label: 'Now', time: now }
      ];
    } else if (timeRange === '12h') {
      timeLabels = [
        { offset: timeSpan, label: '12h ago', time: tMin },
        { offset: timeSpan * 0.75, label: '9h ago', time: tMin + timeSpan * 0.25 },
        { offset: timeSpan * 0.5, label: '6h ago', time: tMin + timeSpan * 0.5 },
        { offset: timeSpan * 0.25, label: '3h ago', time: tMin + timeSpan * 0.75 },
        { offset: 0, label: 'Now', time: now }
      ];
    } else {
      // 24h & default
      timeLabels = [
        { offset: timeSpan, label: '24h ago', time: tMin },
        { offset: timeSpan * 0.75, label: '18h ago', time: tMin + timeSpan * 0.25 },
        { offset: timeSpan * 0.5, label: '12h ago', time: tMin + timeSpan * 0.5 },
        { offset: timeSpan * 0.25, label: '6h ago', time: tMin + timeSpan * 0.75 },
        { offset: 0, label: 'Now', time: now }
      ];
    }

    let timeLabelsSvg = '';
    let verticalGridSvg = '';
    timeLabels.forEach((item, i) => {
      const fraction = 1 - (item.offset / timeSpan);
      const x = padL + fraction * plotW;
      const anchor = i === 0 ? 'start' : (i === timeLabels.length - 1 ? 'end' : 'middle');
      const clockStr = formatClockTime(item.time);

      verticalGridSvg += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3 3" stroke-width="1" />`;
      timeLabelsSvg += `<text x="${x.toFixed(1)}" y="${(padT + plotH + 15).toFixed(1)}" text-anchor="${anchor}" fill="rgba(255,255,255,0.75)" font-size="9.5" font-family="sans-serif">${clockStr}</text>`;
      timeLabelsSvg += `<text x="${x.toFixed(1)}" y="${(padT + plotH + 27).toFixed(1)}" text-anchor="${anchor}" fill="rgba(255,255,255,0.35)" font-size="8.5" font-family="sans-serif">${item.label}</text>`;
    });

    const currentModeColor = isCharging ? '#10b981' : (currentLevel <= 20 ? '#ef4444' : '#f59e0b');
    const areaSvg = areaPathD ? `<path d="${areaPathD}" fill="url(#bgcAreaGrad)" />` : '';

    return `
      <svg class="bgc-svg-chart" viewBox="0 0 ${W} ${H}">
        <defs>
          <linearGradient id="bgcAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="${currentModeColor}" stop-opacity="0.25" />
            <stop offset="100%" stop-color="${currentModeColor}" stop-opacity="0.01" />
          </linearGradient>
        </defs>
        ${verticalGridSvg}
        ${gridLinesSvg}
        ${emptyStateSvg}
        ${areaSvg}
        ${segmentsSvg}
        ${dotsSvg}
        ${timeLabelsSvg}
      </svg>
    `;
  }

  function updateGraphModalContent(overlay, targetDeviceId) {
    const devName = targetDeviceId || _latestBatteryState.deviceId || 'Wireless Mouse';

    // Reconcile most accurate battery level
    let lvl = typeof _latestBatteryState.level === 'number' ? _latestBatteryState.level : 80;
    if (Array.isArray(_latestBatteryHistory) && _latestBatteryHistory.length > 0) {
      const lastPt = _latestBatteryHistory[_latestBatteryHistory.length - 1];
      if (typeof lastPt.level === 'number') {
        lvl = lastPt.level;
        _latestBatteryState.level = lvl;
      }
    }
    const domVal = document.querySelector('[class*="battery-pill"] [class*="value"], [class*="_battery-pill_"] [class*="_value_"], [class*="battery" i] [class*="value" i]');
    if (domVal && domVal.textContent) {
      const m = domVal.textContent.match(/(\d{1,3})%/);
      if (m) {
        lvl = parseInt(m[1], 10);
        _latestBatteryState.level = lvl;
      }
    }

    const isChg = Boolean(_latestBatteryState.isCharging);
    const est = _latestBatteryState.estimate || (isChg ? 'Charging' : `~${Math.max(1, Math.round(lvl / 1.6))}h remaining`);
    const velocity = calculateVelocity(_latestBatteryHistory) || (isChg ? '+45.0% / hr (USB)' : '-1.5% / hr (Normal)');

    const statePillClass = isChg ? 'charging' : (lvl <= 20 ? 'critical' : 'discharging');
    const stateIcon = isChg ? '⚡' : (lvl <= 20 ? '🪫' : '🔋');
    const stateText = isChg ? 'Charging' : (lvl <= 20 ? 'Low Battery' : 'Discharging');

    const metrics = calculateSessionMetrics(_latestBatteryHistory);

    // Multi-device switcher tabs (if multiple paired devices exist)
    const deviceKeys = Object.keys(_cachedAllDeviceStats || {});
    let deviceTabsHtml = '';
    if (deviceKeys.length > 1) {
      deviceTabsHtml = `
        <div class="bgc-device-tabs">
          ${deviceKeys.map((k) => `
            <button class="bgc-device-tab ${k === devName ? 'active' : ''}" data-dev="${k}">
              ${k}
            </button>
          `).join('')}
        </div>
      `;
    }

    // Time-range filter pills
    const timeRanges = [
      { id: '6h', label: '6 Hours' },
      { id: '12h', label: '12 Hours' },
      { id: '24h', label: '24 Hours' },
      { id: 'auto', label: 'Adaptive' }
    ];
    const rangePillsHtml = `
      <div class="bgc-range-pills">
        ${timeRanges.map((r) => `
          <button class="bgc-range-pill ${_selectedTimeRange === r.id ? 'active' : ''}" data-range="${r.id}">
            ${r.label}
          </button>
        `).join('')}
      </div>
    `;

    const svgHtml = generateBatterySvg(_latestBatteryHistory, lvl, isChg, { timeRange: _selectedTimeRange });

    overlay.innerHTML = `
      <div class="bgc-battery-graph-card" id="bgc-graph-card">
        <div class="bgc-graph-header">
          <div>
            <div class="bgc-graph-title">
              <span>📈</span>
              <span>${devName} — Battery Telemetry</span>
            </div>
            <div class="bgc-graph-subtitle">Live Discharge & Charge History Tracking (Hourly Checkpoints • Real-time Sync)</div>
          </div>
          <div class="bgc-header-actions">
            <button class="bgc-graph-btn" id="bgc-refresh-btn" title="Refresh Telemetry">🔄</button>
            <button class="bgc-graph-close" id="bgc-close-btn" title="Close">✕</button>
          </div>
        </div>

        ${deviceTabsHtml}

        <div class="bgc-graph-controls-row">
          <div class="bgc-control-label">Time Window:</div>
          ${rangePillsHtml}
        </div>

        <div class="bgc-graph-metrics">
          <div class="bgc-metric-chip">
            <div class="bgc-metric-label">Current Battery</div>
            <div class="bgc-metric-val ${statePillClass}">
              <span class="bgc-pulse-dot ${statePillClass}"></span>
              ${stateIcon} ${lvl}% ${stateText}
            </div>
          </div>
          <div class="bgc-metric-chip">
            <div class="bgc-metric-label">Velocity / Rate</div>
            <div class="bgc-metric-val ${statePillClass}">${velocity}</div>
          </div>
          <div class="bgc-metric-chip">
            <div class="bgc-metric-label">${isChg ? 'Time to Full' : 'Estimated Runtime'}</div>
            <div class="bgc-metric-val ${statePillClass}">${est}</div>
          </div>
          <div class="bgc-metric-chip">
            <div class="bgc-metric-label">Session Range</div>
            <div class="bgc-metric-val">Low ${metrics.min}% • High ${metrics.max}%</div>
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
              <span>⚡ Charging (Upward)</span>
            </div>
            <div class="bgc-legend-item">
              <div class="bgc-legend-dot discharging"></div>
              <span>🔋 Discharging (Normal)</span>
            </div>
            <div class="bgc-legend-item">
              <div class="bgc-legend-dot critical"></div>
              <span>⚠️ Low Battery (&lt;20%)</span>
            </div>
          </div>
          <div class="bgc-sync-info">
            <span>● Live Sync Active</span>
            <span>(${metrics.count} checkpoints logged)</span>
          </div>
        </div>
      </div>
    `;

    // Close button
    const closeBtn = overlay.querySelector('#bgc-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeBatteryGraphModal);

    // Refresh button
    const refreshBtn = overlay.querySelector('#bgc-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.classList.add('rotating');
        if (ipcRenderer && ipcRenderer.invoke) {
          try {
            await ipcRenderer.invoke('bgc:check-battery-hourly');
            await fetchHistory(devName);
          } catch (_) {}
        }
        updateGraphModalContent(overlay, devName);
        setTimeout(() => refreshBtn.classList.remove('rotating'), 600);
      });
    }

    // Time range pills
    const rangeBtns = overlay.querySelectorAll('.bgc-range-pill');
    rangeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const range = btn.getAttribute('data-range');
        if (range) {
          _selectedTimeRange = range;
          updateGraphModalContent(overlay, devName);
        }
      });
    });

    // Device switch tabs
    const devBtns = overlay.querySelectorAll('.bgc-device-tab');
    devBtns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const target = btn.getAttribute('data-dev');
        if (target) {
          await fetchHistory(target);
          updateGraphModalContent(overlay, target);
        }
      });
    });

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
            tooltip.style.top = `${cy - 12}px`;
          }
        });
        dot.addEventListener('mouseleave', () => {
          tooltip.style.opacity = '0';
          tooltip.style.display = 'none';
        });
      });
    }
  }

  let _graphRefreshInterval = null;

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

    // 1. Inspect DOM for current battery percentage as instant ground truth
    const domVal = document.querySelector(
      '[class*="battery-pill"] [class*="value"], [class*="_battery-pill_"] [class*="_value_"], [class*="battery" i] [class*="value" i], [class*="battery" i]'
    );
    if (domVal && domVal.textContent) {
      const m = domVal.textContent.match(/(\d{1,3})%/);
      if (m) {
        _latestBatteryState.level = parseInt(m[1], 10);
        _lastBatteryLevel = _latestBatteryState.level;
      }
    }

    // 2. Fetch full stats from main process & trigger hourly refresh
    if (ipcRenderer && ipcRenderer.invoke) {
      try {
        await ipcRenderer.invoke('bgc:check-battery-hourly');
      } catch (_) {}
      try {
        const stats = await ipcRenderer.invoke('bgc:get-battery-stats');
        if (stats && typeof stats === 'object') {
          _cachedAllDeviceStats = stats;
          const key = targetDeviceId || _latestBatteryState.deviceId || Object.keys(stats)[0];
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

    // 3. Ensure live checkpoint: if empty or last point older than 5 minutes, record current live level!
    const now = Date.now();
    const curLevel = typeof _latestBatteryState.level === 'number' ? _latestBatteryState.level : 80;
    const curCharging = Boolean(_latestBatteryState.isCharging);
    const lastHist = _latestBatteryHistory.length > 0 ? _latestBatteryHistory[_latestBatteryHistory.length - 1] : null;

    if (!lastHist || (now - lastHist.time >= 5 * 60 * 1000) || lastHist.level !== curLevel) {
      _latestBatteryHistory.push({
        time: now,
        level: curLevel,
        isCharging: curCharging,
        isHourlyCheck: false
      });
      if (_latestBatteryHistory.length > 500) _latestBatteryHistory.shift();
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('bgc_battery_history', JSON.stringify(_latestBatteryHistory));
        }
      } catch (_) {}
      if (ipcRenderer && ipcRenderer.send) {
        try {
          ipcRenderer.send('bgc:report-battery', {
            deviceId: targetDeviceId || _latestBatteryState.deviceId || 'Wireless Mouse',
            level: curLevel,
            isCharging: curCharging
          });
        } catch (_) {}
      }
    } else if (lastHist && typeof lastHist.level === 'number') {
      _latestBatteryState.level = lastHist.level;
      _latestBatteryState.isCharging = Boolean(lastHist.isCharging);
    }

    updateGraphModalContent(overlay, targetDeviceId);
    overlay.style.display = 'flex';

    if (!_graphRefreshInterval) {
      _graphRefreshInterval = setInterval(() => {
        const modal = document.getElementById('bgc-battery-graph-modal');
        if (modal && modal.style.display !== 'none') {
          updateGraphModalContent(modal, targetDeviceId);
        }
      }, 30000);
    }
  }

  function closeBatteryGraphModal() {
    const overlay = document.getElementById('bgc-battery-graph-modal');
    if (overlay) {
      overlay.style.display = 'none';
    }
    if (_graphRefreshInterval) {
      clearInterval(_graphRefreshInterval);
      _graphRefreshInterval = null;
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

        // Make pill clickable to open graph
        if (!pill.dataset.bgcGraphHooked) {
          pill.dataset.bgcGraphHooked = 'true';
          pill.style.cursor = 'pointer';
          pill.title = 'Click to view battery history & telemetry graph 📈';
          pill.addEventListener('click', (e) => {
            e.stopPropagation();
            openBatteryGraphModal();
          });
        }

        // Inject sleek 📈 button if none exists in this pill or document
        const hasBtn = pill.querySelector('.bgc-graph-pill-btn') || document.querySelector('.bgc-graph-pill-btn');
        if (!hasBtn) {
          const btn = document.createElement('span');
          btn.className = 'bgc-graph-pill-btn';
          btn.innerHTML = '📈';
          btn.title = 'View Battery History & Analytics 📈';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openBatteryGraphModal();
          });
          if (valElem !== pill && valElem.parentNode) {
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
            const isCharging = pill.className.includes('charging') || (txt.toLowerCase().includes('charging'));
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
