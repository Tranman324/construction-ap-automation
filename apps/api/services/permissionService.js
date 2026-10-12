'use strict';

const { supabase } = require('../lib/db');

async function getRole(id) { const r = await supabase.from('roles').select('id').eq('id', id).maybeSingle(); if (r.error) throw r.error; return r.data || null; }
async function getUser(id) { const r = await supabase.from('toolbox_users').select('id').eq('id', id).maybeSingle(); if (r.error) throw r.error; return r.data || null; }
async function getKnownPermissionKeys(keys) { if (!keys.length) return []; const r = await supabase.from('permissions').select('key').in('key', keys); if (r.error) throw r.error; return (r.data || []).map((row) => row.key); }
async function listRolePermissionKeys(id, pagination) { let q = supabase.from('role_permissions').select('permission_key').eq('role_id', id).eq('granted', true).order('permission_key', { ascending: true }); if (pagination) q = q.range(pagination.offset, pagination.offset + pagination.limit - 1); const r = await q; if (r.error) throw r.error; return (r.data || []).map((row) => row.permission_key); }
async function listUserPermissionOverrides(id, pagination) { let q = supabase.from('user_permission_overrides').select('permission_key, granted').eq('user_id', id).order('permission_key', { ascending: true }); if (pagination) q = q.range(pagination.offset, pagination.offset + pagination.limit - 1); const r = await q; if (r.error) throw r.error; return (r.data || []).map((row) => ({ key: row.permission_key, granted: Boolean(row.granted) })); }
async function listPermissions({ limit, offset }) { const r = await supabase.from('permissions').select('key, module, description').order('module', { ascending: true }).order('key', { ascending: true }).range(offset, offset + limit - 1); if (r.error) throw r.error; return r.data || []; }
async function replaceRolePermissions(id, keys) { const r = await supabase.rpc('replace_role_permissions', { p_role_id: id, p_keys: keys }); if (r.error) throw r.error; }
async function replaceUserOverrides(id, overrides) { const r = await supabase.rpc('replace_user_overrides', { p_user_id: id, p_overrides: overrides }); if (r.error) throw r.error; }
module.exports = { getKnownPermissionKeys, getRole, getUser, listPermissions, listRolePermissionKeys, listUserPermissionOverrides, replaceRolePermissions, replaceUserOverrides };
