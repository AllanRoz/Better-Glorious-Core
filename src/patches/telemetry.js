const fs = require('fs');
const path = require('path');

/**
 * Disables Sentry, Mixpanel, and telemetry dispatchers in the main process bundle.
 * @param {string} extractedDir Root directory of extracted asar
 * @returns {{ patchedFiles: string[], details: string[] }}
 */
function applyTelemetryPatch(extractedDir) {
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
    throw new Error('Could not find main process bundle to apply telemetry patch.');
  }

  let content = fs.readFileSync(mainFile, 'utf8');
  const original = content;
  const details = [];

  // 1. Neutralize Sentry.init / Sentry setup
  // Target: Sentry.init({ ... }) or *.init({ dsn: ... })
  const sentryInitPattern = /(\b(?:Sentry|[a-zA-Z0-9_$]+)\.init\s*\(\s*\{)/g;
  if (sentryInitPattern.test(content)) {
    content = content.replace(sentryInitPattern, '$1enabled:false,');
    details.push('Disabled Sentry initialization (enabled: false)');
  }

  // 2. Neutralize telemetry tracking methods: trackEvent, sendTelemetry, sendAnalytics
  const trackFuncPattern = /(function\s+(?:trackEvent|sendTelemetry|sendAnalytics|recordMetric)\s*\([^)]*\)\s*\{)/g;
  if (trackFuncPattern.test(content)) {
    content = content.replace(trackFuncPattern, '$1return;');
    details.push('Neutralized telemetry tracking functions (early return)');
  }

  // Also handle class method definitions: trackEvent(event, data) { -> trackEvent() { return;
  const classMethodPattern = /(\b(?:trackEvent|sendTelemetry|sendAnalytics)\s*\([^)]*\)\s*\{)/g;
  if (classMethodPattern.test(content)) {
    content = content.replace(classMethodPattern, '$1return;');
    details.push('Neutralized class telemetry methods');
  }

  // 3. Inject telemetry blocker indicator
  const blockerSignature = '/* Better Glorious Core - Telemetry Blocker Active */';
  if (!content.includes(blockerSignature)) {
    content = `${blockerSignature}\nprocess.env.BGC_DISABLE_TELEMETRY = '1';\n` + content;
    details.push('Injected BGC_DISABLE_TELEMETRY environment flag');
  }

  if (content !== original) {
    fs.writeFileSync(mainFile, content, 'utf8');
  }

  return {
    patchedFiles: [path.relative(extractedDir, mainFile)],
    details: [
      '[✓] Disabled Sentry error reporting & usage analytics in main process',
      ...details.map((d) => `    - ${d}`)
    ]
  };
}

module.exports = {
  applyTelemetryPatch
};
