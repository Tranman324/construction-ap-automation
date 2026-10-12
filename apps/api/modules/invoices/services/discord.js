'use strict';
/**
 * Discord notification helper
 * Wraps chat-notify send for the accounting channel.
 */

const { spawn } = require('child_process');
const { DISCORD_CHANNEL_ACCOUNTING } = require('../../../config');
const logger = require('../../../lib/logger');

/**
 * Send a message to the NCG accounting Discord channel.
 * Fire-and-forget — errors are logged but not thrown.
 *
 * @param {string} message - Text to send
 * @returns {Promise<void>}
 */
async function notifyAccounting(message) {
  return new Promise((resolve) => {
    try {
      const child = spawn('chat-notify', ['message', 'send', '--channel', DISCORD_CHANNEL_ACCOUNTING, message], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      resolve();
    } catch (err) {
      logger.error({ err }, 'Failed to send Discord notification');
      resolve();
    }
  });
}

module.exports = { notifyAccounting };
