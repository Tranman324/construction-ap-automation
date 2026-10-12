'use strict';

const { supabase } = require('../lib/db');

async function getRoleById(id) {
  const { data, error } = await supabase.from('roles').select('id, name, description, is_system').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function listRoles({ limit, offset }) {
  const result = await supabase.from('roles').select('id, name, description, is_system, toolbox_users!toolbox_users_role_id_fkey(count)').order('name', { ascending: true }).order('id', { ascending: true }).range(offset, offset + limit - 1);
  if (result.error) throw result.error;
  return result.data || [];
}

async function createRole(payload) {
  const result = await supabase.from('roles').insert(payload).select('id, name, description, is_system').single();
  if (result.error) throw result.error;
  return result.data;
}

async function updateRole(id, payload) {
  const result = await supabase.from('roles').update(payload).eq('id', id).select('id, name, description, is_system').single();
  if (result.error) throw result.error;
  return result.data;
}

async function countRoleUsers(id) {
  const result = await supabase.from('toolbox_users').select('id', { count: 'exact', head: true }).eq('role_id', id);
  if (result.error) throw result.error;
  return result.count || 0;
}

async function deleteRole(id) {
  const result = await supabase.from('roles').delete().eq('id', id);
  if (result.error) throw result.error;
}

module.exports = { countRoleUsers, createRole, deleteRole, getRoleById, listRoles, updateRole };
