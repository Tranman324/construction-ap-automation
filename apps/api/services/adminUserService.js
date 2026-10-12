'use strict';

const db = require('../lib/db');
const { withTransaction } = require('../modules/invoices/services/transaction');

const LAST_ACTIVE_ADMIN_LOCK = 91324017;
const USER_LIST_SELECT = `
  id, azure_id, email, name, role_id, is_active, job_title, phone, avatar_url,
  role_version, last_login_at, created_at, updated_at,
  role:roles!toolbox_users_role_id_fkey (id, name, description, is_system)
`;

function isAdminRole(role) { return typeof role?.name === 'string' && role.name.trim().toLowerCase() === 'admin'; }
async function getRoleById(id) { const r = await db.supabase.from('roles').select('id, name').eq('id', id).maybeSingle(); if (r.error) throw r.error; return r.data || null; }
async function getAdminUser(id) { const r = await db.supabase.from('toolbox_users').select('id, email, role_id, is_active').eq('id', id).maybeSingle(); if (r.error) throw r.error; return r.data || null; }
async function listAdminUsers({ limit, offset }) { const r = await db.supabase.from('toolbox_users').select(USER_LIST_SELECT).order('name', { ascending: true }).order('id', { ascending: true }).range(offset, offset + limit - 1); if (r.error) throw r.error; return r.data || []; }
async function countActiveUsersForRole(roleId) { const r = await db.supabase.from('toolbox_users').select('id', { count: 'exact', head: true }).eq('role_id', roleId).eq('is_active', true); if (r.error) throw r.error; if (!Number.isInteger(r.count)) throw new Error('Could not verify active admin count'); return r.count; }

async function updateAdminUser({ id, existing, payload, roleChanged, nextRole, nextActive }) {
  return withTransaction(db, async (client) => {
    if (typeof client.query === 'function') await client.query('SELECT pg_advisory_xact_lock($1)', [LAST_ACTIVE_ADMIN_LOCK]);
    if (existing.is_active) {
      const currentRole = await getRoleById(existing.role_id);
      const remainsAdmin = nextRole ? isAdminRole(nextRole) : true;
      if (isAdminRole(currentRole) && (nextActive === false || !remainsAdmin) && await countActiveUsersForRole(existing.role_id) <= 1) {
        return { conflict: true };
      }
    }
    const update = { ...payload, updated_at: new Date().toISOString() };
    const result = await db.supabase.from('toolbox_users').update(update).eq('id', id).select(USER_LIST_SELECT).single();
    if (result.error) throw result.error;
    if (roleChanged) {
      const bumped = await db.bumpRoleVersion(id);
      if (!bumped) throw new Error('Failed to bump role version');
      result.data.role_version = bumped.role_version;
    }
    return { updated: result.data };
  });
}

async function bumpAdminUserRoleVersion(id) { return db.bumpRoleVersion(id); }
module.exports = { bumpAdminUserRoleVersion, getAdminUser, getRoleById, listAdminUsers, updateAdminUser };
