const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Returns an array of standard installation directories for Glorious Core.
 */
function getCommonPaths() {
  const paths = [];

  if (process.env.LOCALAPPDATA) {
    paths.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Glorious Core'));
    paths.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'glorious-core'));
  }

  if (process.env.ProgramFiles) {
    paths.push(path.join(process.env.ProgramFiles, 'Glorious Core'));
    paths.push(path.join(process.env.ProgramFiles, 'glorious-core'));
  }

  if (process.env['ProgramFiles(x86)']) {
    paths.push(path.join(process.env['ProgramFiles(x86)'], 'Glorious Core'));
    paths.push(path.join(process.env['ProgramFiles(x86)'], 'glorious-core'));
  }

  return paths;
}

/**
 * Searches the Windows Registry for Glorious Core installation path.
 */
function getRegistryPaths() {
  if (process.platform !== 'win32') return [];

  const regHives = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ];

  const foundPaths = [];

  for (const hive of regHives) {
    try {
      // Find subkeys
      const keysOutput = execSync(`reg query "${hive}" /f "Glorious" /k /c 2>nul`, { encoding: 'utf8' });
      const subkeys = keysOutput
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('HKEY_'));

      for (const key of subkeys) {
        try {
          const valOutput = execSync(`reg query "${key}" /v "InstallLocation" 2>nul`, { encoding: 'utf8' });
          const match = valOutput.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
          if (match && match[1] && match[1].trim()) {
            const loc = match[1].trim();
            if (fs.existsSync(loc) && !foundPaths.includes(loc)) {
              foundPaths.push(loc);
            }
          }
        } catch {
          // No InstallLocation in this key
        }
      }
    } catch {
      // Key not found or reg query failed
    }
  }

  return foundPaths;
}

/**
 * Inspects a directory to determine if it is a valid Glorious Core installation.
 * @param {string} dirPath Target directory to test
 * @returns {object|null} Installation metadata if valid, null otherwise
 */
function validateInstallation(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return null;

  const normalized = path.resolve(dirPath);
  if (!fs.existsSync(normalized)) return null;

  // Sometimes user supplies `<dir>/resources` or `<dir>/resources/app.asar`
  let installDir = normalized;
  if (path.basename(normalized).toLowerCase() === 'app.asar' || path.basename(normalized).toLowerCase() === 'app.asar.original') {
    installDir = path.resolve(normalized, '..', '..');
  } else if (path.basename(normalized).toLowerCase() === 'resources') {
    installDir = path.resolve(normalized, '..');
  }

  const resourcesDir = path.join(installDir, 'resources');
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.original');

  // Must have resources directory and at least app.asar or app.asar.original
  if (!fs.existsSync(resourcesDir)) return null;

  const hasAsar = fs.existsSync(asarPath);
  const hasBackup = fs.existsSync(backupPath);

  if (!hasAsar && !hasBackup) {
    return null;
  }

  return {
    installDir,
    resourcesDir,
    asarPath,
    backupPath,
    hasAsar,
    hasBackup,
    isPatched: hasBackup // If backup exists, an active patch or previous patch session occurred
  };
}

const CONFIG_FILE = path.resolve(__dirname, '..', '.bgc-config.json');

function loadSavedPath() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return data.installDir || null;
  } catch {
    return null;
  }
}

function savePath(installDir) {
  // Never save test fixture mock directories
  if (!installDir || installDir.includes('mock-install') || installDir.includes('test')) {
    return;
  }
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ installDir }, null, 2), 'utf8');
  } catch {
    // Ignore write error
  }
}

/**
 * Attempts to automatically find Glorious Core or inspect a user-specified path.
 * @param {string} [customPath]
 * @returns {object|null}
 */
function findGloriousCore(customPath) {
  if (customPath) {
    return validateInstallation(customPath);
  }

  // 1. Check previously saved path from config
  const saved = loadSavedPath();
  if (saved) {
    const valid = validateInstallation(saved);
    if (valid) return valid;
  }

  // 2. Check registry paths
  const regPaths = getRegistryPaths();
  for (const p of regPaths) {
    const valid = validateInstallation(p);
    if (valid) return valid;
  }

  // 3. Check common paths
  const commonPaths = getCommonPaths();
  for (const p of commonPaths) {
    const valid = validateInstallation(p);
    if (valid) return valid;
  }

  return null;
}

module.exports = {
  getCommonPaths,
  getRegistryPaths,
  validateInstallation,
  findGloriousCore,
  loadSavedPath,
  savePath
};
