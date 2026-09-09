const fs = require('fs');
const path = require('path');

/**
 * Checks whether a backup of the original app.asar exists.
 * @param {string} resourcesDir Path to Glorious Core resources directory
 * @returns {boolean}
 */
function hasBackup(resourcesDir) {
  const backupPath = path.join(resourcesDir, 'app.asar.original');
  return fs.existsSync(backupPath);
}

/**
 * Creates a permanent backup of app.asar as app.asar.original if one does not already exist.
 * Guaranteed never to overwrite an existing backup.
 * @param {string} resourcesDir Path to Glorious Core resources directory
 * @returns {{ created: boolean, backupPath: string, size: number }}
 */
function createBackup(resourcesDir) {
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.original');

  if (fs.existsSync(backupPath)) {
    const stats = fs.statSync(backupPath);
    return {
      created: false,
      backupPath,
      size: stats.size,
      message: 'Original backup already exists. Preserved existing backup.'
    };
  }

  if (!fs.existsSync(asarPath)) {
    throw new Error(`Cannot create backup: "${asarPath}" does not exist.`);
  }

  const asarStats = fs.statSync(asarPath);
  if (asarStats.size === 0) {
    throw new Error(`Cannot create backup: "${asarPath}" is 0 bytes (corrupted).`);
  }

  // Copy app.asar to app.asar.original safely
  fs.copyFileSync(asarPath, backupPath);

  const backupStats = fs.statSync(backupPath);
  if (backupStats.size !== asarStats.size) {
    fs.unlinkSync(backupPath);
    throw new Error('Backup failed: File size mismatch after copy.');
  }

  // Also backup app.asar.unpacked if present
  const unpackedPath = asarPath + '.unpacked';
  const backupUnpackedPath = backupPath + '.unpacked';
  if (fs.existsSync(unpackedPath) && !fs.existsSync(backupUnpackedPath)) {
    fs.cpSync(unpackedPath, backupUnpackedPath, { recursive: true });
  }

  return {
    created: true,
    backupPath,
    size: backupStats.size,
    message: 'Original backup created successfully.'
  };
}

/**
 * Validates the backup file integrity.
 * @param {string} resourcesDir
 * @returns {{ valid: boolean, path: string, size?: number, error?: string }}
 */
function verifyBackup(resourcesDir) {
  const backupPath = path.join(resourcesDir, 'app.asar.original');
  if (!fs.existsSync(backupPath)) {
    return { valid: false, path: backupPath, error: 'Backup does not exist.' };
  }

  const stats = fs.statSync(backupPath);
  if (stats.size === 0) {
    return { valid: false, path: backupPath, error: 'Backup is 0 bytes.' };
  }

  return { valid: true, path: backupPath, size: stats.size };
}

module.exports = {
  hasBackup,
  createBackup,
  verifyBackup
};
