'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function resolved(relativePath) {
  return require.resolve(path.join(root, relativePath));
}

async function withPipelinePool(pool, fn, { graph, docConvert, childProcess } = {}) {
  const dbPath = resolved('lib/db.js');
  const pipelinePath = resolved('modules/invoices/services/pipeline.js');
  const graphPath = resolved('lib/graph.js');
  const docConvertPath = resolved('modules/invoices/services/docConvert.js');
  const junkFilterPath = resolved('modules/invoices/services/junkFilterService.js');
  const paths = [dbPath, pipelinePath, graphPath, docConvertPath, junkFilterPath];
  const before = new Map(paths.map((modulePath) => [modulePath, require.cache[modulePath]]));
  delete require.cache[pipelinePath];
  delete require.cache[junkFilterPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
  if (graph) require.cache[graphPath] = { id: graphPath, filename: graphPath, loaded: true, exports: graph };
  if (docConvert) require.cache[docConvertPath] = { id: docConvertPath, filename: docConvertPath, loaded: true, exports: docConvert };
  const originalLoad = Module._load;
  if (childProcess) {
    Module._load = function load(request, parent, isMain) {
      if (request === 'child_process') return { ...originalLoad.call(this, request, parent, isMain), ...childProcess };
      return originalLoad.call(this, request, parent, isMain);
    };
  }
  try {
    return await fn(require('../../modules/invoices/services/pipeline'));
  } finally {
    Module._load = originalLoad;
    for (const [modulePath, cached] of before) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
}

async function withReprocessorPool(pool, fn) {
  // reprocess-errors.js is spawned as its own process and now takes its
  // connection from lib/scriptDb (single client), so inject the fake pool
  // through scriptDb.createScriptClient rather than the shared lib/db pool.
  const scriptDbPath = resolved('lib/scriptDb.js');
  const reprocessorPath = resolved('modules/invoices/scripts/reprocess-errors.js');
  const beforeScriptDb = require.cache[scriptDbPath];
  const beforeReprocessor = require.cache[reprocessorPath];
  delete require.cache[reprocessorPath];
  require.cache[scriptDbPath] = {
    id: scriptDbPath,
    filename: scriptDbPath,
    loaded: true,
    exports: {
      createScriptClient: () => pool,
      withScriptClient: async (work) => work(pool),
      buildClientConfig: () => ({}),
    },
  };
  try {
    return await fn(require('../../modules/invoices/scripts/reprocess-errors'));
  } finally {
    if (beforeScriptDb) require.cache[scriptDbPath] = beforeScriptDb;
    else delete require.cache[scriptDbPath];
    if (beforeReprocessor) require.cache[reprocessorPath] = beforeReprocessor;
    else delete require.cache[reprocessorPath];
  }
}

function createTransactionalDb() {
  const state = { documents: [], processed: new Set(), tx: null };
  const active = () => state.tx || state;
  return {
    state,
    async query(sql, params = []) {
      if (sql === 'BEGIN') {
        assert.equal(state.tx, null);
        state.tx = { documents: state.documents.map((doc) => ({ ...doc })), processed: new Set(state.processed) };
        return { rows: [] };
      }
      if (sql === 'COMMIT') {
        assert.notEqual(state.tx, null);
        state.documents = state.tx.documents;
        state.processed = state.tx.processed;
        state.tx = null;
        return { rows: [] };
      }
      if (sql === 'ROLLBACK') {
        state.tx = null;
        return { rows: [] };
      }
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/SELECT 1 FROM processed_emails/.test(sql)) {
        return { rows: active().processed.has(params[0]) ? [{ '?column?': 1 }] : [] };
      }
      if (/INSERT INTO processed_emails/.test(sql)) {
        active().processed.add(params[0]);
        return { rows: [] };
      }
      if (/INSERT INTO documents/.test(sql)) {
        active().documents.push({ id: params[0], email_message_id: params[1] });
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

function cloneState(state) {
  return {
    documents: state.documents.map((doc) => ({ ...doc })),
    audits: state.audits.map((audit) => ({ ...audit })),
    events: state.events.map((event) => ({ ...event })),
    processed: new Set(state.processed),
    errorsResolved: state.errorsResolved,
  };
}

function createPipelinePool({ snapshotProcessed = [], lockedProcessed = [], exhaustedError = null, failAudit = false, failStructuredAudit = false } = {}) {
  const state = {
    documents: [],
    audits: [],
    events: [],
    processed: new Set(lockedProcessed),
    errorsResolved: false,
    tx: null,
    commits: 0,
    rollbacks: 0,
    releases: 0,
    pipelineErrors: [],
    structuredAuditAttempts: 0,
  };
  const active = () => state.tx || state;

  async function query(sql, params = []) {
    if (sql === 'BEGIN') {
      assert.equal(state.tx, null);
      state.tx = cloneState(state);
      return { rows: [] };
    }
    if (sql === 'COMMIT') {
      assert.notEqual(state.tx, null);
      state.documents = state.tx.documents;
      state.audits = state.tx.audits;
      state.events = state.tx.events;
      state.processed = state.tx.processed;
      state.errorsResolved = state.tx.errorsResolved;
      state.tx = null;
      state.commits++;
      return { rows: [] };
    }
    if (sql === 'ROLLBACK') {
      state.tx = null;
      state.rollbacks++;
      return { rows: [] };
    }
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/SELECT 1 FROM processed_emails/.test(sql)) {
      return { rows: active().processed.has(params[0]) ? [{ '?column?': 1 }] : [] };
    }
    if (/SELECT retry_count, max_retries, error_stage, error_message FROM pipeline_errors/.test(sql)) {
      return { rows: exhaustedError ? [exhaustedError] : [] };
    }
    if (/SELECT id, status FROM documents\s+WHERE invoice_number IS NOT NULL/.test(sql)) return { rows: [] };
    if (/SELECT id FROM documents/.test(sql)) {
      const found = active().documents.find((doc) => doc.email_message_id === params[0]
        && doc.file_name === params[1] && doc.file_size_bytes === params[2]);
      return { rows: found ? [{ id: found.id }] : [] };
    }
    if (/INSERT INTO documents/.test(sql)) {
      // Map every named column to its bound value so tests can read any field
      // and a column/placeholder/param count mismatch fails loudly.
      const columns = sql.match(/INSERT INTO documents \(([\s\S]*?)\)\s*VALUES/)[1].split(',').map((c) => c.trim());
      const placeholders = sql.match(/VALUES\s*\(([\s\S]*?)\)/)[1].match(/\$\d+/g);
      assert.equal(placeholders.length, columns.length, 'documents INSERT placeholders must match its column list');
      assert.equal(params.length, columns.length, 'documents INSERT params must match its column list');
      const row = Object.fromEntries(columns.map((column, i) => [column, params[i]]));
      active().documents.push({
        id: params[0],
        classification: params[1],
        status: params[2],
        file_name: params[4],
        file_path: params[5],
        file_size_bytes: params[6],
        email_message_id: params[7],
        email_body_preview: row.email_body_preview,
        email_body: row.email_body,
        email_body_content_type: row.email_body_content_type,
        flagged: row.flagged,
        notes: row.notes,
        queued_at: row.queued_at,
        flagged_at: row.flagged_at,
        flagged_by: row.flagged_by,
        flag_reason: row.flag_reason,
        source_document_id: row.source_document_id,
        source_email_message_id: row.source_email_message_id,
        source_attachment_id: row.source_attachment_id,
      });
      return { rows: [] };
    }
    if (/INSERT INTO audit_events/.test(sql)) {
      state.structuredAuditAttempts++;
      if (failStructuredAudit) throw new Error('structured audit insert failed');
      const row = { id: params[0], type: params[1], actor_name: params[4], actor_role: params[5], target_id: params[7], changes: JSON.parse(params[9]), summary: params[13] };
      active().events.push(row);
      return { rows: [row] };
    }
    if (/INSERT INTO audit_log/.test(sql)) {
      if (failAudit) throw new Error('audit insert failed');
      active().audits.push({ document_id: params[0], action: params[1] });
      return { rows: [] };
    }
    if (/INSERT INTO processed_emails/.test(sql)) {
      active().processed.add(params[0]);
      return { rows: [] };
    }
    if (/UPDATE pipeline_errors SET resolved = true/.test(sql)) {
      active().errorsResolved = true;
      return { rows: [] };
    }
    if (/SELECT email_id FROM processed_emails/.test(sql)) {
      return { rows: snapshotProcessed.map((email_id) => ({ email_id })) };
    }
    if (/SELECT id, retry_count, max_retries FROM pipeline_errors/.test(sql)) {
      return { rows: state.pipelineErrors };
    }
    if (/INSERT INTO pipeline_errors/.test(sql)) {
      state.pipelineErrors.push({ id: 'pipeline-error-1', retry_count: 1, max_retries: 3, error_message: params[3], error_stage: params[4] });
      return { rows: [] };
    }
    if (/UPDATE pipeline_errors SET retry_count/.test(sql)) return { rows: [] };
    if (/SELECT\s+\*\s+FROM documents/.test(sql)) return { rows: state.documents };
    throw new Error(`Unexpected query: ${sql}`);
  }

  const client = {
    query,
    release() { state.releases++; },
  };
  return {
    state,
    query,
    async connect() { return client; },
  };
}

function email(id = 'message-run') {
  return {
    id,
    subject: 'Invoice email',
    from: { emailAddress: { address: 'vendor@example.com' } },
    receivedDateTime: '2026-07-15T12:00:00.000Z',
    bodyPreview: 'Please process',
    body: { content: 'Please process', contentType: 'html' },
  };
}

function pipelineDependencies({ emails, attachments = [], classifyAndExtract, autoLinkWaiver } = {}) {
  return {
    fetchEmailList: async () => emails,
    downloadAttachments: async () => ({ files: attachments, inlineRescued: 0 }),
    classifyAndExtract,
    autoLinkWaiver,
    getQueueCount: async () => 0,
  };
}

test('rolls back a partial attachment insert before retrying the same email once', async () => {
  const db = createTransactionalDb();
  await withPipelinePool(db, async ({ runEmailIngestionTransaction }) => {
    await assert.rejects(
      runEmailIngestionTransaction({
        db,
        emailId: 'message-1',
        persist: async (client) => {
          await client.query('INSERT INTO documents', ['attachment-a', 'message-1']);
          throw new Error('second attachment insert failed');
        },
      }),
      /second attachment insert failed/
    );

    assert.deepEqual(db.state.documents, []);
    assert.equal(db.state.processed.size, 0);

    const retried = await runEmailIngestionTransaction({
      db,
      emailId: 'message-1',
      persist: async (client) => {
        await client.query('INSERT INTO documents', ['attachment-a', 'message-1']);
        await client.query('INSERT INTO documents', ['attachment-b', 'message-1']);
      },
    });
    const duplicateRetry = await runEmailIngestionTransaction({
      db,
      emailId: 'message-1',
      persist: async () => assert.fail('processed email must not persist a second attachment set'),
    });

    assert.equal(retried.alreadyProcessed, false);
    assert.equal(duplicateRetry.alreadyProcessed, true);
    assert.deepEqual(db.state.documents.map((doc) => doc.id), ['attachment-a', 'attachment-b']);
    assert.equal(db.state.processed.has('message-1'), true);
  });
});

test('materializes a deduplicated retry-pending error document consumable by the reprocessor', async () => {
  const documents = [];
  const db = {
    async query(sql, params = []) {
      if (/SELECT id FROM documents/.test(sql)) {
        const found = documents.find((doc) => doc.email.messageId === params[0]
          && doc.file === params[1] && doc.pdfSize === params[2]);
        return { rows: found ? [{ id: found.id }] : [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await withPipelinePool(db, async ({ materializeExhaustedRetryDocuments }) => {
    const input = {
      db,
      email: {
        id: 'message-2',
        subject: 'Failed attachment',
        from: { emailAddress: { address: 'vendor@example.com' } },
      },
      attachments: [{ filename: 'invoice.pdf', path: '/tmp/invoice.pdf', size: 42 }],
      error: { stage: 'classify', message: 'vision unavailable' },
      runId: 'run-test',
      createDocument: async (entry) => documents.push(entry),
    };
    const first = await materializeExhaustedRetryDocuments(input);
    const second = await materializeExhaustedRetryDocuments(input);
    assert.equal(first.length, 1);
    assert.equal(second.length, 0);
    assert.equal(first[0].classification, 'error');
    assert.equal(first[0].status, 'retry-pending');
    assert.equal(first[0].filePath, '/tmp/invoice.pdf');
    await withReprocessorPool({
      async query(sql) {
        assert.match(sql, /classification = 'error' OR status = 'retry-pending'/);
        assert.match(sql, /file_path IS NOT NULL/);
        return { rows: [{
          id: first[0].id,
          classification: first[0].classification,
          status: first[0].status,
          file_path: first[0].filePath,
        }] };
      },
    }, async ({ fetchDocs, isReprocessableErrorDocument }) => {
      const consumed = await fetchDocs();
      assert.deepEqual(consumed.map((doc) => doc.id), [first[0].id]);
      assert.equal(isReprocessableErrorDocument(consumed[0]), true);
    });
  });
});

test('runPipeline commits a document, its audit, processed marker, and resolved error together', async () => {
  const pool = createPipelinePool();
  await withPipelinePool(pool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: pipelineDependencies({ emails: [email('message-success')] }),
    });

    assert.equal(result.queued, 1);
    assert.equal(pool.state.commits, 1);
    assert.equal(pool.state.rollbacks, 0);
    assert.equal(pool.state.documents.length, 1);
    assert.equal(pool.state.documents[0].email_message_id, 'message-success');
    assert.equal(pool.state.audits.length, 1);
    assert.equal(pool.state.events.length, 1);
    assert.equal(pool.state.events[0].type, 'invoice.intake');
    assert.equal(pool.state.events[0].actor_role, 'pipeline');
    assert.deepEqual(pool.state.events[0].changes, { from: 'vendor@example.com', subject: 'Invoice email', receivedAt: '2026-07-15T12:00:00.000Z' });
    assert.equal(pool.state.processed.has('message-success'), true);
    assert.equal(pool.state.errorsResolved, true);
    assert.equal(pool.state.releases, 1);
  });
});

test('runPipeline rolls back document, audit, marker, and error resolution when persistence fails', async () => {
  const pool = createPipelinePool({ failAudit: true });
  await withPipelinePool(pool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: pipelineDependencies({ emails: [email('message-rollback')] }),
    });

    assert.equal(result.errors, 1);
    assert.equal(pool.state.rollbacks, 1);
    assert.equal(pool.state.commits, 0);
    assert.deepEqual(pool.state.documents, []);
    assert.deepEqual(pool.state.audits, []);
    assert.equal(pool.state.processed.has('message-rollback'), false);
    assert.equal(pool.state.errorsResolved, false);
    assert.equal(pool.state.pipelineErrors.length, 1);
    assert.equal(pool.state.releases, 1);
  });
});

test('runPipeline rechecks a stale concurrent same-email snapshot under its lock', async () => {
  const pool = createPipelinePool({ lockedProcessed: ['message-concurrent'] });
  await withPipelinePool(pool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: pipelineDependencies({ emails: [email('message-concurrent')] }),
    });

    assert.equal(result.processed, 0);
    assert.equal(pool.state.commits, 0);
    assert.equal(pool.state.rollbacks, 1);
    assert.deepEqual(pool.state.documents, []);
    assert.equal(pool.state.releases, 1);
  });
});

