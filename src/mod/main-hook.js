/**
 * Better Glorious Core - Main Process Hook
 * Loaded during Electron startup from out/main/index.js
 */
const fs = require('fs');
const path = require('path');

try {
  const electron = require('electron');
  const { app, BrowserWindow } = electron;

  console.log('\x1b[33m[Better Glorious Core]\x1b[0m Main process hook initialized.');

  // Load CSS and Renderer script from adjacent mod directory
  const modDir = __dirname;
  const themePath = path.join(modDir, 'theme.css');
  const rendererHookPath = path.join(modDir, 'renderer-hook.js');

  const themeCss = fs.existsSync(themePath) ? fs.readFileSync(themePath, 'utf8') : '';
  const rendererJs = fs.existsSync(rendererHookPath) ? fs.readFileSync(rendererHookPath, 'utf8') : '';

  /**
   * Injects mod styling and scripts into a target BrowserWindow
   */
  function attachModToWindow(win) {
    if (!win || !win.webContents) return;

    const wc = win.webContents;

    wc.on('dom-ready', () => {
      try {
        if (themeCss) {
          wc.insertCSS(themeCss).catch(() => {});
        }
        if (rendererJs) {
          wc.executeJavaScript(rendererJs).catch(() => {});
        }
      } catch (err) {
        console.error('[Better Glorious Core] Failed injecting into window:', err.message);
      }
    });

    // Optional: support F12 devtools toggle
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
        wc.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  // Attach to any existing windows
  if (BrowserWindow && BrowserWindow.getAllWindows) {
    BrowserWindow.getAllWindows().forEach(attachModToWindow);
  }

  // Hook all future browser windows
  if (app && app.on) {
    app.on('browser-window-created', (event, win) => {
      attachModToWindow(win);
    });
  }
} catch (err) {
  console.error('[Better Glorious Core] Hook initialization error:', err);
}

module.exports = {
  initialized: true
};
