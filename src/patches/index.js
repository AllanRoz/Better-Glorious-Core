const { applyBranding } = require('./branding');
const { injectHookLoader } = require('./hook-loader');
const { applyBatteryPatch } = require('./battery');
const { applyTelemetryPatch } = require('./telemetry');

/**
 * Registry of active patches to run on the extracted asar.
 */
const PATCHES = [
  {
    name: 'Branding & IPC Rebranding',
    description: 'Updates package name, window title, tray items, and IPC pipe handle',
    execute: (extractedDir) => applyBranding(extractedDir)
  },
  {
    name: 'Mod Loader Hook Injection',
    description: 'Embeds custom runtime scripts and hooks into Electron BrowserWindow creation',
    execute: (extractedDir) => injectHookLoader(extractedDir)
  },
  {
    name: 'Battery Percentage & Telemetry Fix',
    description: 'Enables numeric battery percentage in UI and fixes HID unpadded hex telemetry bug',
    execute: (extractedDir) => applyBatteryPatch(extractedDir)
  },
  {
    name: 'Telemetry & Analytics Blocker',
    description: 'Disables Sentry crash reporting and blocks background usage tracking',
    execute: (extractedDir) => applyTelemetryPatch(extractedDir)
  }
];

/**
 * Runs all registered patches against the extracted ASAR root directory.
 * @param {string} extractedDir Root directory of extracted asar
 * @returns {Array<{ name: string, success: boolean, result?: any, error?: string }>}
 */
function runPatches(extractedDir) {
  const results = [];

  for (const patch of PATCHES) {
    try {
      const result = patch.execute(extractedDir);
      results.push({
        name: patch.name,
        success: true,
        result
      });
    } catch (err) {
      results.push({
        name: patch.name,
        success: false,
        error: err.message
      });
      throw new Error(`Patch "${patch.name}" failed: ${err.message}`);
    }
  }

  return results;
}

module.exports = {
  PATCHES,
  runPatches
};
