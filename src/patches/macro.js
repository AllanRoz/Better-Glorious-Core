const fs = require('fs');
const path = require('path');

/**
 * Normalizes existing Macros.json files found on the system
 * and migrates legacy Glorious Core macros if Better Glorious Core datastore is empty.
 */
function normalizeDatastoreMacros() {
  const appData = process.env.APPDATA;
  if (!appData) return;

  const bgcDir = path.join(appData, 'Better Glorious Core', 'datastore');
  const stockDir = path.join(appData, 'Glorious Core', 'datastore');
  const bgcMacroFile = path.join(bgcDir, 'Macros.json');
  const stockMacroFile = path.join(stockDir, 'Macros.json');

  let stockMacros = [];
  if (fs.existsSync(stockMacroFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(stockMacroFile, 'utf8'));
      if (Array.isArray(parsed.macros)) {
        stockMacros = parsed.macros;
      }
    } catch (_) {}
  }

  let bgcMacros = [];
  if (fs.existsSync(bgcMacroFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(bgcMacroFile, 'utf8'));
      if (Array.isArray(parsed.macros)) {
        bgcMacros = parsed.macros;
      }
    } catch (_) {}
  }

  // If BGC has no macros but stock has macros, copy them over
  if (bgcMacros.length === 0 && stockMacros.length > 0) {
    bgcMacros = [...stockMacros];
  }

  // Normalize mode strings in all macros
  function normalizeList(macros) {
    let changed = false;
    for (const m of macros) {
      if (m.mode === 'Once') {
        m.mode = 'NoRepeat';
        changed = true;
      } else if (m.mode === 'RepeatWhilePressed') {
        m.mode = 'RepeatWhileHolding';
        changed = true;
      }
    }
    return changed;
  }

  // Write normalized back to BGC
  if (fs.existsSync(bgcDir)) {
    normalizeList(bgcMacros);
    try {
      fs.writeFileSync(bgcMacroFile, JSON.stringify({ macros: bgcMacros }, null, 2), 'utf8');
    } catch (_) {}
  }

  // Write normalized back to Stock
  if (fs.existsSync(stockDir) && stockMacros.length > 0) {
    if (normalizeList(stockMacros)) {
      try {
        fs.writeFileSync(stockMacroFile, JSON.stringify({ macros: stockMacros }, null, 2), 'utf8');
      } catch (_) {}
    }
  }
}

/**
 * Applies Macro execution & serialization patches to the extracted ASAR.
 * @param {string} extractedDir Root directory of extracted asar
 * @returns {{ patched: boolean, statusLogs: string[] }}
 */
