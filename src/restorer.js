const fs = require('fs');
const path = require('path');
const { verifyBackup } = require('./backup');
const { isAppRunning, getRunningProcesses } = require('./process');

/**
 * Restores the stock app.asar from app.asar.original.
 * @param {string} resourcesDir Path to Glorious Core resources directory
 * @param {object} [options]
 * @param {boolean} [options.force] Bypass process check if true
 * @returns {{ success: boolean, message: string }}
 */
function restoreStock(resourcesDir, options = {}) {
  // 1. Process safety check
  if (!options.force && isAppRunning()) {
    const running = getRunningProcesses().join(', ');
    throw new Error(
      `Cannot restore while Glorious Core is running (${running}). Please close the application first.`
    );
  }

  // 2. Validate backup
  const backupCheck = verifyBackup(resourcesDir);
  if (!backupCheck.valid) {
    throw new Error(`Cannot restore: ${backupCheck.error}`);
  }

  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = backupCheck.path;

  // 3. Staging copy to avoid corrupting app.asar if interrupted
  const tempRestorePath = path.join(resourcesDir, 'app.asar.restore_tmp');

  try {
    fs.copyFileSync(backupPath, tempRestorePath);

    // Replace app.asar atomically
    if (fs.existsSync(asarPath)) {
      fs.unlinkSync(asarPath);
    }
    fs.renameSync(tempRestorePath, asarPath);

    // Also restore unpacked directory from original backup if present
    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
    const backupUnpackedDir = path.join(resourcesDir, 'app.asar.original.unpacked');

    if (fs.existsSync(backupUnpackedDir)) {
      if (fs.existsSync(unpackedDir)) {
        fs.rmSync(unpackedDir, { recursive: true, force: true });
      }
      fs.cpSync(backupUnpackedDir, unpackedDir, { recursive: true });
    }

    return {
      success: true,
      message: 'Stock Glorious Core restored successfully from original backup.'
    };
  } catch (err) {
    if (fs.existsSync(tempRestorePath)) {
      try {
        fs.unlinkSync(tempRestorePath);
      } catch {
        // Ignore cleanup error
      }
    }
    throw new Error(`Restore failed: ${err.message}`);
  }
}

module.exports = {
  restoreStock
};
