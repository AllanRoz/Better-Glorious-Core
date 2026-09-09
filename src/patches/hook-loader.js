const fs = require('fs');
const path = require('path');
const { copyDirSync } = require('../asar');

const HOOK_SIGNATURE = '/* Better Glorious Core Mod Loader Hook */';

/**
 * Copies the mod files into the extracted asar and injects require statement into main bundle.
 * @param {string} extractedDir Root directory of extracted asar
 * @param {string} [sourceModDir] Path to the patcher's src/mod directory
 * @returns {{ success: boolean, injectedInto: string[], details: string[] }}
 */
function injectHookLoader(extractedDir, sourceModDir) {
  const details = [];
  const injectedInto = [];

  const modSource = sourceModDir || path.resolve(__dirname, '..', 'mod');
  if (!fs.existsSync(modSource)) {
    throw new Error(`Cannot inject hook: Mod directory not found at "${modSource}"`);
  }

  // 1. Copy mod directory to both `<extracted>/mod` and `<extracted>/out/mod` for robust path resolution
  const targetModDirs = [
    path.join(extractedDir, 'mod'),
    path.join(extractedDir, 'out', 'mod')
  ];

  for (const tDir of targetModDirs) {
    copyDirSync(modSource, tDir);
    details.push(`Copied mod runtime to ${path.relative(extractedDir, tDir)}`);
  }

  // 2. Identify main entry point
  let mainFileCandidates = [];

  const pkgJsonPath = path.join(extractedDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.main) {
        mainFileCandidates.push(path.resolve(extractedDir, pkg.main));
      }
    } catch {
      // Ignore JSON parse error
    }
  }

  // Common fallbacks
  mainFileCandidates.push(
    path.join(extractedDir, 'out', 'main', 'index.js'),
    path.join(extractedDir, 'out', 'main.js'),
    path.join(extractedDir, 'dist', 'main', 'index.js')
  );

  // De-duplicate
  mainFileCandidates = Array.from(new Set(mainFileCandidates));

  let injected = false;
  for (const mainPath of mainFileCandidates) {
    if (fs.existsSync(mainPath)) {
      const content = fs.readFileSync(mainPath, 'utf8');

      if (content.includes(HOOK_SIGNATURE)) {
        details.push(`Hook already present in ${path.relative(extractedDir, mainPath)}`);
        injected = true;
        injectedInto.push(path.relative(extractedDir, mainPath));
        continue;
      }

      // Compute relative path from main file to mod/main-hook.js
      const targetHook = path.join(extractedDir, 'mod', 'main-hook.js');
      let relPath = path.relative(path.dirname(mainPath), targetHook).replace(/\\/g, '/');
      if (!relPath.startsWith('.')) {
        relPath = './' + relPath;
      }

      const hookCode = `${HOOK_SIGNATURE}\ntry { require('${relPath}'); } catch (e) { console.error('[BGC Hook Error]', e); }\n`;

      const newContent = hookCode + content;
      fs.writeFileSync(mainPath, newContent, 'utf8');

      const rel = path.relative(extractedDir, mainPath);
      injectedInto.push(rel);
      details.push(`Injected mod loader require into ${rel}`);
      injected = true;
    }
  }

  if (!injected) {
    throw new Error('Could not locate any valid main entry file to inject hook into.');
  }

  return {
    success: true,
    injectedInto,
    details
  };
}

module.exports = {
  HOOK_SIGNATURE,
  injectHookLoader
};
