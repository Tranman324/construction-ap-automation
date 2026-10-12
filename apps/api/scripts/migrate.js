#!/usr/bin/env node
'use strict';

const path = require('node:path');

const {
  applyPendingMigrations,
  assertConfirmedForLiveMutation,
  createPool,
  getTargetInfo,
  listMigrationFiles,
  loadEnvFile,
  markMigrationsApplied,
} = require('../lib/migrations');

const ROOT_DIR = path.resolve(__dirname, '..');
const COMMANDS = new Set(['list', 'apply', 'mark-applied', 'help']);

function parseArgs(argv) {
  const args = [...argv];
  let command = 'list';

  if (args[0] && !args[0].startsWith('-')) {
    command = args.shift();
  }

  const options = {
    all: false,
    confirmTarget: false,
    filenames: [],
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      command = 'help';
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--confirm-target') {
      options.confirmTarget = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.filenames.push(arg);
    }
  }

  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown migration command: ${command}`);
  }

  return { command, options };
}

function printUsage(log = console.log) {
  log(`Usage:
  npm run migrate
  npm run migrate -- list
  npm run migrate -- apply --confirm-target
  npm run migrate -- mark-applied --all --confirm-target
  npm run migrate -- mark-applied <migration.sql> [migration.sql ...] --confirm-target

Commands:
  list          List migration files in lexical order with rerun safety classification. This does not connect to the database.
  apply         Create schema_migrations if needed, apply safe pending migrations, and skip tracked migrations.
  mark-applied  Create schema_migrations if needed and record selected migration filenames without running their SQL.

Safety:
  apply and mark-applied require --confirm-target when SUPABASE_DB_URL is configured.
  Never paste or print database URLs, passwords, service-role keys, or tokens.`);
}

function printTargetFacts(target, log = console.log) {
  log('Migration target:');
  log(`  mode: ${target.mode}`);
  log(`  source: ${target.source}`);
  log(`  host: ${target.host}`);
  log(`  port: ${target.port}`);
  log(`  database: ${target.database}`);
  log(`  user: ${target.user || '(empty)'}`);
  log(`  ssl: ${target.ssl ? 'enabled' : 'default'}`);
}

function printMigrationList(migrations, log = console.log) {
  log('Migration files:');
  for (const migration of migrations) {
    log(`  ${migration.filename}`);
    log(`    classification: ${migration.safety.classification}`);
    log(`    reason: ${migration.safety.reasons.join('; ')}`);
  }
}

async function run(argv = process.argv.slice(2), env = process.env, log = console.log, errorLog = console.error) {
  loadEnvFile(env, ROOT_DIR);

  const { command, options } = parseArgs(argv);
  if (command === 'help') {
    printUsage(log);
    return { command, status: 'help' };
  }

  const target = getTargetInfo(env);
  printTargetFacts(target, log);

  const migrations = listMigrationFiles();

  if (command === 'list') {
    printMigrationList(migrations, log);
    return { command, status: 'listed', migrations };
  }

  assertConfirmedForLiveMutation(command, target, options);

  const pool = createPool(env);
  try {
    if (command === 'apply') {
      const plan = await applyPendingMigrations(pool, migrations, log);
      log(`Migration summary: ${plan.applicable.length} applied, ${plan.skipped.length} skipped`);
      return { command, status: 'applied', plan };
    }

    const selection = options.all ? ['--all'] : options.filenames;
    const marked = await markMigrationsApplied(pool, migrations, selection, log);
    log(`Migration summary: ${marked.length} marked as applied`);
    return { command, status: 'marked', marked };
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  printMigrationList,
  printTargetFacts,
  printUsage,
  run,
};