test('runPipeline materializes an exhausted retry as a reprocessor-visible error document', async () => {
  const pool = createPipelinePool({
    exhaustedError: {
      retry_count: 3,
      max_retries: 3,
      error_stage: 'classify',
      error_message: 'vision unavailable',
    },
  });
  await withPipelinePool(pool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: pipelineDependencies({
        emails: [email('message-exhausted')],
        attachments: [{ filename: 'invoice.pdf', path: '/tmp/invoice.pdf', size: 42 }],
      }),
    });

    assert.equal(result.queued, 1);
    assert.equal(pool.state.commits, 1);
    assert.equal(pool.state.processed.has('message-exhausted'), true);
    assert.equal(pool.state.documents.length, 1);
    assert.equal(pool.state.documents[0].classification, 'error');
    assert.equal(pool.state.documents[0].status, 'retry-pending');
    await withReprocessorPool(pool, async ({ fetchDocs, isReprocessableErrorDocument }) => {
      const docs = await fetchDocs();
      assert.deepEqual(docs.map((doc) => doc.id), [pool.state.documents[0].id]);
      assert.equal(isReprocessableErrorDocument(docs[0]), true);
    });
  });
});

test('runPipeline auto-links a newly ingested waiver only after its transaction commits', async () => {
  const pool = createPipelinePool();
  const autoLinkCalls = [];
  await withPipelinePool(pool, async ({ runPipeline }) => {
    await runPipeline({
      postProcess: false,
      dependencies: pipelineDependencies({
        emails: [email('message-waiver')],
        attachments: [{ filename: 'waiver.pdf', path: '/tmp/waiver.pdf', size: 42 }],
        classifyAndExtract: async () => ({ classification: 'lien-waiver', confidence: 1 }),
        autoLinkWaiver: async (waiver) => {
          autoLinkCalls.push({ waiver, transactionOpen: pool.state.tx !== null });
        },
      }),
    });

    assert.equal(pool.state.commits, 1);
    assert.equal(autoLinkCalls.length, 1);
    assert.equal(autoLinkCalls[0].transactionOpen, false);
    assert.equal(autoLinkCalls[0].waiver.id, pool.state.documents[0].id);
  });
});

