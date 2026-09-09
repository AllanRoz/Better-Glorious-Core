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
  // Stock: methodData.vid.toLowerCase() === vid && methodData.pid.toLowerCase() === pid
  const knownDevicesPattern = /methodData\.vid\.toLowerCase\(\)\s*===?\s*vid\s*&&\s*methodData\.pid\.toLowerCase\(\)\s*===?\s*pid/;
  const knownDevicesReplacement = `((typeof rawVid !== 'undefined' && parseInt(methodData.vid, 16) === rawVid && parseInt(methodData.pid, 16) === rawPid) || (methodData.vid.toLowerCase() === vid && methodData.pid.toLowerCase() === pid))`;

  if (knownDevicesPattern.test(content)) {
    content = content.replace(knownDevicesPattern, knownDevicesReplacement);
    statusLogs.push('Updated knownDevices lookup loop with integer & padded hex checks');
  } else if (!content.includes('parseInt(methodData.vid, 16) === rawVid')) {
    // If not found, check if it's already patched or log notice
    statusLogs.push('Notice: knownDevices lookup matching pattern not found or already updated.');
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
