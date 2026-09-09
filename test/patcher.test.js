const assert = require('assert');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');
const { execSync } = require('child_process');

const { createMockInstallation } = require('./fixture');
const { validateInstallation, findGloriousCore } = require('../src/detector');
const { createBackup, hasBackup, verifyBackup } = require('../src/backup');
const { extractAsar, packAsar, createTempWorkDir, removeDir } = require('../src/asar');
const { runPatches } = require('../src/patches');
const { restoreStock } = require('../src/restorer');

const TEST_DIR = path.resolve(__dirname, 'mock-install');

async function runTests() {
  console.log('🧪 Starting Better Glorious Core Automated Test Suite...\n');

  // Step 1: Create Mock Glorious Core Installation
  console.log('1. Setting up mock Glorious Core installation...');
  const mock = await createMockInstallation(TEST_DIR);
  assert(fs.existsSync(mock.asarPath), 'Mock app.asar must exist');
  console.log('   ✔ Mock installation created successfully.');

  // Step 2: Test Detector
  console.log('2. Testing installation detector...');
  const detected = validateInstallation(mock.installDir);
  assert(detected !== null, 'Detector should validate installation directory');
  assert.strictEqual(detected.installDir, mock.installDir);
  assert.strictEqual(detected.hasAsar, true);
  assert.strictEqual(detected.hasBackup, false);
  console.log('   ✔ Path detection and validation passed.');

  // Step 3: Test Backup Creation
  console.log('3. Testing backup manager...');
  const backupRes1 = createBackup(mock.resourcesDir);
  assert.strictEqual(backupRes1.created, true, 'First backup should be created');
  assert(fs.existsSync(backupRes1.backupPath), 'Backup file app.asar.original must exist');

  const verifyRes = verifyBackup(mock.resourcesDir);
  assert.strictEqual(verifyRes.valid, true, 'Backup verification should succeed');

  // Verify that subsequent backup calls DO NOT overwrite the original
  const backupRes2 = createBackup(mock.resourcesDir);
  assert.strictEqual(backupRes2.created, false, 'Subsequent backup call must not overwrite existing backup');
  console.log('   ✔ Backup creation, preservation, and integrity checks passed.');

  // Step 4: Test ASAR Extraction, Patching, and Repacking
  console.log('4. Testing ASAR extraction, patches, and repacking...');
  const tempExtractDir = createTempWorkDir();
  try {
    extractAsar(mock.asarPath, tempExtractDir);
    assert(fs.existsSync(path.join(tempExtractDir, 'package.json')), 'Extracted package.json must exist');
    assert(fs.existsSync(path.join(tempExtractDir, 'out', 'main', 'index.js')), 'Extracted main/index.js must exist');

    // Run Patches
    const patchResults = runPatches(tempExtractDir);
    assert.strictEqual(patchResults.length, 5, 'Should execute 5 registered patches');

    // Check package.json modifications
    const patchedPkg = JSON.parse(fs.readFileSync(path.join(tempExtractDir, 'package.json'), 'utf8'));
    assert.strictEqual(patchedPkg.name, 'better-glorious-core');
    assert.strictEqual(patchedPkg.productName, 'Better Glorious Core');

    // Check main index.js modifications
    const patchedMain = fs.readFileSync(path.join(tempExtractDir, 'out', 'main', 'index.js'), 'utf8');
    assert(patchedMain.includes('Better Glorious Core Mod Loader Hook'), 'Main file should include hook require');
    assert(patchedMain.includes('handleName = "Better Glorious Core"'), 'handleName should be updated');
    assert(patchedMain.includes('setToolTip("Better Glorious Core")'), 'Tray tooltip should be updated');

    // Check Battery Patch Main Process modifications
    assert(patchedMain.includes('padStart(4, "0")'), 'Main file should normalize VID/PID with padStart');
    assert(patchedMain.includes('parseInt(methodData.vid, 16) === rawVid'), 'Main file should include integer comparison in knownDevices');
    assert(patchedMain.includes('((data[0] === 6 && data[1] === 251) || data[0] === 251)'), 'Main file should support stripped Report ID 251');
    assert(patchedMain.includes('_bgcParseBattery'), 'Main file should include 255 charging sentinel helper');
    assert(patchedMain.includes('_bgcOnBatteryUpdate'), 'Main file should dispatch _bgcOnBatteryUpdate event for tray and notifications');
    assert(patchedMain.includes('this.requestBatteryStatsAndUpdateIfSuccessful(device2).catch'), 'Main file should inject immediate battery query on startup');

    // Check Telemetry Blocker Patch modifications
    assert(patchedMain.includes('enabled:false,'), 'Main file should disable Sentry initialization');
    assert(patchedMain.includes('function trackEvent(name, data) {return;'), 'Main file should neutralize telemetry functions');
    assert(patchedMain.includes('BGC_DISABLE_TELEMETRY'), 'Main file should include telemetry blocker signature');

    // Check Auto-Updater Blocker modifications
    assert(patchedMain.includes('disabled by BGC'), 'Main file should neutralize autoUpdater.checkForUpdates');
    assert(patchedMain.includes('autoDownload = false'), 'Main file should disable autoDownload');
    assert(patchedMain.includes('Auto-Updater Locked'), 'Main file should include updater lock guard');

    // Check Battery Patch Renderer modifications
    const patchedRendererJs = fs.readFileSync(path.join(tempExtractDir, 'out', 'renderer-process', 'assets', 'index-sample.js'), 'utf8');
    assert(patchedRendererJs.includes('showValue: true'), 'Renderer bundle should have showValue: true');
    assert(patchedRendererJs.includes('bgc_bat_'), 'Renderer bundle should include persistent battery cache');

    // Check renderer HTML modifications
    const patchedHtml = fs.readFileSync(path.join(tempExtractDir, 'out', 'renderer-process', 'index.html'), 'utf8');
    assert(patchedHtml.includes('<title>Better Glorious Core</title>'), 'HTML title should be updated');

    // Check that mod files are present
    assert(fs.existsSync(path.join(tempExtractDir, 'mod', 'main-hook.js')), 'mod/main-hook.js must be copied');
    assert(fs.existsSync(path.join(tempExtractDir, 'mod', 'renderer-hook.js')), 'mod/renderer-hook.js must be copied');
    assert(fs.existsSync(path.join(tempExtractDir, 'mod', 'theme.css')), 'mod/theme.css must be copied');

    // Repack
    const packResult = await packAsar(tempExtractDir, mock.asarPath);
    assert.strictEqual(packResult.success, true);
    assert(packResult.size > 0, 'Repacked ASAR must have positive size');

    // Verify native unpacked module was extracted according to glob pattern
    const unpackedDir = mock.asarPath + '.unpacked';
    assert(fs.existsSync(unpackedDir), 'app.asar.unpacked directory must be created for native modules');

    console.log('   ✔ ASAR extract, patch, and repack with unpack pattern passed.');
  } finally {
    removeDir(tempExtractDir);
  }

  // Step 5: Test Restorer
  console.log('5. Testing restorer rollback...');
  const restoreResult = restoreStock(mock.resourcesDir, { force: true });
  assert.strictEqual(restoreResult.success, true);

  // Verify that restored app.asar matches original package.json (stock)
  const tempVerifyDir = createTempWorkDir();
  try {
    extractAsar(mock.asarPath, tempVerifyDir);
    const restoredPkg = JSON.parse(fs.readFileSync(path.join(tempVerifyDir, 'package.json'), 'utf8'));
    assert.strictEqual(restoredPkg.name, 'glorious-core', 'Restored package name should be original stock');
    assert.strictEqual(restoredPkg.productName, 'Glorious Core', 'Restored product name should be original stock');
    console.log('   ✔ Restorer successfully rolled back to exact stock state.');
  } finally {
    removeDir(tempVerifyDir);
  }

  // Step 6: Test CLI End-to-End Execution
  console.log('6. Testing CLI end-to-end with flags...');
  const cliPath = path.resolve(__dirname, '..', 'src', 'index.js');

  // Test status flag
  const statusOutput = execSync(`node "${cliPath}" --path "${mock.installDir}" --status`, { encoding: 'utf8' });
  assert(statusOutput.includes('Installation Status:'), 'CLI status output should contain status block');

  // Test patch flag
  const patchOutput = execSync(`node "${cliPath}" --path "${mock.installDir}" --patch -f --skip-process-check`, { encoding: 'utf8' });
  assert(patchOutput.includes('Better Glorious Core has been successfully installed!'), 'CLI patch should succeed');

  // Test restore flag
  const restoreOutput = execSync(`node "${cliPath}" --path "${mock.installDir}" --restore -f --skip-process-check`, { encoding: 'utf8' });
  assert(restoreOutput.includes('Application successfully rolled back to official stock version.'), 'CLI restore should succeed');

  console.log('   ✔ CLI end-to-end execution passed.');

  // Cleanup test environment
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  console.log('\n🎉 ALL TESTS PASSED! Better Glorious Core is rock solid.\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