test('a post-commit waiver auto-link failure never reports or rolls back completed ingestion', async () => {
  const pool = createPipelinePool();
  await withPipelinePool(pool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: pipelineDependencies({
        emails: [email('message-waiver-link-failure')],
        attachments: [{ filename: 'waiver.pdf', path: '/tmp/waiver.pdf', size: 42 }],
        classifyAndExtract: async () => ({ classification: 'lien-waiver', confidence: 1 }),
        autoLinkWaiver: async () => { throw new Error('link service unavailable'); },
      }),
    });

    assert.equal(result.errors, 0);
    assert.equal(pool.state.commits, 1);
    assert.equal(pool.state.rollbacks, 0);
    assert.equal(pool.state.processed.has('message-waiver-link-failure'), true);
    assert.equal(pool.state.pipelineErrors.length, 0);
  });
});


test('new structured intake audit failure rolls back document, legacy audit, marker and error resolution', async () => {
  const pool = createPipelinePool({ failStructuredAudit: true });
  await withPipelinePool(pool, async ({ runPipeline }) => {
    const result = await runPipeline({
      postProcess: false,
      dependencies: pipelineDependencies({ emails: [email('message-structured-rollback')] }),
    });
    assert.equal(result.errors, 1);
    assert.equal(pool.state.structuredAuditAttempts, 1);
    assert.equal(pool.state.rollbacks, 1); assert.equal(pool.state.commits, 0);
    assert.deepEqual(pool.state.documents, []); assert.deepEqual(pool.state.audits, []);
    assert.deepEqual(pool.state.events, []);
    assert.equal(pool.state.processed.has('message-structured-rollback'), false);
    assert.equal(pool.state.errorsResolved, false); assert.equal(pool.state.releases, 1);
  });
});

