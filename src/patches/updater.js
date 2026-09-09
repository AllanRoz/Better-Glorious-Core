const fs = require('fs');
const path = require('path');

const UPDATER_SIGNATURE = '/* Better Glorious Core - Auto-Updater Locked */';

/**
 * Disables background auto-updater checks, auto-downloads, and install-on-quit in the main process bundle.
 * @param {string} extractedDir Root directory of extracted asar
 * @returns {{ patchedFiles: string[], details: string[] }}
 */
function applyUpdaterPatch(extractedDir) {
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
    throw new Error('Could not find main process bundle to apply auto-updater patch.');
  }

  let content = fs.readFileSync(mainFile, 'utf8');
  const original = content;
  const details = [];

  // 1. Replace autoUpdater.checkForUpdatesAndNotify(...) and autoUpdater.checkForUpdates(...)
  const checkUpdatesPattern = /(\bautoUpdater\.checkForUpdates(?:AndNotify)?\s*\([^)]*\))/g;
  if (checkUpdatesPattern.test(content)) {
    content = content.replace(checkUpdatesPattern, 'Promise.resolve(null) /* disabled by BGC */');
    details.push('Neutralized autoUpdater.checkForUpdates() checks');
  }

  // 2. Disable autoDownload & autoInstallOnAppQuit flags
  const autoDownloadPattern = /(\bautoUpdater\.autoDownload\s*=\s*)true/g;
  if (autoDownloadPattern.test(content)) {
    content = content.replace(autoDownloadPattern, '$1false');
    details.push('Forced autoUpdater.autoDownload = false');
  }

  const autoInstallPattern = /(\bautoUpdater\.autoInstallOnAppQuit\s*=\s*)true/g;
  if (autoInstallPattern.test(content)) {
    content = content.replace(autoInstallPattern, '$1false');
    details.push('Forced autoUpdater.autoInstallOnAppQuit = false');
  }

  // 3. Neutralize quitAndInstall
  const quitInstallPattern = /(\bautoUpdater\.quitAndInstall\s*\([^)]*\))/g;
  if (quitInstallPattern.test(content)) {
    content = content.replace(quitInstallPattern, 'console.log("[BGC] Prevented quitAndInstall update overwrite")');
    details.push('Neutralized autoUpdater.quitAndInstall()');
  }

  // 4. Inject defensive runtime override guard
  if (!content.includes(UPDATER_SIGNATURE)) {
    const updaterOverrideCode = `
${UPDATER_SIGNATURE}
try {
  const electronUpdater = require('electron-updater');
  if (electronUpdater && electronUpdater.autoUpdater) {
    electronUpdater.autoUpdater.autoDownload = false;
    electronUpdater.autoUpdater.autoInstallOnAppQuit = false;
    electronUpdater.autoUpdater.checkForUpdates = () => Promise.resolve(null);
    electronUpdater.autoUpdater.checkForUpdatesAndNotify = () => Promise.resolve(null);
  }
} catch (_) {}
`;
    content = updaterOverrideCode + content;
    details.push('Injected runtime electron-updater override guard');
  }

  if (content !== original) {
    fs.writeFileSync(mainFile, content, 'utf8');
  }

  return {
    patchedFiles: [path.relative(extractedDir, mainFile)],
    details: [
      '[✓] Disabled background auto-updater (preserves modded app.asar)',
      ...details.map((d) => `    - ${d}`)
    ]
  };
}

module.exports = {
  applyUpdaterPatch
};
