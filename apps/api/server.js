#!/usr/bin/env node
/**
 * Toolbox API — Backend Server
 * Slim entry point: creates Express app, mounts module routes, starts listening.
 *
 * Modules:
 *   - invoices  → /api/invoices, /api/vendors, /api/jobs, /api/subcontracts,
 *                  /api/rules, /api/pipeline, /api/ignore-rules, /api/feedback,
 *                  /api/lien-waivers, /api/users, /api/splits, /api/settings/*
 *   - feature-requests → /api/feature-requests
 *   - (future) projects, estimates
 */

'use strict';

// Load .env if present (systemd uses EnvironmentFile instead)
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { API_PORT: PORT } = require('./config');
const logger = require('./lib/logger');
const { initSentry } = require('./lib/sentry');
const { requireAuth } = require('./middleware/auth');
const { fail, safeError } = require('./middleware/errorResponse');
const { healthLimiter, methodLimiter, pipelineLimiter } = require('./middleware/rateLimiter');
const requestLogger = require('./middleware/requestLogger');
const responseFinalizer = require('./middleware/responseFinalizer');
const { recoverStaleSubmittingInvoices } = require('./modules/invoices/services/submitRecovery');
const { recoverStuckSplitChildren } = require('./modules/invoices/services/splitService');

const app = express();
// Caddy is the single trusted reverse-proxy hop in front of this service.
app.set('trust proxy', 1);
if (initSentry()) {
  logger.info({ operation: 'sentry.init', context: {} }, 'Sentry initialized');
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://toolbox.northwindcg.example']
    : ['https://toolbox.northwindcg.example', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-internal-secret',
    'x-user-email',
    'x-user-id',
    'x-user-role',
    'x-user-permissions',
  ],
  maxAge: 600,
}));
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);
app.use(responseFinalizer);

// ─── Public routes (no auth) ──────────────────────────────────────────────────
app.use('/api/health', healthLimiter, require('./modules/invoices/routes/health'));

// ─── Invoice module routes ────────────────────────────────────────────────────
app.use('/api/invoices',     requireAuth, methodLimiter, require('./modules/invoices/routes/invoices'));
app.use('/api/vendors',      requireAuth, methodLimiter, require('./modules/invoices/routes/vendors'));
app.use('/api/jobs',         requireAuth, methodLimiter, require('./modules/invoices/routes/jobs'));
app.use('/api/subcontracts', requireAuth, methodLimiter, require('./modules/invoices/routes/subcontracts'));
app.use('/api/rules',        requireAuth, methodLimiter, require('./modules/invoices/routes/rules'));
app.use('/api/pipeline',     requireAuth, methodLimiter, require('./modules/invoices/routes/pipeline'));
app.use('/api/ignore-rules', requireAuth, methodLimiter, require('./modules/invoices/routes/ignore-rules'));
app.use('/api/feedback',     requireAuth, methodLimiter, require('./modules/invoices/routes/feedback'));
app.use('/api/lien-waivers', requireAuth, methodLimiter, require('./modules/invoices/routes/lien-waivers'));
app.use('/api/users',        requireAuth, methodLimiter, require('./modules/invoices/routes/users'));
app.use('/api/splits',       requireAuth, methodLimiter, require('./modules/invoices/routes/splits'));
app.use('/api/document-destinations', requireAuth, methodLimiter, require('./modules/invoices/routes/document-destinations'));
app.use('/api/coi-config',   requireAuth, methodLimiter, require('./modules/invoices/routes/coi-config'));

// Document-level operations (Spectrum COI upload)
app.use('/api/documents',    requireAuth, methodLimiter, require('./modules/invoices/routes/documents'));

// Settings / lookup tables (classifications, routing-codes, phase-codes, gl-accounts)
const settingsRouter = require('./modules/invoices/routes/settings');
app.use('/api', requireAuth, methodLimiter, settingsRouter);

// ─── Feature Request module ──────────────────────────────────────────────────
app.use('/api/feature-requests', requireAuth, methodLimiter, require('./modules/feature-requests/routes'));

// ─── Platform Role System routes ────────────────────────────────────────────
app.use('/api/roles',        requireAuth, methodLimiter, require('./routes/roles'));
app.use('/api',              requireAuth, methodLimiter, require('./routes/permissions'));
app.use('/api/title-rules',  requireAuth, methodLimiter, require('./routes/title-rules'));
app.use('/api/admin/users',  requireAuth, methodLimiter, require('./routes/admin-users'));
app.use('/api/audit',        requireAuth, methodLimiter, require('./routes/audit-events'));
// This legacy URL preserves its original transport-only auth behavior.
const { bumpVersionRouter } = require('./routes/admin-users');
app.use('/api/users', requireAuth, bumpVersionRouter);

// ─── 404 handler for unknown API routes ──────────────────────────────────────
app.use('/api', (_req, res) => {
  return fail(res, 404, 'Not found');
});

// ─── Global error handler (must be after all routes) ─────────────────────────
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  return safeError(res, err, `${req.method} ${req.originalUrl}`);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Toolbox API listening');

  recoverStaleSubmittingInvoices().catch((error) => {
    logger.error({
      operation: 'invoice.submit.recover_stale',
      context: {},
      error: error && error.message ? error.message : String(error),
      err: error,
    }, 'Stale submit recovery failed');
  });

  // Re-spawn the split-worker for children stuck in split-processing
  // (worker died silently). Startup + every 5 minutes.
  const sweepStuckSplits = () => {
    recoverStuckSplitChildren().catch((error) => {
      logger.error({
        operation: 'splits.recover_stuck',
        context: {},
        error: error && error.message ? error.message : String(error),
        err: error,
      }, 'Stuck split recovery failed');
    });
  };
  sweepStuckSplits();
  setInterval(sweepStuckSplits, 5 * 60 * 1000).unref();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.fatal({ port: PORT }, `Port ${PORT} already in use — another process is holding it. Exiting with code 1.`);
    process.exit(1);
  }
  logger.fatal({ err }, 'Server error');
  process.exit(1);
});

// Keep the event loop alive even if all other handles drain
const keepAlive = setInterval(() => {}, 60_000);
keepAlive.unref = undefined; // prevent accidental unref

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  clearInterval(keepAlive);
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
  clearInterval(keepAlive);
  server.close(() => process.exit(0));
});

module.exports = app;
