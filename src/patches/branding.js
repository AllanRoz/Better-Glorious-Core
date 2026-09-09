const fs = require('fs');
const path = require('path');

const BRAND_NAME = 'Better Glorious Core';
const BRAND_PKG_NAME = 'better-glorious-core';

/**
 * Applies branding patches to package.json, main process bundles, and renderer HTML.
 * @param {string} extractedDir Root directory of extracted asar
 * @returns {{ patchedFiles: string[], details: string[] }}
 */
function applyBranding(extractedDir) {
  const patchedFiles = [];
  const details = [];

  // 1. Patch package.json inside asar
  const pkgJsonPath = path.join(extractedDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const oldName = pkg.name;
      const oldProdName = pkg.productName;

      pkg.name = BRAND_PKG_NAME;
      pkg.productName = BRAND_NAME;
      if (pkg.description) {
        pkg.description = `${BRAND_NAME} - Enhanced Electron Experience`;
      }

      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2), 'utf8');
      patchedFiles.push('package.json');
      details.push(`Updated package.json (name: "${oldName}" -> "${BRAND_PKG_NAME}", productName: "${oldProdName}" -> "${BRAND_NAME}")`);
    } catch (err) {
      details.push(`Warning: Failed to update package.json: ${err.message}`);
    }
  }

  // 2. Patch out/main/index.js (and find potential alternate main entry)
  const candidateMainFiles = [
    path.join(extractedDir, 'out', 'main', 'index.js'),
    path.join(extractedDir, 'out', 'main.js'),
    path.join(extractedDir, 'dist', 'main', 'index.js'),
    path.join(extractedDir, 'main.js')
  ];

  let mainPatched = false;
  for (const mainPath of candidateMainFiles) {
    if (fs.existsSync(mainPath)) {
      let content = fs.readFileSync(mainPath, 'utf8');
      const original = content;

      // Update handleName (IPC named pipe / mutex) to avoid collision with stock app
      content = content.replace(
        /(handleName\s*[:=]\s*)(["'])Glorious Core\2/g,
        `$1$2${BRAND_NAME}$2`
      );

      // Update productName and name definitions
      content = content.replace(
        /(productName\s*[:=]\s*)(["'])Glorious Core\2/g,
        `$1$2${BRAND_NAME}$2`
      );
      content = content.replace(
        /(\bname\s*:\s*)(["'])Glorious Core\2/g,
        `$1$2${BRAND_NAME}$2`
      );

      // Update system tray tooltips, window titles, and context menus
      content = content.replace(
        /(setToolTip\s*\(\s*)(["'])Glorious Core\2/g,
        `$1$2${BRAND_NAME}$2`
      );
      content = content.replace(
        /(title\s*[:=]\s*)(["'])Glorious Core\2/g,
        `$1$2${BRAND_NAME}$2`
      );

      // Replace generic "Glorious Core" in tray menu label if present
      content = content.replace(
        /(label\s*:\s*)(["'])Glorious Core\2/g,
        `$1$2${BRAND_NAME}$2`
      );

      if (content !== original) {
        fs.writeFileSync(mainPath, content, 'utf8');
        const rel = path.relative(extractedDir, mainPath);
        patchedFiles.push(rel);
        details.push(`Updated branding & IPC handleName in ${rel}`);
        mainPatched = true;
      }
    }
  }

  if (!mainPatched) {
    details.push('Notice: No Glorious Core branding strings matched in main bundle (may already be patched or use different identifiers).');
  }

  // 3. Patch HTML files in renderer directories (<title> tags)
  const htmlCandidates = [
    path.join(extractedDir, 'out', 'renderer-process', 'index.html'),
    path.join(extractedDir, 'out', 'renderer', 'index.html'),
    path.join(extractedDir, 'index.html')
  ];

  for (const htmlPath of htmlCandidates) {
    if (fs.existsSync(htmlPath)) {
      let html = fs.readFileSync(htmlPath, 'utf8');
      const original = html;

      // Replace <title>Glorious Core...</title>
      html = html.replace(/<title>.*?Glorious Core.*?<\/title>/gi, `<title>${BRAND_NAME}</title>`);
      // If title didn't mention Glorious Core, replace whatever title exists
      if (!html.includes(`<title>${BRAND_NAME}</title>`)) {
        html = html.replace(/<title>.*?<\/title>/i, `<title>${BRAND_NAME}</title>`);
      }

      if (html !== original) {
        fs.writeFileSync(htmlPath, html, 'utf8');
        const rel = path.relative(extractedDir, htmlPath);
        patchedFiles.push(rel);
        details.push(`Updated <title> in ${rel}`);
      }
    }
  }

  return {
    patchedFiles,
    details
  };
}

module.exports = {
  BRAND_NAME,
  BRAND_PKG_NAME,
  applyBranding
};
