/**
 * Postgres connection pool — Supabase (NCG Operations)
 * Fallback to environment-configured local Postgres if SUPABASE_DB_URL is not set
 *
 * Also initializes the Supabase JS client for the Platform Role System
 * (roles, permissions, title-rules routes).
 */
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const logger = require('./logger');

// Load .env from pipeline root
try {
  const envPath = path.join(__dirname, '..', '.env');
  const envContent = require('fs').readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
} catch {}

const pool = process.env.SUPABASE_DB_URL
  ? new Pool({
      connectionString: process.env.SUPABASE_DB_URL,
      // SECURITY: intentional — Supabase managed TLS
      // This managed-service compensating control preserves connectivity; it is
      // not certificate-validation closure and remains an environment check.
      ssl: { rejectUnauthorized: false },
      // Session pooler limit is 15 across ALL processes. The pipeline spawns
      // as a separate node process and needs ~3 connections for its rules
      // phase, so the server must stay under 12 to avoid EMAXCONNSESSION.
      max: process.env.PG_POOL_MAX ? parseInt(process.env.PG_POOL_MAX, 10) : 10,
      // Keep idle connections alive — establishing a fresh connection to the
      // Supabase pooler costs ~750ms (TLS + auth round-trips to us-east-1).
      // Without this, pg reaps idle clients after 10s and the next request
      // eats the full cold-connect penalty.
      min: 2,
      idleTimeoutMillis: 300000, // 5 min — pooler side allows long idle
      connectionTimeoutMillis: 5000,
      keepAlive: true,
    })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      database: process.env.PGDATABASE || 'toolbox',
      user: process.env.PGUSER || 'toolbox',
      password: process.env.PGPASSWORD,
      port: parseInt(process.env.PGPORT || '5432', 10),
      max: 20,
    });

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PG pool error');
});

// Heartbeat: ping one connection every 4 min so the Supabase pooler doesn't
// silently drop idle TCP sessions (which would force a ~750ms reconnect on
// the next real query). Unref'd so it never blocks process shutdown.
if (process.env.SUPABASE_DB_URL) {
  const heartbeat = setInterval(() => {
    pool.query('SELECT 1').catch((err) => {
      logger.warn({ err: err.message }, 'PG pool heartbeat failed');
    });
  }, 240000);
  heartbeat.unref();
}

// ─── Supabase JS Client (Platform Role System) ──────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

// ─── Role System Helpers ─────────────────────────────────────────────────────

const USER_WITH_ROLE_SELECT = `
  id,
  azure_id,
  email,
  name,
  role_id,
  is_active,
  job_title,
  avatar_url,
  role_version,
  last_login_at,
  created_at,
  updated_at,
  role:roles!toolbox_users_role_id_fkey (
    id,
    name,
    description,
    is_system,
    created_at,
    updated_at
  )
`;

const TITLE_RULE_SELECT = `
  id,
  pattern,
  match_type,
  role_id,
  priority,
  is_active,
  created_at
`;

function logRoleDbError(operation, error, context) {
  logger.error({
    msg: `role db helper failed: ${operation}`,
    context: context || {},
    error: error && error.message ? error.message : String(error),
  });
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function normalizeJobTitle(jobTitle) {
  return typeof jobTitle === 'string' ? jobTitle.trim() : '';
}

function matchesTitleRule(jobTitle, rule) {
  const normalizedTitle = normalizeJobTitle(jobTitle).toLowerCase();
  const normalizedPattern = normalizeJobTitle(rule && rule.pattern).toLowerCase();
  if (!normalizedTitle || !normalizedPattern) return false;
  switch (rule.match_type) {
    case 'equals':      return normalizedTitle === normalizedPattern;
    case 'starts_with': return normalizedTitle.startsWith(normalizedPattern);
    case 'contains':    return normalizedTitle.includes(normalizedPattern);
    default:            return false;
  }
}

async function getUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { data, error } = await queryUserByEmail(normalized);
  if (error) { logRoleDbError('getUserByEmail', error, { email: normalized }); return null; }
  return data || null;
}

// JWT authentication must distinguish an unavailable identity store from a
// verified credential that simply has no Toolbox user. The legacy helpers
// intentionally degrade their route-facing callers to null/empty values;
// this contract deliberately preserves lookup failures for auth middleware.
async function getUserByEmailForAuth(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { data, error } = await queryUserByEmail(normalized);
  if (error) {
    logRoleDbError('getUserByEmailForAuth', error, { email: normalized });
    throw error;
  }
  return data || null;
}

function queryUserByEmail(normalizedEmail) {
  return supabase
    .from('toolbox_users').select(USER_WITH_ROLE_SELECT)
    .eq('email', normalizedEmail).maybeSingle();
}

