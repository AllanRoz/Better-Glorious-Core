const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

/**
 * Creates a mock Glorious Core v2 installation for automated testing.
 * @param {string} targetDir
 * @returns {Promise<{ installDir: string, resourcesDir: string, asarPath: string }>}
 */
async function createMockInstallation(targetDir) {
  const installDir = path.resolve(targetDir);
  const resourcesDir = path.join(installDir, 'resources');
  const stagingDir = path.join(installDir, 'staging_source');

  // Clean and prepare directories
  if (fs.existsSync(installDir)) {
    fs.rmSync(installDir, { recursive: true, force: true });
  }
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  // 1. Mock package.json inside asar
  const pkgContent = {
    name: 'glorious-core',
    productName: 'Glorious Core',
    version: '2.1.0',
    main: './out/main/index.js',
    description: 'Official Glorious Core Software'
  };
  fs.writeFileSync(path.join(stagingDir, 'package.json'), JSON.stringify(pkgContent, null, 2), 'utf8');

  // 2. Mock out/main/index.js
  const mainDir = path.join(stagingDir, 'out', 'main');
  fs.mkdirSync(mainDir, { recursive: true });
  const mainJsContent = `
const { app, BrowserWindow, Tray } = require('electron');
const productName = "Glorious Core";
const handleName = "Glorious Core";

function initApp() {
  const tray = new Tray();
  tray.setToolTip("Glorious Core");
  console.log("Glorious Core started, handleName:", handleName);
}
initApp();
`;
  fs.writeFileSync(path.join(mainDir, 'index.js'), mainJsContent, 'utf8');

  // 3. Mock out/renderer-process/index.html
  const rendererDir = path.join(stagingDir, 'out', 'renderer-process');
  fs.mkdirSync(rendererDir, { recursive: true });
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Glorious Core</title>
</head>
<body>
  <div id="root"><h1>Glorious Core v2.1.0</h1></div>
</body>
</html>`;
  fs.writeFileSync(path.join(rendererDir, 'index.html'), htmlContent, 'utf8');

  // 4. Mock a native dependency to test unpack patterns: keytar and usb_addon.node
  const nativeDir = path.join(stagingDir, 'node_modules', 'keytar');
  fs.mkdirSync(nativeDir, { recursive: true });
  fs.writeFileSync(path.join(nativeDir, 'keytar.node'), 'FAKE_BINARY_NODE_CONTENT', 'utf8');
  fs.writeFileSync(path.join(nativeDir, 'index.js'), 'module.exports = {};', 'utf8');

  // 5. Pack into <resources>/app.asar
  const asarPath = path.join(resourcesDir, 'app.asar');
  await asar.createPackageWithOptions(stagingDir, asarPath, {
    unpack: '{*.node,*@koromix*,*jszip*,*keytar*}'
  });

  // Remove temporary staging directory
  fs.rmSync(stagingDir, { recursive: true, force: true });

  return {
    installDir,
    resourcesDir,
    asarPath
  };
}

module.exports = {
  createMockInstallation
};
