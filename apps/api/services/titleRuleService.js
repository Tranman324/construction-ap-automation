'use strict';

const { matchTitleRule, supabase } = require('../lib/db');
const RULE_SELECT = 'id, pattern, match_type, role_id, priority, is_active, created_at, role:roles(name)';
async function getRoleById(id) { const r = await supabase.from('roles').select('id, name').eq('id', id).maybeSingle(); if (r.error) throw r.error; return r.data || null; }
async function getTitleRule(id) { const r = await supabase.from('title_role_rules').select(RULE_SELECT).eq('id', id).maybeSingle(); if (r.error) throw r.error; return r.data || null; }
async function listTitleRules({ limit, offset }) { const r = await supabase.from('title_role_rules').select(RULE_SELECT).order('priority', { ascending: false }).order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + limit - 1); if (r.error) throw r.error; return r.data || []; }
async function createTitleRule(payload) { const r = await supabase.from('title_role_rules').insert(payload).select(RULE_SELECT).single(); if (r.error) throw r.error; return r.data; }
async function updateTitleRule(id, payload) { const r = await supabase.from('title_role_rules').update(payload).eq('id', id).select(RULE_SELECT).single(); if (r.error) throw r.error; return r.data; }
async function deleteTitleRule(id) { const r = await supabase.from('title_role_rules').delete().eq('id', id).select('id').maybeSingle(); if (r.error) throw r.error; return r.data || null; }
module.exports = { createTitleRule, deleteTitleRule, getRoleById, getTitleRule, listTitleRules, matchTitleRule, updateTitleRule };
