const fs = require('fs');
const path = require('path');

/**
 * Recursively locates all files in a directory matching a predicate.
 */
function findFiles(dir, filterFn) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, filterFn));
    } else if (filterFn(fullPath, entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * 1. Frontend Patch:
 * Enables numerical battery percentage next to the battery icon in renderer assets.
 * Changes `showValue: false` (or `!1`) to `showValue: true` for BatteryPill.
 */
function patchRendererBatteryPill(extractedDir) {
  const candidateDirs = [
    path.join(extractedDir, 'out', 'renderer-process'),
    path.join(extractedDir, 'out', 'renderer'),
    path.join(extractedDir, 'out')
  ];

  let candidateFiles = [];
  for (const cDir of candidateDirs) {
    if (fs.existsSync(cDir)) {
      const jsFiles = findFiles(cDir, (f, name) => name.endsWith('.js'));
      candidateFiles.push(...jsFiles);
    }
  }

  // De-duplicate
  candidateFiles = Array.from(new Set(candidateFiles));

  let patched = false;
  const patchedFiles = [];

  // Patterns matching BatteryPill with showValue: false / !1
  // Handles both unminified and minified variants:
  // e.g. BatteryPill, { ..., showValue: false }
  // or { value: ..., isCharging: ..., showValue: false }
  // or showValue: !1
  for (const file of candidateFiles) {
    let content = fs.readFileSync(file, 'utf8');
    const original = content;

    // Pattern 1: Explicit BatteryPill context
    // Matches: BatteryPill, { ... showValue: false/!1 ... }
    content = content.replace(
      /(BatteryPill[\s\S]{1,400}?showValue\s*:\s*)(?:false|!1)/g,
      '$1true'
    );

    // Pattern 2: Context with batteryLevel & showValue: false/!1
    content = content.replace(
      /(batteryLevel[\s\S]{1,250}?showValue\s*:\s*)(?:false|!1)/g,
      '$1true'
    );

    // Pattern 3: Context where showValue is followed by isCharging / batteryLevel
    content = content.replace(
      /(showValue\s*:\s*)(?:false|!1)([\s\S]{1,250}?(?:batteryLevel|isCharging|BatteryPill))/g,
      '$1true$2'
    );

    // Pattern 4: Direct renderBatteryPill or similar definition
    content = content.replace(
      /(renderBatteryPill[\s\S]{1,400}?showValue\s*:\s*)(?:false|!1)/g,
      '$1true'
    );

    // Pattern 5: Persistent battery cache on startup
    // Replaces value: deviceState2.hardwareStatus.batteryLevel with a cached getter/setter
    const valuePattern = /value\s*:\s*([a-zA-Z0-9_$]+)\.hardwareStatus\.batteryLevel/g;
    if (valuePattern.test(content)) {
      content = content.replace(
        valuePattern,
        'value: (function(dev) { try { const cur = dev?.hardwareStatus?.batteryLevel; const k = "bgc_bat_" + (dev?.productId || "mouse"); if (typeof cur === "number" && cur >= 0 && cur <= 100) { try { localStorage.setItem(k, String(cur)); } catch(_) {} return cur; } const cached = localStorage.getItem(k); if (cached !== null && !isNaN(Number(cached))) return Number(cached); return cur; } catch(_) { return dev?.hardwareStatus?.batteryLevel; } })($1)'
      );
    }

    // Pattern 6: Battery value formatter next to battery icon in renderer UI (e.g. 99% (~62h))
    // Matches: children: isNaN(value2) ? void 0 : `${value2}%`
    const batteryFormatPattern = /children:\s*isNaN\(([a-zA-Z0-9_$]+)\)\s*\?\s*void 0\s*:\s*(?:`\$\{\1\}%`|\1\s*\+\s*"%")/g;
    if (batteryFormatPattern.test(content)) {
      if (!content.includes('/* Better Glorious Core - Battery Formatter */')) {
        const formatterFn = `/* Better Glorious Core - Battery Formatter */
function _bgcFormatBattery(val, isChg) {
  try {
    if (typeof window !== "undefined" && typeof window._bgcFormatBattery === "function") {
      var custom = window._bgcFormatBattery(val, isChg);
      if (custom != null) return custom;
    }
  } catch(_) {}
  if (val == null || isNaN(val)) return void 0;
  var n = Number(val);
  if (isChg) return n >= 100 ? "100%" : n + "% (Charging)";
  var r = 1.6;
  try {
    if (window._bgcDischargeRate && window._bgcDischargeRate > 0.5) r = window._bgcDischargeRate;
  } catch(_) {}
  var h = Math.max(1, Math.round(n / r));
  return n + "% (~" + h + "h)";
};
`;
        content = formatterFn + content;
      }
      content = content.replace(
        batteryFormatPattern,
        'children: (typeof _bgcFormatBattery === "function" ? _bgcFormatBattery($1, typeof isCharging !== "undefined" ? isCharging : false) : (isNaN($1) ? void 0 : $1 + "%"))'
      );
    }

    if (content !== original) {
      fs.writeFileSync(file, content, 'utf8');
      patched = true;
      patchedFiles.push(path.relative(extractedDir, file));
    }
  }

  if (!patched) {
    throw new Error(
      'Could not locate BatteryPill showValue configuration in renderer assets (expected showValue: false/!1).'
    );
  }

  return {
    success: true,
    patchedFiles
  };
}

/**
 * 2. Main Process Patch:
 * Fixes unpadded hex string comparison bug in `HID.#deviceDataCallback`.
 * Normalizes vid and pid with `.padStart(4, "0")` and adds numeric parsing check.
 * Also handles Mouse V2 battery telemetry (Report ID 6 / 251) and 255 charging sentinel.
 */
function patchMainDeviceDataCallback(extractedDir) {
  const candidateMainFiles = [
    path.join(extractedDir, 'out', 'main', 'index.js'),
    path.join(extractedDir, 'out', 'main.js'),
    path.join(extractedDir, 'dist', 'main', 'index.js'),
    path.join(extractedDir, 'main.js')
  ];

  let mainFile = null;
  for (const candidate of candidateMainFiles) {
    if (fs.existsSync(candidate)) {
      mainFile = candidate;
      break;
    }
  }

  if (!mainFile) {
    throw new Error('Could not find out/main/index.js in extracted archive.');
  }

  let content = fs.readFileSync(mainFile, 'utf8');
  const original = content;
  const statusLogs = [];

  // -------------------------------------------------------------
  // Part A: Fix Hex String Matching in HID.#deviceDataCallback
  // -------------------------------------------------------------
  // Target:
  // const vid = `0x${deviceInfo.vid.toString(16).toLowerCase()}`;
  // const pid = `0x${deviceInfo.pid.toString(16).toLowerCase()}`;
  const vidPidPattern = /(?:const|let|var)\s+vid\s*=\s*[`"']0x\$\{?deviceInfo\.vid\.toString\(16\)\.toLowerCase\(\)\}?[`"'][;,]?\s*(?:const|let|var)\s+pid\s*=\s*[`"']0x\$\{?deviceInfo\.pid\.toString\(16\)\.toLowerCase\(\)\}?[`"'][;,]?/;

  const vidPidReplacement = `const rawVid = deviceInfo.vid;
const rawPid = deviceInfo.pid;
const vid = \`0x\${rawVid.toString(16).toLowerCase().padStart(4, "0")}\`;
const pid = \`0x\${rawPid.toString(16).toLowerCase().padStart(4, "0")}\`;`;

  if (vidPidPattern.test(content)) {
    content = content.replace(vidPidPattern, vidPidReplacement);
    statusLogs.push('Fixed unpadded hex VID/PID normalization (.padStart(4, "0"))');
  } else if (!content.includes('rawVid.toString(16).toLowerCase().padStart(4, "0")')) {
    // Try broader pattern matching in case of minification
    const broaderVidPattern = /(vid\s*=\s*[`"']0x\$\{?deviceInfo\.vid\.toString\(16\)[^;`"']*[`"'][;,]?\s*(?:const|let|var)?\s*pid\s*=\s*[`"']0x\$\{?deviceInfo\.pid\.toString\(16\)[^;`"']*[`"'])/;
    if (broaderVidPattern.test(content)) {
      content = content.replace(broaderVidPattern, vidPidReplacement);
      statusLogs.push('Fixed unpadded hex VID/PID normalization (broader pattern)');
    } else {
      throw new Error('Could not find unpadded vid/pid generation block in main process bundle.');
    }
  } else {
    statusLogs.push('Hex VID/PID normalization already present.');
  }

  // Target A.2: Update knownDevices.find lookup
  // Fix unpadded hex comparison and vendor 'z0x' prefix (e.g. z0x093A)
  const knownDevicesPattern = /methodData\.vid\.toLowerCase\(\)\s*===?\s*vid\s*&&\s*methodData\.pid\.toLowerCase\(\)\s*===?\s*pid/g;
  const knownDevicesReplacement = `((typeof rawVid !== 'undefined' && parseInt(String(methodData.vid).replace(/^z/i, ''), 16) === rawVid && parseInt(String(methodData.pid).replace(/^z/i, ''), 16) === rawPid) || (typeof deviceInfo !== 'undefined' && parseInt(String(methodData.vid).replace(/^z/i, ''), 16) === deviceInfo.vid && parseInt(String(methodData.pid).replace(/^z/i, ''), 16) === deviceInfo.pid) || (String(methodData.vid).replace(/^z/i, '').toLowerCase() === vid.toLowerCase() && String(methodData.pid).replace(/^z/i, '').toLowerCase() === pid.toLowerCase()))`;

  if (knownDevicesPattern.test(content)) {
    content = content.replace(knownDevicesPattern, knownDevicesReplacement);
    statusLogs.push('Updated knownDevices lookup loop with integer & stripped z0x hex checks');
  } else if (!content.includes('parseInt(String(methodData.vid).replace')) {
    statusLogs.push('Notice: knownDevices lookup matching pattern not found or already updated.');
  }

  // Target A.3: Hook raw HID #deviceDataCallback
  const deviceCallbackPattern = /(static\s+async\s+#deviceDataCallback\s*\(\s*data\s*,\s*deviceInfo\s*\)\s*\{)/g;
  if (deviceCallbackPattern.test(content)) {
    content = content.replace(
      deviceCallbackPattern,
      '$1 try { if (typeof global._bgcOnDeviceData === "function") { global._bgcOnDeviceData(data, deviceInfo); } } catch (_) {}'
    );
    statusLogs.push('Hooked raw HID deviceDataCallback for live mouse input tracking');
  }

  // Target A.4: Hook EventManager.emit for real-time status and DPI telemetry
  const eventManagerPattern = /class\s+EventManager\s*\{\s*static\s+emit\s*\(\s*eventName\s*,\s*\.\.\.args\s*\)\s*\{/g;
  if (eventManagerPattern.test(content)) {
    content = content.replace(
      eventManagerPattern,
      'class EventManager { static emit(eventName, ...args) { try { if (typeof global._bgcOnEventManagerEmit === "function") { global._bgcOnEventManagerEmit(eventName, ...args); } } catch (_) {} '
    );
    statusLogs.push('Hooked EventManager.emit for real-time hardware status, battery, and DPI tracking');
  }

  // Target A.5: Hook hardwareStatus.batteryLevel assignments in updateBatteryStats
  const hwBatteryPattern = /(device\.rendererState\.hardwareStatus\.batteryLevel\s*=\s*)([^;]+);/g;
  if (hwBatteryPattern.test(content)) {
    content = content.replace(
      hwBatteryPattern,
      '$1$2; try { if (typeof global._bgcOnBatteryUpdate === "function") { global._bgcOnBatteryUpdate(device?.rendererState?.deviceName || device?.supportedDeviceData?.name || "Wireless Mouse", $2, device.rendererState.hardwareStatus.isCharging); } } catch (_) {}'
    );
    statusLogs.push('Hooked hardwareStatus.batteryLevel setter in main process');
  }

  // Target A.6: Hook MouseV2 button reports for DPI HUD cycling
  const mouseV2BtnPattern = /else\s+if\s*\(\s*data\[0\]\s*==\s*6\s*&&\s*data\[1\]\s*==\s*249\s*&&\s*data\[2\]\s*>=\s*128\s*\)\s*\{/g;
  if (mouseV2BtnPattern.test(content)) {
    content = content.replace(
      mouseV2BtnPattern,
      `else if (((data[0] == 6 && (data[1] == 249 || data[1] == 247) && data[2] >= 128) || ((data[0] == 249 || data[0] == 247) && data[1] >= 128))) {
        try {
          const _btnId = data[0] == 6 ? data[3] : data[2];
          if (typeof global._bgcOnDpiButtonPress === 'function' && (_btnId == 5 || _btnId == 6 || _btnId == 8)) {
            global._bgcOnDpiButtonPress(_btnId, device, this);
          }
        } catch (_) {}`
    );
    statusLogs.push('Hooked MouseV2 button handler for physical DPI button cycling');
  }

  // Target A.7: Hook installTray to register global._bgcTray immediately
  const installTrayPattern = /(TrayIcon\s*=\s*new\s+electron\.Tray\([^)]+\);)/g;
  if (installTrayPattern.test(content)) {
    content = content.replace(
      installTrayPattern,
      `$1 try { global._bgcTray = TrayIcon; if (typeof global._bgcOnTrayCreated === 'function') { global._bgcOnTrayCreated(TrayIcon); } } catch (_) {}`
    );
    statusLogs.push('Hooked installTray to register global._bgcTray immediately upon creation');
  }

  // Target A.8: Hook setPerformance to trigger DPI OSD on UI / software DPI changes
  const setPerfPattern = /(static\s+async\s+setPerformance\s*\(\s*deviceState\s*,\s*mousePerformanceState\s*\)\s*\{)/g;
  if (setPerfPattern.test(content)) {
    content = content.replace(
      setPerfPattern,
      `$1 try {
        if (typeof global._bgcOnDpiUpdate === 'function' && mousePerformanceState) {
          const _idx = typeof mousePerformanceState.dpiSelectIndex === 'number' ? mousePerformanceState.dpiSelectIndex : 0;
          const _stg = mousePerformanceState.DpiStage?.[_idx];
          if (_stg) {
            global._bgcOnDpiUpdate({
              dpi: _stg.value,
              stageIndex: _idx + 1,
              totalStages: mousePerformanceState.DpiStage?.length || 4,
              color: _stg.color,
              deviceName: deviceState?.deviceName
            });
          }
        }
      } catch (_) {}`
    );
    statusLogs.push('Hooked setPerformance to trigger live DPI OSD on UI changes');
  }

  // Target A.9: Route DPI buttons to host notification in default and explicit keybuffers
  // Default keybuffers: change button 5 from internal 102 to host notification 4, 1
  const defaultKeyBufPattern = /(1,\s*5,\s*0,\s*0,\s*)102,\s*3(,\s*0,\s*0)/g;
  if (defaultKeyBufPattern.test(content)) {
    content = content.replace(defaultKeyBufPattern, '$14,\n  1$2');
    statusLogs.push('Replaced silent internal DPI button byte (102) with host notification (4, 1) in DEFAULT_KEY_BUFFER');
  }

  // Explicit binding: PrepareKeybindingBuffers and PrepareKeybindingBuffers2
  const p1Pattern = /(if\s*\(\s*isDPI\s*\)\s*\{\s*)(dataBuffer\[dataOffset\]\s*=\s*102;)(\s*\}\s*else\s*\{)/g;
  if (p1Pattern.test(content)) {
    content = content.replace(
      p1Pattern,
      `if (isDPI) {
        if (target.functionIdentifier !== MouseFunctionType.DPIShift) {
          dataBuffer[dataOffset] = 4;
          dataBuffer[dataOffset + 1] = 1;
        } else {
          dataBuffer[dataOffset] = 102;
        }
      } else {`
    );
    statusLogs.push('Patched PrepareKeybindingBuffers to route DPI cycle buttons to host notification (4, 1)');
  }

  // Explicit binding: setBufferValueFromBinding and setBufferValueFromBinding$1
  const p2Pattern = /(if\s*\(\s*isDPI\s*\)\s*\{\s*)(dataBuffer\[hidButtonId\s*\*\s*4\s*\+\s*0\s*\+\s*layerOffset\]\s*=\s*102;)(\s*\}\s*else\s*\{)/g;
  if (p2Pattern.test(content)) {
    content = content.replace(
      p2Pattern,
      `if (isDPI) {
        if (boundData.target.functionIdentifier !== MouseFunctionType.DPIShift) {
          dataBuffer[hidButtonId * 4 + 0 + layerOffset] = 4;
          dataBuffer[hidButtonId * 4 + 1 + layerOffset] = 1;
        } else {
          dataBuffer[hidButtonId * 4 + 0 + layerOffset] = 102;
        }
      } else {`
    );
    statusLogs.push('Patched setBufferValueFromBinding to route DPI cycle buttons to host notification (4, 1)');
  }

  // Target A.10: Auto-push keybindings on device connect to program mouse onboard flash
  const devInitPattern = /(Device\.gloriousDevices\.push\(device\);)/g;
  if (devInitPattern.test(content)) {
    content = content.replace(
      devInitPattern,
      `$1
    try { global._bgcDeviceClass = Device; } catch (_) {}
    try {
      if (device && (device?.supportedDeviceData?.category === 'Mouse' || device?.supportedDeviceData?.category === DeviceCategory.Mouse) && typeof specificDeviceHandler?.updateAllKeyBinding === 'function') {
        setTimeout(async () => {
          try {
            const _p = device.rendererState?.currentProfileData;
            if (_p) {
              const _layers = _p.layers || {};
              const _keyStates = [
                _layers[0]?.keybindingData || new DeviceKeybindingState(),
                _layers[1]?.keybindingData || new DeviceKeybindingState(),
                _layers[2]?.keybindingData || new DeviceKeybindingState()
              ];
              await specificDeviceHandler.updateAllKeyBinding(device.rendererState, _keyStates);
              if (typeof global._bgcLog === 'function') {
                global._bgcLog('Auto-synced mouse keybindings for DPI HUD reporting');
              }
            }
          } catch (err) {
            if (typeof global._bgcLog === 'function') {
              global._bgcLog('Auto-sync keybindings error: ' + (err?.message || err));
            }
          }
        }, 1200);
      }
    } catch (_) {}`
    );
    statusLogs.push('Hooked Device.init to automatically sync keybindings to mouse onboard flash');
  }

  // Target A.11: Optimize setPerformance report transmission delays and async persistence (<50ms)
  const perfDelayPattern = /let\s+delay\s*=\s*30;\s*switch\s*\(\s*device\.communicationMethod\s*\)\s*\{\s*case\s*["']USB["']:\s*case\s*["']Reciever["']:\s*delay\s*=\s*150;\s*break;\s*case\s*["']Bluetooth["']:\s*delay\s*=\s*30;\s*break;\s*default:\s*throw\s+new\s+Error\([^)]+\);\s*\}\s*for\s*\(\s*const\s+buffer2\s+of\s+buffers\s*\)\s*\{\s*await\s+this\.sendReportToDevice\(device,\s*buffer2,\s*delay\);\s*\}\s*DataStorage\.saveDeviceInstance\(device\.toRecord\(\)\);\s*DataStorage\.saveDeviceProfile\(device\.rendererState\.currentProfileData\);/g;

  if (perfDelayPattern.test(content)) {
    content = content.replace(
      perfDelayPattern,
      `let delay = (device.communicationMethod === "Bluetooth") ? 20 : 15;
    for (let _bIdx = 0; _bIdx < buffers.length; _bIdx++) {
      const buffer2 = buffers[_bIdx];
      const _chunkDelay = _bIdx === 0 ? 5 : delay;
      await this.sendReportToDevice(device, buffer2, _chunkDelay);
    }
    setTimeout(() => {
      try {
        DataStorage.saveDeviceInstance(device.toRecord());
        DataStorage.saveDeviceProfile(device.rendererState.currentProfileData);
      } catch (_) {}
    }, 10);`
    );
    statusLogs.push('Optimized setPerformance inter-packet delays and async disk serialization (<50ms)');
  }

  // -------------------------------------------------------------
  // Part B: Handle Mouse V2 Battery Telemetry & Charging Sentinels
  // -------------------------------------------------------------
  // Support both Report ID 6 packets (data[0] === 6 && data[1] === 251) and stripped Report ID packets (data[0] === 251)
  const report6Pattern = /data\[0\]\s*===?\s*6\s*&&\s*data\[1\]\s*===?\s*251/g;
  if (report6Pattern.test(content)) {
    content = content.replace(
      report6Pattern,
      '((data[0] === 6 && data[1] === 251) || data[0] === 251)'
    );
    statusLogs.push('Added support for stripped Report ID (data[0] === 251) telemetry packets');
  }

  // Handle 255 charge sentinel in battery parsing
  // Sentinel helper injection: keeps last known percentage when firmware reports 255 (charging)
  const sentinelHelperSignature = '/* Better Glorious Core - Battery Sentinel Helper */';
  if (!content.includes(sentinelHelperSignature)) {
    const sentinelHelperCode = `
${sentinelHelperSignature}
const _bgcLastBatteryMap = (global._bgcLastBatteryMap = global._bgcLastBatteryMap || new Map());
function _bgcHandleDpiReport(deviceId, stageOrDpi, totalStages, color, profileName) {
  if (typeof global._bgcOnDpiUpdate === 'function') {
    try {
      global._bgcOnDpiUpdate({
        deviceId: String(deviceId || 'mouse'),
        dpi: typeof stageOrDpi === 'number' && stageOrDpi > 50 ? stageOrDpi : undefined,
        stageIndex: typeof stageOrDpi === 'number' && stageOrDpi <= 10 ? stageOrDpi : undefined,
        totalStages: totalStages || 4,
        color,
        profileName
      });
    } catch (_) {}
  }
}
global._bgcHandleDpiReport = _bgcHandleDpiReport;
function _bgcParseBattery(deviceId, rawValue, currentChargingState) {
  const key = String(deviceId || 'default');
  let level;
  let isCharging = Boolean(currentChargingState);
  if (rawValue === 255) {
    level = _bgcLastBatteryMap.get(key) || 100;
    isCharging = true;
  } else {
    level = Math.max(0, Math.min(100, Number(rawValue) || 0));
    _bgcLastBatteryMap.set(key, level);
  }
  if (typeof global._bgcOnBatteryUpdate === 'function') {
    try {
      global._bgcOnBatteryUpdate(key, level, isCharging);
    } catch (_) {}
  }
  return { batteryLevel: level, isCharging };
}

`;
    // Prepend or inject helper near top of file
    content = sentinelHelperCode + content;

    // Now look for batteryLevel assignments in device telemetry handlers
    // Pattern: batteryLevel: ... or batteryLevel = ...
    // E.g.: batteryLevel: data[...], isCharging: ...
    const batteryAssignPattern = /(batteryLevel\s*:\s*)(data\[\s*[^\]]+\s*\])/g;
    if (batteryAssignPattern.test(content)) {
      content = content.replace(
        batteryAssignPattern,
        (match, prefix, expr) => {
          return `${prefix}(_bgcParseBattery(deviceInfo?.id || deviceInfo?.serialNumber, ${expr}, isCharging).batteryLevel)`;
        }
      );
      statusLogs.push('Patched 255 charging sentinel into batteryLevel telemetry parser');
    } else {
      // Also handle direct variable assignment: batteryLevel = data[...]
      const directAssignPattern = /(batteryLevel\s*=\s*)(data\[\s*[^\]]+\s*\]);/g;
      if (directAssignPattern.test(content)) {
        content = content.replace(
          directAssignPattern,
          (match, prefix, expr) => {
            return `${prefix}_bgcParseBattery(deviceInfo?.id || deviceInfo?.serialNumber, ${expr}, isCharging).batteryLevel;`;
          }
        );
        statusLogs.push('Patched 255 charging sentinel into direct batteryLevel variable assignment');
      }
    }
  }

  // -------------------------------------------------------------
  // Part C: Instant Battery Query on Device Connect & Periodic Polling
  // -------------------------------------------------------------
  // Legacy v1 mice
  const startIntervalPattern = /(const\s+startBatteryStatsInterval\s*=\s*\(([a-zA-Z0-9_$]+),\s*([a-zA-Z0-9_$]+)[^)]*\)\s*=>\s*\{[\s\S]*?if\s*\(batteryStatsInterval\)\s*\{\s*clearInterval\(batteryStatsInterval\);\s*\})/g;
  if (startIntervalPattern.test(content)) {
    content = content.replace(
      startIntervalPattern,
      '$1\n        global._bgcRequestBatteryStats = () => { try { this.requestBatteryStatsAndUpdateIfSuccessful($2).catch(() => {}); } catch (_) {} };\n        try { this.requestBatteryStatsAndUpdateIfSuccessful($2).catch(() => {}); } catch (_) {}'
    );
    statusLogs.push('Injected immediate HID battery query on device connection & registered wake refresh callback (Legacy)');
  }

  // MouseV2 & MouseV2Pro (Model D 2 Wireless, Model O 2 Wireless, Model I 2 Wireless, Model D 2 Pro, Model O 2 Pro)
  const mouseV2InitPattern = /(class\s+MouseV2(?:Pro)?DeviceHandler\s+extends\s+MouseDeviceHandler\s*\{[\s\S]*?static\s+async\s+init\s*\(\s*device[^{]*\{[\s\S]*?HID\.initializeDevice\([^)]*\);[\s\S]*?\}\s*)/g;
  if (mouseV2InitPattern.test(content)) {
    content = content.replace(
      mouseV2InitPattern,
      `$1
    try {
      const _bgcPoll = () => {
        try {
          if (device && typeof this.getBatteryStats === 'function') {
            this.getBatteryStats(device).catch(() => {});
          }
        } catch (_) {}
      };
      setTimeout(_bgcPoll, 200);
      setTimeout(_bgcPoll, 1200);
      setInterval(_bgcPoll, 30000);
      global._bgcRequestBatteryStats = _bgcPoll;
    } catch (_) {}
`
    );
    statusLogs.push('Injected startup & periodic HID battery polling into MouseV2 and MouseV2Pro device handlers');
  }

  if (content !== original) {
    fs.writeFileSync(mainFile, content, 'utf8');
  }

  return {
    success: true,
    file: path.relative(extractedDir, mainFile),
    statusLogs
  };
}

/**
 * Combined Battery Percentage & Telemetry Patch
 * @param {string} extractedDir Root directory of extracted asar
 * @returns {{ patchedFiles: string[], details: string[] }}
 */
function applyBatteryPatch(extractedDir) {
  const patchedFiles = [];
  const details = [];

  // 1. Frontend Patch
  const frontendResult = patchRendererBatteryPill(extractedDir);
  patchedFiles.push(...frontendResult.patchedFiles);
  details.push(`[✓] Enabled numerical battery percentage in renderer UI (${frontendResult.patchedFiles.join(', ')})`);

  // 2. Main Process Patch
  const mainResult = patchMainDeviceDataCallback(extractedDir);
  patchedFiles.push(mainResult.file);
  details.push('[✓] Fixed HID VID/PID unpadded hex telemetry bug in main process');
  for (const log of mainResult.statusLogs) {
    details.push(`    - ${log}`);
  }

  return {
    patchedFiles: Array.from(new Set(patchedFiles)),
    details
  };
}

module.exports = {
  patchRendererBatteryPill,
  patchMainDeviceDataCallback,
  applyBatteryPatch
};
