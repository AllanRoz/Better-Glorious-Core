const { execSync } = require('child_process');

const PROCESS_NAMES = [
  'Glorious Core.exe',
  'GloriousCore.exe',
  'glorious-core.exe',
  'Better Glorious Core.exe'
];

/**
 * Checks which Glorious Core processes are currently running on the system.
 * Returns an array of matched process names.
 */
function getRunningProcesses() {
  if (process.platform !== 'win32') {
    return [];
  }

  try {
    const output = execSync('tasklist /fo csv /nh', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = output.split(/\r?\n/);
    const running = new Set();

    for (const line of lines) {
      if (!line.trim()) continue;
      // CSV format: "Image Name","PID","Session Name","Session#","Mem Usage"
      const match = line.match(/^"([^"]+)"/);
      if (match) {
        const procName = match[1];
        for (const target of PROCESS_NAMES) {
          if (procName.toLowerCase() === target.toLowerCase()) {
            running.add(procName);
          }
        }
      }
    }

    return Array.from(running);
  } catch {
    return [];
  }
}

/**
 * Checks if any Glorious Core process is running.
 */
function isAppRunning() {
  return getRunningProcesses().length > 0;
}

/**
 * Attempts to terminate running Glorious Core processes.
 */
function killRunningProcesses() {
  if (process.platform !== 'win32') return false;

  const running = getRunningProcesses();
  if (running.length === 0) return true;

  for (const proc of running) {
    try {
      execSync(`taskkill /F /IM "${proc}"`, { stdio: 'ignore' });
    } catch {
      // Ignore failures
    }
  }

  return !isAppRunning();
}

module.exports = {
  PROCESS_NAMES,
  getRunningProcesses,
  isAppRunning,
  killRunningProcesses
};
