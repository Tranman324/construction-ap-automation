'use strict';

async function resolveActor(actor, db) {
  const result = await db.query(
    'SELECT name FROM toolbox_users WHERE id::text = $1 OR lower(email) = lower($2) ORDER BY (id::text = $1) DESC LIMIT 1',
    [actor.userId || null, actor.email || null]
  );
  return { userId: actor.userId || actor.email || null, name: result.rows[0]?.name?.trim() || actor.email || 'System', role: actor.role || null };
}

module.exports = { resolveActor };
