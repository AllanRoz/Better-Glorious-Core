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
const Sentry = { init: function(opts) {} };
Sentry.init({ dsn: "https://mock@sentry.io/123" });

function trackEvent(name, data) {
  console.log("Telemetry event:", name);
}

const autoUpdater = { checkForUpdatesAndNotify: function() {}, autoDownload: true };
autoUpdater.checkForUpdatesAndNotify();

class HID {
  static knownDevices = [
    { vid: "0x093a", pid: "0x821a", name: "Glorious Model D 2 Wireless" }
  ];

  static async #deviceDataCallback(data, deviceInfo) {
    const vid = \`0x\${deviceInfo.vid.toString(16).toLowerCase()}\`;
    const pid = \`0x\${deviceInfo.pid.toString(16).toLowerCase()}\`;

    const matched = HID.knownDevices.find(
      (methodData) => methodData.vid.toLowerCase() === vid && methodData.pid.toLowerCase() === pid
    );

    if (data[0] === 6 && data[1] === 251) {
      const isCharging = false;
      const batteryLevel = data[2];
      return { batteryLevel, isCharging };
    } else if (data[0] == 6 && data[1] == 249 && data[2] >= 128) {
      console.log("Mouse button event");
    }
  }

  static async requestBatteryStatsAndUpdateIfSuccessful(device) {
    return true;
  }

  static async setPerformance(deviceState, mousePerformanceState) {
    return true;
  }

  static setupDevice(device) {
    let batteryStatsInterval = null;
    const startBatteryStatsInterval = (device2, connectionMethod, interval = 10000) => {
      if (batteryStatsInterval) {
        clearInterval(batteryStatsInterval);
      }
      batteryStatsInterval = setInterval(async () => {
        await this.requestBatteryStatsAndUpdateIfSuccessful(device2);
      }, interval);
    };
    startBatteryStatsInterval(device, "Reciever");
  }
}

const DEFAULT_KEY_BUFFER = Buffer.from([
  1, 1, 0, 0,
  1, 2, 0, 0,
  1, 3, 0, 0,
  1, 4, 0, 0,
  1, 5, 0, 0,
  102, 3, 0, 0,
  1, 160, 0, 0,
  1, 161, 0, 0
]);

function mockKeybindings(dataBuffer, target, dataOffset, hidButtonId, layerOffset, boundData) {
  if (isDPI) {
    dataBuffer[dataOffset] = 102;
  } else {
    dataBuffer[dataOffset] = 1;
  }

  if (isDPI) {
    dataBuffer[hidButtonId * 4 + 0 + layerOffset] = 102;
  } else {
    dataBuffer[hidButtonId * 4 + 0 + layerOffset] = 1;
  }
}

class Device {
  static gloriousDevices = [];
  static init(device) {
    Device.gloriousDevices.push(device);
  }
}

function initApp() {
  const TrayIcon = new electron.Tray();
  TrayIcon.setToolTip("Glorious Core");
  console.log("Glorious Core started, handleName:", handleName);
}
initApp();
`;
  fs.writeFileSync(path.join(mainDir, 'index.js'), mainJsContent, 'utf8');

  // 3. Mock out/renderer-process/index.html & assets/index-sample.js
  const rendererDir = path.join(stagingDir, 'out', 'renderer-process');
  const assetsDir = path.join(rendererDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Glorious Core</title>
</head>
<body>
  <div id="root"><h1>Glorious Core v2.1.0</h1></div>
  <script src="./assets/index-sample.js"></script>
</body>
</html>`;
  fs.writeFileSync(path.join(rendererDir, 'index.html'), htmlContent, 'utf8');

  const rendererJsContent = `
// Sample minified renderer bundle
const BatteryPill = {};
function renderBattery(deviceState2) {
  return [
    BatteryPill,
    {
      value: deviceState2.hardwareStatus.batteryLevel,
      isCharging: deviceState2.hardwareStatus.isCharging,
      showValue: false
    }
  ];
}
const BatteryPill$1 = ({ isCharging = false, value2 = 100 }) => {
  return jsxRuntimeExports.jsx("div", { className: "value", children: isNaN(value2) ? void 0 : \`\${value2}%\` });
};
`;
  fs.writeFileSync(path.join(assetsDir, 'index-sample.js'), rendererJsContent, 'utf8');

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