// ── End-to-end: details unreadable after the type is decided ──
// Real runPipeline + real classifyAndExtract; only Haiku (and the PDF->PNG
// shell-out and OCR) are stubbed. Two pages classify lien-waiver, then the
// details call returns `extractionText`.
const DETAILS_UNREADABLE_NOTE = 'Details could not be read automatically - review and enter details';
const waiverReply = (invoiceReference) => ({
  classification: 'lien-waiver',
  confidence: 0.98,
  extracted: { claimantName: 'Northwind Drywall', amountReleased: '$12,000.00', invoiceReference, projectNumber: '26-434' },
});

async function runPipelineWithWaiverPdf(extractionText) {
  const fs = require('node:fs');
  const os = require('node:os');
  const Module = require('node:module');
  const childProcess = require('node:child_process');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-waiver-e2e-'));
  const filePath = path.join(tempDir, 'September Northwind Waivers.pdf');
  fs.writeFileSync(filePath, Buffer.alloc(16_000, 1));
  const visionPath = resolved('modules/invoices/services/vision.js');
  const ocrPath = resolved('modules/invoices/services/ocr.js');
  const before = new Map([visionPath, ocrPath].map((p) => [p, require.cache[p]]));
  let haikuCalls = 0;
  require.cache[visionPath] = { id: visionPath, filename: visionPath, loaded: true, exports: {
    callHaiku: async () => {
      haikuCalls++;
      const text = haikuCalls <= 2 ? JSON.stringify({ classification: 'lien-waiver', confidence: 0.97 }) : extractionText;
      return { text, usage: { input_tokens: 1, output_tokens: 1 } };
    },
  } };
  require.cache[ocrPath] = { id: ocrPath, filename: ocrPath, loaded: true, exports: {
    collectImageText: () => ({ text: '', ocrApplied: false }),
    collectPdfText: () => ({ text: '', ocrApplied: false }),
  } };
  const execSync = (command) => {
    if (command.includes('identify ')) return Buffer.from('2\n');
    const outputPath = command.match(/"([^"\n]+\.png)"\s*$/)?.[1];
    if (outputPath) fs.writeFileSync(outputPath, Buffer.alloc(16_000, 1));
    return Buffer.alloc(0);
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'child_process') return { ...childProcess, execSync };
    return originalLoad.call(this, request, parent, isMain);
  };
  const pool = createPipelinePool();
  const autoLinkCalls = [];
  try {
    const result = await withPipelinePool(pool, ({ runPipeline }) => runPipeline({
      postProcess: false,
      dependencies: pipelineDependencies({
        emails: [email('message-northwind-waivers')],
        attachments: [{ filename: path.basename(filePath), path: filePath, size: 16_000 }],
        autoLinkWaiver: async (waiver) => { autoLinkCalls.push(waiver.id); },
      }),
    }));
    return { result, pool, autoLinkCalls, haikuCalls };
  } finally {
    Module._load = originalLoad;
    for (const [p, cached] of before) {
      if (cached) require.cache[p] = cached;
      else delete require.cache[p];
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('runPipeline ingests a multi-waiver PDF as a flagged lien-waiver with blank details, not an error', async () => {
  const { result, pool, autoLinkCalls, haikuCalls } = await runPipelineWithWaiverPdf(
    JSON.stringify([waiverReply('CD-101'), waiverReply('CD-102')], null, 2)
  );

  assert.equal(haikuCalls, 3);
  assert.equal(result.errors, 0);
  assert.equal(pool.state.commits, 1);
  assert.equal(pool.state.documents.length, 1);
  const doc = pool.state.documents[0];
  assert.equal(doc.classification, 'lien-waiver');
  assert.equal(doc.flagged, true);
  assert.equal(doc.notes, DETAILS_UNREADABLE_NOTE);
  assert.equal(doc.flagged_at, doc.queued_at);
  assert.ok(doc.flagged_at);
  assert.equal(doc.flagged_by, 'pipeline');
  assert.equal(doc.flag_reason, DETAILS_UNREADABLE_NOTE);
  assert.deepEqual(autoLinkCalls, []);
});

test('runPipeline ingests a normal single waiver unflagged and still auto-links it', async () => {
  const { result, pool, autoLinkCalls } = await runPipelineWithWaiverPdf(JSON.stringify(waiverReply('CD-101')));

  assert.equal(result.errors, 0);
  assert.equal(pool.state.documents.length, 1);
  const doc = pool.state.documents[0];
  assert.equal(doc.classification, 'lien-waiver');
  assert.equal(doc.flagged, false);
  assert.equal(doc.flagged_at, null);
  assert.equal(doc.flagged_by, null);
  assert.equal(doc.flag_reason, null);
  assert.deepEqual(autoLinkCalls, [doc.id]);
});

function incomingEmailDir(id) {
  const safeId = id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
  return path.resolve(__dirname, '../../modules/invoices/data/incoming', safeId);
}

function imageAttachment(id, name, size, isInline = false) {
  const content = Buffer.alloc(size);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(content);
  return {
    id,
    name,
    contentType: 'image/png',
    size,
    isInline,
    '@odata.type': '#microsoft.graph.fileAttachment',
    contentBytes: content.toString('base64'),
  };
}

async function runGraphBackedPipeline({ id, graph, pool = createPipelinePool(), classifyAndExtract, childProcess, docConvert }) {
  try {
    const result = await withPipelinePool(pool, ({ runPipeline }) => runPipeline({
      postProcess: false,
      dependencies: {
        fetchEmailList: async () => [email(id)],
        divertInboundEmail: async () => ({ action: 'normal' }),
        classifyAndExtract,
        getQueueCount: async () => 0,
      },
    }), { graph, childProcess, docConvert });
    return { result, pool };
  } finally {
    fs.rmSync(incomingEmailDir(id), { recursive: true, force: true });
  }
}

test('TC-27b exhausted download retries create one body placeholder without a fourth Graph call', async () => {
  const id = 'tc27b-exhausted-download';
  const pool = createPipelinePool({ exhaustedError: {
    retry_count: 3, max_retries: 3, error_stage: 'download', error_message: 'Graph unavailable',
  } });
  let attachmentCalls = 3;
  const graph = {
    async graphFetch(url) {
      if (url.endsWith(`/messages/${id}/attachments`)) {
        attachmentCalls++;
        throw new Error('synthetic Graph failure');
      }
      return { value: [] };
    },
  };

  try {
    const result = await withPipelinePool(pool, ({ runPipeline }) => runPipeline({
      postProcess: false,
      dependencies: {
        fetchEmailList: async () => [email(id)],
        divertInboundEmail: async () => ({ action: 'normal' }),
        getQueueCount: async () => 0,
      },
    }), { graph });

    assert.equal(attachmentCalls, 3);
    assert.equal(result.errors, 0);
    assert.equal(result.queued, 1);
    assert.equal(pool.state.commits, 1);
    assert.equal(pool.state.documents.length, 1);
    assert.equal(pool.state.documents[0].classification, 'no-attachment');
    assert.equal(pool.state.documents[0].email_body, 'Please process');
    assert.equal(pool.state.processed.has(id), true);
  } finally {
    fs.rmSync(incomingEmailDir(id), { recursive: true, force: true });
  }
});

test('exhausted classification errors do not create a download body placeholder', async () => {
  const id = 'exhausted-classification-empty';
  const pool = createPipelinePool({ exhaustedError: {
    retry_count: 3, max_retries: 3, error_stage: 'classification', error_message: 'synthetic classifier failure',
  } });
  let graphCalls = 0;
  const graph = { async graphFetch(url) {
    if (url.endsWith(`/messages/${id}/attachments`)) {
      graphCalls++;
      return { value: [] };
    }
    return { value: [] };
  } };
  const { result } = await runGraphBackedPipeline({ id, graph, pool });
  assert.equal(graphCalls, 1);
  assert.equal(result.errors, 1);
  assert.equal(result.queued, 0);
  assert.equal(pool.state.rollbacks, 1);
  assert.equal(pool.state.commits, 0);
  assert.equal(pool.state.documents.length, 0);
  assert.equal(pool.state.processed.has(id), false);
});

test('TC-22 inline PNG at 14,999 bytes is skipped before classification without retry', async () => {
  const id = 'tc22-inline-14999';
  let graphCalls = 0;
  let classifierCalls = 0;
  const graph = { async graphFetch(url) {
    if (url.endsWith(`/messages/${id}/attachments`)) {
      graphCalls++;
      return { value: [imageAttachment('att-inline-14999', 'receipt-inline.png', 14999, true)] };
    }
    return { value: [] };
  } };
  const { result, pool } = await runGraphBackedPipeline({ id, graph, classifyAndExtract: async () => {
    classifierCalls++;
    return { classification: 'invoice', confidence: 1 };
  } });
  assert.equal(graphCalls, 1);
  assert.equal(classifierCalls, 0);
  assert.equal(result.errors, 0);
  assert.equal(pool.state.pipelineErrors.length, 0);
  assert.equal(pool.state.documents.length, 1);
  assert.equal(pool.state.documents[0].classification, 'no-attachment');
  assert.equal(pool.state.processed.has(id), true);
});

test('TC-24 non-inline PNG at 4 KB is prefiltered before classification without retry', async () => {
  const id = 'tc24-non-inline-4kb';
  let graphCalls = 0;
  let classifierCalls = 0;
  const graph = { async graphFetch(url) {
    if (url.endsWith(`/messages/${id}/attachments`)) {
      graphCalls++;
      return { value: [imageAttachment('att-small-png', 'receipt.png', 4096)] };
    }
    return { value: [] };
  } };
  const { result, pool } = await runGraphBackedPipeline({ id, graph, classifyAndExtract: async () => {
    classifierCalls++;
    return { classification: 'invoice', confidence: 1 };
  } });
  assert.equal(graphCalls, 1);
  assert.equal(classifierCalls, 0);
  assert.equal(result.errors, 0);
  assert.equal(pool.state.pipelineErrors.length, 0);
  assert.equal(pool.state.documents.length, 1);
  assert.equal(pool.state.documents[0].classification, 'all-skipped');
  assert.equal(pool.state.processed.has(id), true);
});

test('TC-25 itemAttachment .eml is not a real file and processes without retry', async () => {
  const id = 'tc25-item-attachment-eml';
  let graphCalls = 0;
  let classifierCalls = 0;
  const graph = { async graphFetch(url) {
    if (url.endsWith(`/messages/${id}/attachments`)) {
      graphCalls++;
      return { value: [{
        id: 'att-eml',
        name: 'forwarded-message.eml',
        size: 8192,
        contentType: 'message/rfc822',
        isInline: false,
        '@odata.type': '#microsoft.graph.itemAttachment',
        item: { subject: 'Forwarded message', body: { contentType: 'text', content: 'synthetic' } },
      }] };
    }
    return { value: [] };
  } };
  const { result, pool } = await runGraphBackedPipeline({ id, graph, classifyAndExtract: async () => {
    classifierCalls++;
    return { classification: 'invoice', confidence: 1 };
  } });
  assert.equal(graphCalls, 1);
  assert.equal(classifierCalls, 0);
  assert.equal(result.errors, 0);
  assert.equal(pool.state.pipelineErrors.length, 0);
  assert.equal(pool.state.documents.length, 1);
  assert.equal(pool.state.documents[0].classification, 'no-attachment');
  assert.equal(pool.state.processed.has(id), true);
});

test('TC-26 failed Word conversion keeps the original attachment ingestible', async () => {
  const id = 'tc26-word-conversion';
  let graphCalls = 0;
  const content = Buffer.from('PK\x03\x04synthetic word document');
  const graph = { async graphFetch(url) {
    if (url.endsWith(`/messages/${id}/attachments`)) {
      graphCalls++;
      return { value: [{ id: 'att-word', name: 'invoice.docx', size: content.length,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        isInline: false, '@odata.type': '#microsoft.graph.fileAttachment', contentBytes: content.toString('base64') }] };
    }
    return { value: [] };
  } };
  const docConvert = { isWordDoc: (filePath) => /\.docx?$/i.test(filePath), convertToPdf: () => { throw new Error('synthetic conversion failure'); } };
  let classifierFile = null;
  let classifierSawOriginal = false;
  const { result, pool } = await runGraphBackedPipeline({ id, graph, docConvert, classifyAndExtract: async (filePath) => {
    classifierFile = filePath;
    classifierSawOriginal = fs.existsSync(filePath);
    return { classification: 'unsupported', reason: 'unsupported docx' };
  } });
  assert.equal(graphCalls, 1);
  assert.match(classifierFile, /invoice\.docx$/);
  assert.equal(classifierSawOriginal, true);
  assert.equal(result.errors, 0);
  assert.equal(pool.state.documents.length, 1);
  assert.equal(pool.state.documents[0].classification, 'unsupported');
  assert.equal(pool.state.documents[0].file_name, 'invoice.docx');
  assert.equal(pool.state.processed.has(id), true);
});

test('TC-27 Graph download failures are reported without persisting or processing the email', async () => {
  const id = 'tc27-download-failure';
  let graphCalls = 0;
  const graph = { async graphFetch(url) {
    if (url.endsWith(`/messages/${id}/attachments`)) { graphCalls++; throw new Error('synthetic Graph outage'); }
    return { value: [] };
  } };
  const { result, pool } = await runGraphBackedPipeline({ id, graph });
  assert.equal(graphCalls, 1);
  assert.equal(result.errors, 1);
  assert.equal(pool.state.documents.length, 0);
  assert.equal(pool.state.processed.has(id), false);
  assert.equal(pool.state.pipelineErrors[0].error_stage, 'download');
});

test('downloadAttachments reports Graph/write failure and retains Graph attachment metadata', async () => {
  const emailDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-download-contract-'));
  const content = Buffer.from('%PDF-1.4 synthetic attachment');
  const inlineContent = Buffer.alloc(20000);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(inlineContent);
  const graph = { graphFetch: async () => ({ value: [
    { id: 'att-contract', name: 'invoice.pdf', size: content.length,
      contentType: 'application/pdf', isInline: false, '@odata.type': '#microsoft.graph.fileAttachment',
      contentBytes: content.toString('base64') },
    { id: 'att-inline', name: 'receipt.png', size: inlineContent.length,
      contentType: 'image/png', isInline: true, '@odata.type': '#microsoft.graph.fileAttachment',
      contentBytes: inlineContent.toString('base64') },
  ] }) };
  const pool = createPipelinePool();
  try {
    await withPipelinePool(pool, async ({ downloadAttachments }) => {
      const result = await downloadAttachments('message-contract', emailDir);
      assert.equal(result.failed, false);
      assert.equal(result.error, null);
      assert.equal(result.files.length, 2);
      assert.equal(result.inlineRescued, 1);
      assert.equal(result.files[0].attachmentId, 'att-contract');
      assert.equal(result.files[0].isInline, false);
      assert.equal(result.files[1].attachmentId, 'att-inline');
      assert.equal(result.files[1].isInline, true);

      const originalWrite = fs.writeFileSync;
      fs.writeFileSync = (filePath, ...args) => filePath === path.join(emailDir, 'invoice.pdf')
        ? (() => { throw new Error('synthetic disk full'); })()
        : originalWrite.call(fs, filePath, ...args);
      try {
        const failed = await downloadAttachments('message-contract', emailDir);
        assert.equal(failed.failed, true);
        assert.match(failed.error, /synthetic disk full/);
        assert.deepEqual(failed.files, []);
      } finally {
        fs.writeFileSync = originalWrite;
      }
    }, { graph });
  } finally {
    fs.rmSync(emailDir, { recursive: true, force: true });
  }
});

test('Graph attachments with identical names keep separate bytes and source identities', async () => {
  const id = 'same-name-attachments';
  const firstBytes = Buffer.from('%PDF-1.4\nfirst-attachment-content\n%%EOF');
  const secondBytes = Buffer.from('%PDF-1.4\nsecond-attachment-content\n%%EOF');
  const graph = { graphFetch: async url => url.endsWith(`/messages/${id}/attachments`) ? ({ value: [
    { id: 'attachment-first', name: 'invoice?.pdf', size: firstBytes.length, contentType: 'application/pdf',
      isInline: false, '@odata.type': '#microsoft.graph.fileAttachment', contentBytes: firstBytes.toString('base64') },
    { id: 'attachment-second', name: 'invoice?.pdf', size: secondBytes.length, contentType: 'application/pdf',
      isInline: false, '@odata.type': '#microsoft.graph.fileAttachment', contentBytes: secondBytes.toString('base64') },
  ] }) : ({ value: [] }) };
  const classified = [];
  const { result, pool } = await runGraphBackedPipeline({ id, graph, classifyAndExtract: async filePath => {
    const content = fs.readFileSync(filePath).toString();
    classified.push({ filePath, content });
    return { classification: content.includes('first-attachment') ? 'receipt' : 'building-permit', confidence: 0.95 };
  } });

  assert.equal(result.errors, 0);
  assert.equal(classified.length, 2);
  assert.notEqual(classified[0].filePath, classified[1].filePath);
  assert.deepEqual(classified.map(item => item.content), [firstBytes.toString(), secondBytes.toString()]);
  assert.deepEqual(pool.state.documents.map(doc => doc.classification), ['receipt', 'building-permit']);
  assert.deepEqual(pool.state.documents.map(doc => doc.source_attachment_id), ['attachment-first', 'attachment-second']);
});

for (const order of [
  { name: 'Word-before-PDF', types: ['word', 'pdf'] },
  { name: 'PDF-before-Word', types: ['pdf', 'word'] },
]) test(`${order.name} conversion output collision keeps each attachment's bytes and identity`, async () => {
  const id = `word-pdf-collision-${order.name}`;
  const wordBytes = Buffer.from('synthetic Word source bytes');
  const pdfBytes = Buffer.from('%PDF-1.4 synthetic original PDF bytes');
  const convertedWord = Buffer.concat([Buffer.from('converted Word output: '), wordBytes]);
  const byType = {
    word: { id: 'attachment-word', name: 'invoice.doc', contentType: 'application/msword', bytes: wordBytes },
    pdf: { id: 'attachment-pdf', name: 'invoice.pdf', contentType: 'application/pdf', bytes: pdfBytes },
  };
  const attachments = order.types.map(type => {
    const item = byType[type];
    return { id: item.id, name: item.name, size: item.bytes.length, contentType: item.contentType,
      isInline: false, '@odata.type': '#microsoft.graph.fileAttachment', contentBytes: item.bytes.toString('base64') };
  });
  const graph = { graphFetch: async url => url.endsWith(`/messages/${id}/attachments`) ? ({ value: attachments }) : ({ value: [] }) };
  const docConvert = {
    isWordDoc: filePath => /\.docx?$/i.test(filePath),
    convertToPdf: sourcePath => {
      const outputPath = sourcePath.replace(/\.docx?$/i, '.pdf');
      fs.writeFileSync(outputPath, Buffer.concat([Buffer.from('converted Word output: '), fs.readFileSync(sourcePath)]));
      fs.rmSync(sourcePath, { force: true });
      return outputPath;
    },
  };
  const classified = [];
  const expectedContents = order.types.map(type => type === 'word' ? convertedWord.toString() : pdfBytes.toString());
  const { result, pool } = await runGraphBackedPipeline({ id, graph, docConvert,
    classifyAndExtract: async filePath => {
      const content = fs.readFileSync(filePath).toString();
      classified.push({ filePath, content });
      return { classification: content.startsWith('converted Word output:') ? 'receipt' : 'building-permit' };
    } });

  assert.equal(result.errors, 0);
  assert.deepEqual(classified.map(item => item.content), expectedContents);
  assert.notEqual(classified[0].filePath, classified[1].filePath);
  assert.deepEqual(pool.state.documents.map(doc => doc.source_attachment_id), order.types.map(type => byType[type].id));
});

test('downloadAttachments treats a successful inline-only skip as zero files without failure', async () => {
  const emailDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-inline-only-'));
  const graph = { graphFetch: async () => ({ value: [imageAttachment('att-inline-small', 'logo.png', 1000, true)] }) };
  try {
    await withPipelinePool(createPipelinePool(), async ({ downloadAttachments }) => {
      const result = await downloadAttachments('message-inline-only', emailDir);
      assert.deepEqual(result.files, []);
      assert.equal(result.inlineRescued, 0);
      assert.equal(result.failed, false);
      assert.equal(result.error, null);
    }, { graph });
  } finally {
    fs.rmSync(emailDir, { recursive: true, force: true });
  }
});

test('classifyAndExtract uses the shared prefilter for direct non-routing callers', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-direct-filter-'));
  const filePath = path.join(tempDir, 'image001.png');
  const content = Buffer.alloc(1000);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(content);
  fs.writeFileSync(filePath, content);
  try {
    await withPipelinePool(createPipelinePool(), async ({ classifyAndExtract }) => {
      const result = await classifyAndExtract(filePath);
      assert.equal(result.classification, 'skipped');
      assert.match(result.reason, /Too small \(1000 bytes\)/);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