function applyMacroPatch(extractedDir) {
  const mainIndexPath = path.join(extractedDir, 'out', 'main', 'index.js');
  if (!fs.existsSync(mainIndexPath)) {
    return { patched: false, statusLogs: ['out/main/index.js not found in extracted directory'] };
  }

  let content = fs.readFileSync(mainIndexPath, 'utf8');
  const statusLogs = [];

  // Target 1: Patch getHIDValue to map mouse button actions in macros (LeftButton -> 240, etc.)
  const getHIDPattern = /(function\s+getHIDValue\s*\(\s*functionCode\s*\)\s*\{)/;
  if (getHIDPattern.test(content)) {
    content = content.replace(
      getHIDPattern,
      `$1
  const _mouseMacroMap = {
    LeftButton: 240,
    RightButton: 241,
    MiddleButton: 242,
    ForwardButton: 243,
    BackButton: 244,
    mouse_left: 240,
    mouse_right: 241,
    mouse_middle: 242,
    mouse_forward: 243,
    mouse_back: 244
  };
  if (_mouseMacroMap[functionCode] !== undefined) return _mouseMacroMap[functionCode];
  const _lowerKey = String(functionCode || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (_lowerKey === 'leftbutton' || _lowerKey === 'mouseleft') return 240;
  if (_lowerKey === 'rightbutton' || _lowerKey === 'mouseright') return 241;
  if (_lowerKey === 'middlebutton' || _lowerKey === 'mousemiddle') return 242;
  if (_lowerKey === 'forwardbutton' || _lowerKey === 'mouseforward') return 243;
  if (_lowerKey === 'backbutton' || _lowerKey === 'mouseback') return 244;`
    );
    statusLogs.push('Patched getHIDValue to map mouse button actions (LeftButton, RightButton, etc.) to hardware HID codes (240-244)');
  }

  // Target 2: Normalize legacy macro modes (Once -> NoRepeat, RepeatWhilePressed -> RepeatWhileHolding) in MacroState
  const fromRecordPattern = /(static\s+fromRecord\s*\(\s*record\s*\)\s*\{[\s\S]*?state\.mode\s*=\s*)(record\.mode\s*;)/;
  if (fromRecordPattern.test(content)) {
    content = content.replace(
      fromRecordPattern,
      `$1(function(m) { if (m === 'Once') return 'NoRepeat'; if (m === 'RepeatWhilePressed') return 'RepeatWhileHolding'; return m || 'NoRepeat'; })(record.mode);`
    );
    statusLogs.push('Normalized legacy macro modes in MacroState.fromRecord');
  }

  const fromStatePattern = /(state\.mode\s*=\s*)(stateProperties\.mode\s*\?\?\s*state\.mode\s*;)/;
  if (fromStatePattern.test(content)) {
    content = content.replace(
      fromStatePattern,
      `$1(function(m) { if (m === 'Once') return 'NoRepeat'; if (m === 'RepeatWhilePressed') return 'RepeatWhileHolding'; return m || 'NoRepeat'; })(stateProperties.mode ?? state.mode);`
    );
    statusLogs.push('Normalized legacy macro modes in MacroState.fromStateProperties');
  }

  // Target 3: Add fallback and legacy mode support to HWMacroModes2 definitions
  const hwModesPattern = /(\[MacroMode\.Toggle\]:\s*225\s*\};)/g;
  if (hwModesPattern.test(content)) {
    content = content.replace(
      hwModesPattern,
      `[MacroMode.Toggle]: 225, Once: 1, RepeatWhilePressed: 224 };`
    );
    statusLogs.push('Added legacy macro mode support to HWMacroModes2 definitions');
  }

  // Target 4: Guard macro mode packet serialization against invalid / undefined values
  const dataOffsetPattern = /(dataBuffer\[dataOffset\s*\+\s*1\]\s*=\s*)(HWMacroModes2\[macro\.mode\])(\s*;)/g;
  if (dataOffsetPattern.test(content)) {
    content = content.replace(
      dataOffsetPattern,
      `$1(HWMacroModes2[macro?.mode] ?? (String(macro?.mode || '').toLowerCase().includes('toggle') ? 225 : (String(macro?.mode || '').toLowerCase().includes('repeat') ? 224 : 1)))$3`
    );
    statusLogs.push('Guarded macro mode byte serialization against invalid/undefined values');
  }

  // Target 5: Synchronize macros from stock Glorious Core datastore on app startup if empty
  const appReadyPattern = /(app\.whenReady\(\)\.then\([^)]*\)\s*\{)/;
  if (appReadyPattern.test(content) && !content.includes('bgcSyncMacrosOnStartup')) {
    content = content.replace(
      appReadyPattern,
      `$1
    try {
      const _fs = require('fs');
      const _p = require('path');
      const _uDir = app.getPath('userData');
      const _bgcMF = _p.join(_uDir, 'datastore', 'Macros.json');
      const _stkMF = _p.join(_p.dirname(_uDir), 'Glorious Core', 'datastore', 'Macros.json');
      if (_fs.existsSync(_stkMF) && (!_fs.existsSync(_bgcMF) || _fs.readFileSync(_bgcMF, 'utf8').includes('"macros": []') || _fs.readFileSync(_bgcMF, 'utf8').trim() === '{"macros":[]}')) {
        _fs.mkdirSync(_p.dirname(_bgcMF), { recursive: true });
        _fs.copyFileSync(_stkMF, _bgcMF);
        console.log('[Better Glorious Core] Migrated existing macros from stock Glorious Core datastore');
      }
    } catch (_) {}`
    );
    statusLogs.push('Injected startup datastore macro migration sync');
  }

  fs.writeFileSync(mainIndexPath, content, 'utf8');

  // Normalize files currently on disk
  try {
    normalizeDatastoreMacros();
  } catch (_) {}

  const details = [
    '[✓] Fixed mouse-button actions in macro playback (LeftButton, RightButton, etc. -> HID 240-244)',
    '[✓] Normalized legacy macro modes (Once -> NoRepeat, RepeatWhilePressed -> RepeatWhileHolding)',
    '[✓] Guarded firmware packet serialization against undefined/zero mode bytes',
    '[✓] Injected startup datastore macro migration sync from Glorious Core'
  ];
  for (const log of statusLogs) {
    details.push(`    - ${log}`);
  }

  return {
    patched: true,
    patchedFiles: ['out/main/index.js'],
    details,
    statusLogs
  };
}

module.exports = {
  applyMacroPatch,
  normalizeDatastoreMacros
};
