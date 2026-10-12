'use strict';

async function withTransaction(pool, work) {
  if (typeof pool.connect !== 'function') return work(pool);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction };
