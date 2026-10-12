'use strict';

const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const dbPath = path.join(root, 'lib', 'db.js');
const loggerPath = path.join(root, 'lib', 'logger.js');

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    async query(sql, params) {
      process.stderr.write(`FAKE_SHARED_POOL_QUERY ${JSON.stringify({ sql: String(sql).trim(), params })}\n`);
      return { rows: [] };
    },
  },
};

const logger = {
  debug() {},
  error() {},
  info() {},
  warn() {},
  child() { return logger; },
};

require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: logger,
};
