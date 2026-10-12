'use strict';
/**
 * MNY-02/03 Live Postgres Lock Contention Test
 *
 * Verifies that FOR UPDATE + conditional status UPDATE correctly serializes
 * concurrent approval attempts on the same document in production Postgres.
 *
 * What this proves:
 *   1. Two concurrent transactions both SELECT ... FOR UPDATE the same row.
 *   2. One wins the lock and changes the status from 'pending' → 'approved'.
 *   3. The other acquires the lock after the first commits, re-reads the row,
 *      and sees status='approved' — its UPDATE WHERE status IN ('pending',...)
 *      returns rowCount=0. This is the 409 path.
 *
 * Safe: creates a test document, runs the test, then deletes it.
 *
 * Usage: DATABASE_URL=<supabase_url> node tests/live/lock-contention.js
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL
  || process.env.SUPABASE_DB_URL;

if (!DATABASE_URL) {
  console.error('Set DATABASE_URL or SUPABASE_DB_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 4,
});

const TEST_DOC_ID = `test-lock-contention-${Date.now()}`;

async function setup() {
  // Create a minimal test document in 'pending' status
  await pool.query(`
    INSERT INTO documents (id, status, classification, created_at, updated_at)
    VALUES ($1, 'pending', 'invoice', NOW(), NOW())
  `, [TEST_DOC_ID]);
  console.log(`✅ Created test document: ${TEST_DOC_ID}`);
}

async function cleanup() {
  await pool.query('DELETE FROM documents WHERE id = $1', [TEST_DOC_ID]);
  console.log(`🧹 Cleaned up test document: ${TEST_DOC_ID}`);
  await pool.end();
}

async function runConcurrencyTest() {
  const results = { txA: null, txB: null };

  // Barrier: both transactions start their SELECT FOR UPDATE ~simultaneously
  let releaseBarrier;
  const barrier = new Promise(resolve => { releaseBarrier = resolve; });

  const txA = (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      console.log('[TX-A] BEGIN');

      // Signal that A is ready
      releaseBarrier();

      // Lock the row
      const lockResult = await client.query(
        'SELECT id, status FROM documents WHERE id = $1 FOR UPDATE',
        [TEST_DOC_ID]
      );
      const row = lockResult.rows[0];
      console.log(`[TX-A] Locked row, status="${row.status}"`);

      if (!['pending', 'modified', 'reviewed'].includes(row.status)) {
        results.txA = { won: false, status: row.status, reason: 'status_mismatch_pre_update' };
        await client.query('ROLLBACK');
        return;
      }

      // Simulate some processing time so TX-B queues up
      await new Promise(r => setTimeout(r, 200));

      // Conditional update (mirrors the real approve path)
      const updateResult = await client.query(
        `UPDATE documents
         SET status = 'approved', approved_at = NOW(), approved_by = 'TX-A', updated_at = NOW()
         WHERE id = $1 AND status IN ('pending', 'modified', 'reviewed')`,
        [TEST_DOC_ID]
      );

      if (updateResult.rowCount === 0) {
        results.txA = { won: false, reason: 'rowCount_zero' };
      } else {
        results.txA = { won: true, rowCount: updateResult.rowCount };
      }

      console.log(`[TX-A] UPDATE rowCount=${updateResult.rowCount}`);
      await client.query('COMMIT');
      console.log('[TX-A] COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      results.txA = { won: false, error: err.message };
      console.error(`[TX-A] ERROR: ${err.message}`);
    } finally {
      client.release();
    }
  })();

  const txB = (async () => {
    const client = await pool.connect();
    try {
      // Wait for TX-A to start
      await barrier;
      // Small delay to ensure TX-A gets the lock first
      await new Promise(r => setTimeout(r, 50));

      await client.query('BEGIN');
      console.log('[TX-B] BEGIN');

      // This will BLOCK until TX-A commits
      console.log('[TX-B] Waiting for lock...');
      const lockResult = await client.query(
        'SELECT id, status FROM documents WHERE id = $1 FOR UPDATE',
        [TEST_DOC_ID]
      );
      const row = lockResult.rows[0];
      console.log(`[TX-B] Locked row (after TX-A committed), status="${row.status}"`);

      if (!['pending', 'modified', 'reviewed'].includes(row.status)) {
        results.txB = { won: false, status: row.status, reason: 'status_mismatch_pre_update' };
        await client.query('ROLLBACK');
        console.log('[TX-B] ROLLBACK — status already changed (would be 409)');
        return;
      }

      // Conditional update — should fail because TX-A already changed status
      const updateResult = await client.query(
        `UPDATE documents
         SET status = 'approved', approved_at = NOW(), approved_by = 'TX-B', updated_at = NOW()
         WHERE id = $1 AND status IN ('pending', 'modified', 'reviewed')`,
        [TEST_DOC_ID]
      );

      if (updateResult.rowCount === 0) {
        results.txB = { won: false, reason: 'rowCount_zero' };
        console.log('[TX-B] UPDATE rowCount=0 — race correctly blocked (would be 409)');
      } else {
        results.txB = { won: true, rowCount: updateResult.rowCount };
        console.log(`[TX-B] UPDATE rowCount=${updateResult.rowCount} — UNEXPECTED WIN`);
      }

      await client.query('COMMIT');
      console.log('[TX-B] COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      results.txB = { won: false, error: err.message };
      console.error(`[TX-B] ERROR: ${err.message}`);
    } finally {
      client.release();
    }
  })();

  await Promise.all([txA, txB]);

  return results;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  MNY-02/03 Live Postgres Lock Contention Test');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await setup();
    const results = await runConcurrencyTest();

    console.log('\n─── Results ───');
    console.log('TX-A:', JSON.stringify(results.txA));
    console.log('TX-B:', JSON.stringify(results.txB));

    // Verify: exactly one winner
    const aWon = results.txA && results.txA.won;
    const bWon = results.txB && results.txB.won;

    if (aWon && !bWon) {
      console.log('\n✅ PASS: TX-A won the lock race, TX-B correctly blocked.');
      console.log('   FOR UPDATE serialization works under live Postgres.');

      // Verify the blocking reason
      if (results.txB.reason === 'status_mismatch_pre_update') {
        console.log('   TX-B saw status="approved" after acquiring lock (application-level gate).');
      } else if (results.txB.reason === 'rowCount_zero') {
        console.log('   TX-B hit rowCount=0 on conditional UPDATE (SQL-level gate).');
      }
    } else if (!aWon && !bWon) {
      console.log('\n❌ FAIL: Neither transaction won. Both errored.');
    } else if (aWon && bWon) {
      console.log('\n❌ FAIL: BOTH transactions won. Lock contention NOT working!');
      process.exitCode = 1;
    } else {
      console.log('\n⚠️  Unexpected: TX-B won instead of TX-A (timing variance).');
      console.log('   Lock contention still works — just different winner.');
    }

    // Verify final DB state
    const finalRow = await pool.query('SELECT status, approved_by FROM documents WHERE id = $1', [TEST_DOC_ID]);
    if (finalRow.rows.length > 0) {
      console.log(`\n   Final DB state: status="${finalRow.rows[0].status}", approved_by="${finalRow.rows[0].approved_by}"`);
    }
  } finally {
    await cleanup();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  cleanup().catch(() => {}).then(() => process.exit(1));
});
