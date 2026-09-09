const fs = require('fs');
const path = require('path');
const os = require('os');
const asar = require('@electron/asar');

const DEFAULT_UNPACK_PATTERN = '{*.node,*@koromix*,*jszip*,*keytar*}';

/**
 * Creates a unique temporary directory for asar extraction & patching.
 * @returns {string}
 */
function createTempWorkDir() {
  const prefix = path.join(os.tmpdir(), 'better-glorious-core-');
  return fs.mkdtempSync(prefix);
}

/**
 * Safely removes a directory and its contents.
 * @param {string} dirPath
 */
function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Recursively copies a directory.
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Extracts an asar archive into the destination directory.
 * @param {string} asarPath Path to app.asar or app.asar.original
 * @param {string} destDir Destination directory
 */
function extractAsar(asarPath, destDir) {
  if (!fs.existsSync(asarPath)) {
    throw new Error(`Cannot extract asar: "${asarPath}" does not exist.`);
  }

  const targetUnpacked = asarPath + '.unpacked';
  const altUnpacked = path.join(path.dirname(asarPath), 'app.asar.unpacked');

  // If extracting from app.asar.original but its .unpacked folder isn't there, check app.asar.unpacked
  if (!fs.existsSync(targetUnpacked) && fs.existsSync(altUnpacked)) {
    try {
      fs.cpSync(altUnpacked, targetUnpacked, { recursive: true });
    } catch {
      // Fallback if copy fails
    }
  }

  fs.mkdirSync(destDir, { recursive: true });
  asar.extractAll(asarPath, destDir);

  // Merge unpacked companion files into extracted directory if present
  if (fs.existsSync(targetUnpacked)) {
    copyDirSync(targetUnpacked, destDir);
  } else if (fs.existsSync(altUnpacked)) {
    copyDirSync(altUnpacked, destDir);
  }
}

/**
 * Packs a directory back into an asar archive with proper unpack patterns.
 * Writes to a temporary archive first to prevent corrupting target on failure.
 * @param {string} sourceDir Directory containing modified files
 * @param {string} destAsarPath Destination app.asar path
 * @param {object} [options]
 * @param {string} [options.unpack] Glob pattern for files to unpack
 */
async function packAsar(sourceDir, destAsarPath, options = {}) {
  const unpackPattern = options.unpack || DEFAULT_UNPACK_PATTERN;
  const tempAsarPath = destAsarPath + '.new';
  const tempUnpackedPath = tempAsarPath + '.unpacked';
  const destUnpackedPath = destAsarPath + '.unpacked';

  // Clean up any stale temp files
  if (fs.existsSync(tempAsarPath)) fs.unlinkSync(tempAsarPath);
  if (fs.existsSync(tempUnpackedPath)) removeDir(tempUnpackedPath);

  try {
    // Repack with asar
    await asar.createPackageWithOptions(sourceDir, tempAsarPath, {
      unpack: unpackPattern
    });

    // Verify created asar exists and has size
    const stats = fs.statSync(tempAsarPath);
    if (stats.size === 0) {
      throw new Error('Repacking failed: Output archive is 0 bytes.');
    }

    // Replace app.asar
    if (fs.existsSync(destAsarPath)) {
      fs.unlinkSync(destAsarPath);
    }
    fs.renameSync(tempAsarPath, destAsarPath);

    // If unpacked folder was created, move it to app.asar.unpacked
    if (fs.existsSync(tempUnpackedPath)) {
      if (fs.existsSync(destUnpackedPath)) {
        removeDir(destUnpackedPath);
      }
      fs.renameSync(tempUnpackedPath, destUnpackedPath);
    }

    return {
      success: true,
      asarPath: destAsarPath,
      size: stats.size
    };
  } catch (err) {
    // Cleanup temporary files on failure
    if (fs.existsSync(tempAsarPath)) fs.unlinkSync(tempAsarPath);
    if (fs.existsSync(tempUnpackedPath)) removeDir(tempUnpackedPath);
    throw err;
  }
}

module.exports = {
  DEFAULT_UNPACK_PATTERN,
  createTempWorkDir,
  removeDir,
  copyDirSync,
  extractAsar,
  packAsar
};