function queryUserRoleById(userId) {
  return supabase
    .from('toolbox_users')
    .select('id, role_id, role:roles!toolbox_users_role_id_fkey (name, is_system)')
    .eq('id', userId).maybeSingle();
}

function queryRolePermissions(roleId) {
  return supabase
    .from('role_permissions').select('permission_key')
    .eq('role_id', roleId).eq('granted', true);
}

function queryUserOverrides(userId) {
  return supabase
    .from('user_permission_overrides').select('permission_key, granted')
    .eq('user_id', userId);
}

function handleRoleQueryError(operation, error, context, throwOnError) {
  if (!error) return false;
  logRoleDbError(operation, error, context);
  if (throwOnError) throw error;
  return true;
}

async function getRolePermissions(roleId, { throwOnError = false } = {}) {
  if (!roleId) return [];
  const { data, error } = await queryRolePermissions(roleId);
  if (handleRoleQueryError('getRolePermissions', error, { roleId }, throwOnError)) return [];
  return (data || []).map((r) => r.permission_key).filter(Boolean).sort();
}

async function getUserOverrides(userId, { throwOnError = false } = {}) {
  if (!userId) return [];
  const { data, error } = await queryUserOverrides(userId);
  if (handleRoleQueryError('getUserOverrides', error, { userId }, throwOnError)) return [];
  return (data || []).map((r) => ({ permission_key: r.permission_key, granted: Boolean(r.granted) }));
}

function applyPermissionOverrides(rolePerms, overrides) {
  const effective = new Set(rolePerms);
  overrides.forEach((override) => {
    if (!override.permission_key) return;
    if (override.granted) effective.add(override.permission_key);
    else effective.delete(override.permission_key);
  });
  return Array.from(effective).sort();
}

async function getUserPermissionsForRole(userId, roleId, { throwOnError = false } = {}) {
  if (!userId || !roleId) return [];
  const rolePerms = await getRolePermissions(roleId, { throwOnError });
  const overrides = await getUserOverrides(userId, { throwOnError });
  return applyPermissionOverrides(rolePerms, overrides);
}

async function getUserPermissions(userId) {
  if (!userId) return [];
  const { data: userRow, error: userError } = await queryUserRoleById(userId);
  if (userError) { logRoleDbError('getUserPermissions.userLookup', userError, { userId }); return []; }
  if (!userRow || !userRow.role_id) return [];
  return getUserPermissionsForRole(userId, userRow.role_id);
}

// JWT authentication receives the role data with its identity lookup. Passing
// that data through avoids a second toolbox_users query while preserving the
// legacy helpers' null/empty fallback contract for non-auth callers.
async function getUserPermissionsForAuth(userId, roleId) {
  return getUserPermissionsForRole(userId, roleId, { throwOnError: true });
}

async function matchTitleRule(jobTitle) {
  const normalized = normalizeJobTitle(jobTitle);
  if (!normalized) return null;
  const { data, error } = await supabase
    .from('title_role_rules').select(TITLE_RULE_SELECT)
    .eq('is_active', true).order('priority', { ascending: false });
  if (error) { logRoleDbError('matchTitleRule', error, { jobTitle: normalized }); return null; }
  return (data || []).find((rule) => matchesTitleRule(normalized, rule)) || null;
}

async function upsertUser({ email, name, azureId, jobTitle, phone, roleId }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !name || !roleId) return null;
  const payload = {
    email: normalized, name,
    azure_id: azureId || null,
    job_title: normalizeJobTitle(jobTitle) || null,
    phone: phone || null,
    role_id: roleId,
    last_login_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('toolbox_users').upsert(payload, { onConflict: 'email' });
  if (error) { logRoleDbError('upsertUser', error, { email: normalized, roleId }); return null; }
  return getUserByEmail(normalized);
}

async function bumpRoleVersion(userId) {
  if (!userId) return null;
  // Atomic increment via DB function — no read-then-update race condition
  const { data, error } = await supabase.rpc('bump_role_version', { p_user_id: userId });
  if (error) { logRoleDbError('bumpRoleVersion', error, { userId }); return null; }
  if (!data || data.length === 0) return null;
  return { id: data[0].id, role_version: data[0].role_version };
}

// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = pool;
module.exports.supabase = supabase;
module.exports.getUserByEmail = getUserByEmail;
module.exports.getUserByEmailForAuth = getUserByEmailForAuth;
module.exports.getUserPermissions = getUserPermissions;
module.exports.getUserPermissionsForAuth = getUserPermissionsForAuth;
module.exports.getRolePermissions = getRolePermissions;
module.exports.getUserOverrides = getUserOverrides;
module.exports.matchTitleRule = matchTitleRule;
module.exports.upsertUser = upsertUser;
module.exports.bumpRoleVersion = bumpRoleVersion;
