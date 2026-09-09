#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const ora = require('ora');
const prompts = require('prompts');
const { Command } = require('commander');

const { findGloriousCore, validateInstallation, savePath } = require('./detector');
const { getRunningProcesses, isAppRunning, killRunningProcesses } = require('./process');
const { createBackup, hasBackup } = require('./backup');
const { restoreStock } = require('./restorer');
const { createTempWorkDir, removeDir, extractAsar, packAsar, DEFAULT_UNPACK_PATTERN } = require('./asar');
const { runPatches } = require('./patches');

const pkg = require('../package.json');

function printBanner() {
  console.log(chalk.bold.yellow(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║                                                               ║
  ║     ⚡  B E T T E R   G L O R I O U S   C O R E  ⚡           ║
  ║        Open-Source Mod & Automated Patcher v${pkg.version.padEnd(16)}║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝
  `));
}

/**
 * Ensures Glorious Core is closed before touching files.
 */
async function handleRunningProcesses(forceKill = false, nonInteractive = false) {
  if (!isAppRunning()) return true;

  const running = getRunningProcesses();
  console.log(chalk.yellow(`\n⚠️  Glorious Core is currently running (${running.join(', ')}).`));

  if (forceKill) {
    const killed = killRunningProcesses();
    if (killed) {
      console.log(chalk.green('✔ Terminated running Glorious Core processes.'));
      return true;
    }
  }

  if (nonInteractive) {
    throw new Error('Glorious Core is running. Please close the app or use --kill to terminate.');
  }

  const response = await prompts({
    type: 'confirm',
    name: 'kill',
    message: 'Would you like Better Glorious Core to close running processes automatically?',
    initial: true
  });

  if (response.kill) {
    const killed = killRunningProcesses();
    if (killed) {
      console.log(chalk.green('✔ Terminated running Glorious Core processes.'));
      return true;
    }
    throw new Error('Failed to close running processes. Please exit Glorious Core manually.');
  } else {
    throw new Error('Aborted: Please close Glorious Core before proceeding.');
  }
}

/**
 * Resolves the Glorious Core installation target.
 */
async function resolveInstallTarget(customPath, nonInteractive = false) {
  let target = findGloriousCore(customPath);

  if (target) {
    return target;
  }

  if (nonInteractive) {
    throw new Error(
      'Glorious Core installation could not be automatically detected. Please specify path with --path "<dir>"'
    );
  }

  console.log(chalk.yellow('\nCould not automatically locate Glorious Core in standard paths or registry.'));

  const response = await prompts({
    type: 'text',
    name: 'customDir',
    message: 'Enter the path to your Glorious Core installation folder:',
    validate: (val) => {
      const v = validateInstallation(val);
      return v ? true : 'Invalid directory: resources/app.asar not found here.';
    }
  });

  if (!response.customDir) {
    throw new Error('Operation cancelled: No path provided.');
  }

  target = validateInstallation(response.customDir);
  if (target) {
    savePath(target.installDir);
  }
  return target;
}

/**
 * Executes the patching pipeline.
 */
async function runPatchFlow(target, options = {}) {
  if (!options.skipProcessCheck) {
    await handleRunningProcesses(options.kill, options.force);
  }

  console.log(chalk.cyan(`\n📁 Target Directory: ${chalk.bold(target.installDir)}`));

  const spinner = ora();

  // 1. Create backup of stock app.asar if not already existing
  spinner.start('Creating pristine backup (app.asar.original)...');
  const backupResult = createBackup(target.resourcesDir);
  if (backupResult.created) {
    spinner.succeed(chalk.green(`Stock backup created at: ${path.basename(backupResult.backupPath)} (${(backupResult.size / (1024 * 1024)).toFixed(2)} MB)`));
  } else {
    spinner.info(chalk.blue(backupResult.message));
  }

  // 2. Select source asar: prefer app.asar.original to always patch from clean stock files
  const sourceAsar = hasBackup(target.resourcesDir)
    ? target.backupPath
    : target.asarPath;

  const tempDir = createTempWorkDir();

  try {
    // 3. Extract asar
    spinner.start('Extracting ASAR archive into temporary workspace...');
    extractAsar(sourceAsar, tempDir);
    spinner.succeed('ASAR archive extracted successfully.');

    // 4. Apply Patches
    spinner.start('Applying patches (branding, mod loader, battery telemetry fix)...');
    const patchResults = runPatches(tempDir);
    spinner.succeed('Patches applied successfully:');
    for (const p of patchResults) {
      console.log(chalk.green(`   ✔ ${p.name}`));
      if (p.result && Array.isArray(p.result.details)) {
        for (const d of p.result.details) {
          console.log(chalk.gray(`     ${d}`));
        }
      }
    }

    // 5. Repack asar with unpack glob pattern
    const unpackPattern = options.unpack || DEFAULT_UNPACK_PATTERN;
    spinner.start(`Repacking ASAR with unpack pattern "${unpackPattern}"...`);
    const packResult = await packAsar(tempDir, target.asarPath, { unpack: unpackPattern });
    spinner.succeed(chalk.green(`Repacked app.asar successfully (${(packResult.size / (1024 * 1024)).toFixed(2)} MB).`));

    console.log(chalk.bold.green('\n🎉 Better Glorious Core has been successfully installed!\n'));
    console.log(chalk.white('You can now launch Glorious Core and enjoy the enhanced modded experience.'));
    console.log(chalk.gray(`To revert at any time, run: npm run restore (or better-glorious-core --restore)\n`));
  } finally {
    // Cleanup temporary workspace
    removeDir(tempDir);
  }
}

/**
 * Executes the restore pipeline.
 */
async function runRestoreFlow(target, options = {}) {
  if (!options.skipProcessCheck) {
    await handleRunningProcesses(options.kill, options.force);
  }

  console.log(chalk.cyan(`\n📁 Target Directory: ${chalk.bold(target.installDir)}`));

  const spinner = ora('Restoring stock Glorious Core from original backup...').start();
  try {
    const result = restoreStock(target.resourcesDir, { force: options.force });
    spinner.succeed(chalk.green(result.message));
    console.log(chalk.bold.green('\n✔ Application successfully rolled back to official stock version.\n'));
  } catch (err) {
    spinner.fail(chalk.red(`Restore failed: ${err.message}`));
    throw err;
  }
}

/**
 * Prints current installation & patch status.
 */
function printStatus(target) {
  console.log(chalk.bold.cyan('\n🔍 Installation Status:'));
  console.log(`   Install Dir:   ${target.installDir}`);
  console.log(`   Resources Dir: ${target.resourcesDir}`);
  console.log(`   app.asar:      ${fs.existsSync(target.asarPath) ? chalk.green('Present') : chalk.red('Missing')}`);
  console.log(`   Backup:        ${hasBackup(target.resourcesDir) ? chalk.green('Present (app.asar.original)') : chalk.yellow('None (Stock state)')}`);
  console.log(`   Current State: ${hasBackup(target.resourcesDir) ? chalk.yellow('Modified / Patched') : chalk.blue('Stock (Unpatched)')}`);
  console.log();
}

/**
 * Interactive menu when no flags are supplied.
 */
async function runInteractiveMenu(initialTarget, options) {
  let target = initialTarget;

  while (true) {
    printStatus(target);

    const isPatched = hasBackup(target.resourcesDir);

    const choices = [
      {
        title: isPatched ? '⚡ Re-apply / Update Patches' : '⚡ Patch Glorious Core (Install Mod)',
        value: 'patch'
      }
    ];

    if (isPatched) {
      choices.push({
        title: '🔄 Restore Stock Glorious Core (Uninstall Mod)',
        value: 'restore'
      });
    }

    choices.push(
      { title: '📁 Select Different Glorious Core Path', value: 'change_path' },
      { title: '❌ Exit', value: 'exit' }
    );

    const response = await prompts({
      type: 'select',
      name: 'action',
      message: 'Select an action:',
      choices
    });

    if (!response.action || response.action === 'exit') {
      console.log(chalk.gray('\nGoodbye!\n'));
      break;
    }

    if (response.action === 'patch') {
      await runPatchFlow(target, options);
      break;
    } else if (response.action === 'restore') {
      await runRestoreFlow(target, options);
      break;
    } else if (response.action === 'change_path') {
      const pathPrompt = await prompts({
        type: 'text',
        name: 'dir',
        message: 'Enter path to Glorious Core directory:'
      });
      if (pathPrompt.dir) {
        const validated = validateInstallation(pathPrompt.dir);
        if (validated) {
          target = validated;
          savePath(target.installDir);
          console.log(chalk.green('✔ Target directory updated.'));
        } else {
          console.log(chalk.red('✖ Invalid directory: resources/app.asar not found.'));
        }
      }
    }
  }
}

async function main() {
  const program = new Command();

  program
    .name('better-glorious-core')
    .description('Automated patcher and mod injector for Glorious Core v2.x')
    .version(pkg.version)
    .option('-p, --patch', 'Patch Glorious Core with Better Glorious Core mod')
    .option('-r, --restore', 'Restore original stock Glorious Core from backup')
    .option('-s, --status', 'Show installation and patch status')
    .option('--path <path>', 'Specify custom Glorious Core installation directory')
    .option('-f, --force', 'Skip confirmation prompts')
    .option('--kill', 'Automatically terminate running Glorious Core processes')
    .option('--skip-process-check', 'Bypass process check (for tests or headless runs)')
    .option('--unpack <pattern>', 'Custom unpack glob pattern for asar repacking');

  program.parse(process.argv);
  const options = program.opts();

  printBanner();

  const isNonInteractive = options.patch || options.restore || options.status;
  const target = await resolveInstallTarget(options.path, isNonInteractive);

  if (options.status) {
    printStatus(target);
    return;
  }

  if (options.patch) {
    await runPatchFlow(target, options);
    return;
  }

  if (options.restore) {
    await runRestoreFlow(target, options);
    return;
  }

  // Fallback to interactive menu
  await runInteractiveMenu(target, options);
}

main().catch((err) => {
  console.error(chalk.red(`\n✖ Error: ${err.message}\n`));
  process.exit(1);
});
