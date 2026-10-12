'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const MIGRATION_FILENAME_RE = /^\d{4}-\d{2}-\d{2}_[a-z0-9_]+\.sql$/;
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_MIGRATIONS_DIR = path.join(ROOT_DIR, 'migrations');

function lexMigrationSql(sql) {
  const tokens = [];

  function fail(message) {
    return { tokens, error: message };
  }

  for (let index = 0; index < sql.length;) {
    if (/\s/.test(sql[index])) {
      index += 1;
      continue;
    }

    if (sql.startsWith('--', index)) {
      const lineEnd = sql.indexOf('\n', index + 2);
      index = lineEnd === -1 ? sql.length : lineEnd + 1;
      continue;
    }

    if (sql.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) {
          depth += 1;
          index += 2;
        } else if (sql.startsWith('*/', index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth > 0) return fail('contains an unclosed block comment');
      continue;
    }

    if (sql.startsWith('*/', index)) {
      return fail('contains an unmatched block comment terminator');
    }

    if ((sql[index] === 'E' || sql[index] === 'e') && sql[index + 1] === "'") {
      return fail('contains an unsupported escape string literal');
    }

    if ((sql[index] === 'U' || sql[index] === 'u')
      && sql[index + 1] === '&' && sql[index + 2] === "'") {
      return fail('contains an unsupported Unicode escape string literal');
    }

    if (sql[index] === "'") {
      index += 1;
      let value = '';
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === "'") {
          if (sql[index + 1] === "'") {
            value += "'";
            index += 2;
          }
          else {
            index += 1;
            closed = true;
            break;
          }
        } else {
          value += sql[index];
          index += 1;
        }
      }
      if (!closed) return fail('contains an unclosed string literal');
      tokens.push({ kind: 'literal', value, quote: 'single' });
      continue;
    }

    if (sql[index] === '"') {
      index += 1;
      let value = '';
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === '"') {
          if (sql[index + 1] === '"') {
            value += '"';
            index += 2;
          } else {
            index += 1;
            closed = true;
            break;
          }
        } else {
          value += sql[index];
          index += 1;
        }
      }
      if (!closed) return fail('contains an unclosed quoted identifier');
      tokens.push({ kind: 'identifier', name: value, quoted: true });
      continue;
    }

    if (sql[index] === '$') {
      const dollarDelimiter = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (dollarDelimiter) {
        const contentStart = index + dollarDelimiter.length;
        const closeAt = sql.indexOf(dollarDelimiter, contentStart);
        if (closeAt === -1) return fail('contains an unclosed dollar-quoted literal');
        const value = sql.slice(contentStart, closeAt);
        index = closeAt + dollarDelimiter.length;
        tokens.push({ kind: 'literal', value, dollarQuoted: true });
        continue;
      }
    }

    if (/[A-Za-z_]/.test(sql[index])) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index])) index += 1;
      const raw = sql.slice(start, index);
      tokens.push({ kind: 'word', keyword: raw.toUpperCase(), name: raw.toLowerCase() });
      continue;
    }

    if (/[0-9]/.test(sql[index])) {
      const number = sql.slice(index).match(/^\d+(?:\.\d+)?/)[0];
      index += number.length;
      tokens.push({ kind: 'number', value: number });
      continue;
    }

    if (sql[index] === ';') {
      tokens.push({ kind: 'semicolon' });
    } else if (sql[index] === '(') {
      tokens.push({ kind: 'lparen' });
    } else if (sql[index] === ')') {
      tokens.push({ kind: 'rparen' });
    } else if (sql[index] === '.') {
      tokens.push({ kind: 'dot' });
    } else if (sql[index] === ',') {
      tokens.push({ kind: 'comma' });
    } else if (sql.startsWith('||', index)) {
      tokens.push({ kind: 'operator', value: '||' });
      index += 1;
    } else if (['>=', '<=', '<>', '!='].includes(sql.slice(index, index + 2))) {
      tokens.push({ kind: 'operator', value: sql.slice(index, index + 2) });
      index += 1;
    } else if (['=', '>', '<', '+', '-'].includes(sql[index])) {
      tokens.push({ kind: 'operator', value: sql[index] });
    } else {
      return fail(`contains an unsupported character: ${sql[index]}`);
    }
    index += 1;
  }

  return { tokens, error: null };
}

function splitStatements(tokens) {
  const statements = [];
  let statement = [];
  for (const token of tokens) {
    if (token.kind === 'semicolon') {
      if (statement.length) statements.push(statement);
      statement = [];
    } else {
      statement.push(token);
    }
  }
  if (statement.length) statements.push(statement);
  return statements;
}

function isKeyword(token, keyword) {
  return token?.kind === 'word' && token.keyword === keyword;
}

function isProceduralStatement(tokens) {
  if (isKeyword(tokens[0], 'DO')) return true;

  for (let index = 0; index < tokens.length; index += 1) {
    if (!isKeyword(tokens[index], 'CREATE')) continue;
    let cursor = index + 1;
    if (wordsAt(tokens, cursor, ['OR', 'REPLACE'])) cursor += 2;
    if (isKeyword(tokens[cursor], 'FUNCTION') || isKeyword(tokens[cursor], 'PROCEDURE')) {
      return true;
    }
  }
  return false;
}

const ENSURE_SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full_access ON public.schema_migrations;

DO $$
DECLARE
  trusted_roles TEXT;
BEGIN
  SELECT string_agg(format('%I', rolname), ', ')
  INTO trusted_roles
  FROM pg_roles
  WHERE rolname IN ('postgres', 'service_role');

  IF trusted_roles IS NOT NULL THEN
    EXECUTE format(
      'CREATE POLICY service_role_full_access ON public.schema_migrations FOR ALL TO %s USING (true) WITH CHECK (true)',
      trusted_roles
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.schema_migrations FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.schema_migrations FROM authenticated';
  END IF;
END $$;
`;

function loadEnvFile(env = process.env, rootDir = ROOT_DIR) {
  const envPath = path.join(rootDir, '.env');
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        if (key && !env[key]) {
          env[key] = match[2].trim();
        }
      }
    }
  } catch {
    // A .env file is optional for non-live static checks.
  }
}

function getTargetInfo(env = process.env) {
  if (env.SUPABASE_DB_URL) {
    let url;
    try {
      url = new URL(env.SUPABASE_DB_URL);
    } catch (error) {
      const err = new Error('SUPABASE_DB_URL is not a valid Postgres URL');
      err.cause = error;
      throw err;
    }

    return {
      mode: 'supabase',
      source: 'SUPABASE_DB_URL',
      host: url.hostname,
      port: url.port || '5432',
      database: decodeURIComponent(url.pathname.replace(/^\//, '') || 'postgres'),
      user: decodeURIComponent(url.username || ''),
      ssl: true,
      requiresConfirmation: true,
    };
  }

  return {
    mode: 'local',
    source: 'PG* environment variables',
    host: env.PGHOST || 'localhost',
    port: env.PGPORT || '5432',
    database: env.PGDATABASE || 'toolbox',
    user: env.PGUSER || 'toolbox',
    ssl: false,
    requiresConfirmation: false,
  };
}

function createPool(env = process.env) {
  if (env.SUPABASE_DB_URL) {
    return new Pool({
      connectionString: env.SUPABASE_DB_URL,
      // SECURITY: intentional — Supabase managed TLS
      // This managed-service compensating control preserves connectivity; it is
      // not certificate-validation closure and remains an environment check.
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
  }

  return new Pool({
    host: env.PGHOST || 'localhost',
    database: env.PGDATABASE || 'toolbox',
    user: env.PGUSER || 'toolbox',
    password: env.PGPASSWORD,
    port: parseInt(env.PGPORT || '5432', 10),
    max: 1,
  });
}

const APPROVED_COLUMN_TYPES = new Set(['TEXT', 'TIMESTAMPTZ', 'JSONB', 'BOOLEAN', 'INTEGER']);

function isUnquotedIdentifier(token) {
  return token?.kind === 'word' && /^[a-z_][a-z0-9_]*$/.test(token.name);
}

function isKind(token, kind, value) {
  return token?.kind === kind && (value === undefined || token.value === value);
}

function wordsAt(tokens, cursor, words) {
  return words.every((word, offset) => isKeyword(tokens[cursor + offset], word));
}

function containsQuotedIdentifier(tokens) {
  return tokens.some((token) => token.kind === 'identifier');
}

function splitTopLevel(tokens, delimiter = 'comma') {
  const parts = [];
  let depth = 0;
  let part = [];

  for (const token of tokens) {
    if (token.kind === 'lparen') depth += 1;
    if (token.kind === 'rparen') {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (depth === 0 && token.kind === delimiter) {
      if (part.length === 0) return null;
      parts.push(part);
      part = [];
      continue;
    }
    part.push(token);
  }

  if (depth !== 0 || part.length === 0) return null;
  parts.push(part);
  return parts;
}

function readParenthesized(tokens, cursor) {
  if (!isKind(tokens[cursor], 'lparen')) return null;
  let depth = 1;
  const start = cursor + 1;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].kind === 'lparen') depth += 1;
    if (tokens[index].kind === 'rparen') depth -= 1;
    if (depth === 0) {
      return { inner: tokens.slice(start, index), cursor: index + 1 };
    }
    if (depth < 0) return null;
  }
  return null;
}

function hasOnlySimpleIdentifiers(tokens) {
  const parts = splitTopLevel(tokens);
  return Boolean(parts && parts.length > 0 && parts.every((part) => part.length === 1 && isUnquotedIdentifier(part[0])));
}

function isAllowedDefaultExpression(tokens) {
  if (tokens.length === 1) {
    return tokens[0].kind === 'literal'
      || tokens[0].kind === 'number'
      || isKeyword(tokens[0], 'TRUE')
      || isKeyword(tokens[0], 'FALSE')
      || isKeyword(tokens[0], 'NULL');
  }
  return tokens.length === 3
    && isKeyword(tokens[0], 'NOW')
    && isKind(tokens[1], 'lparen')
    && isKind(tokens[2], 'rparen');
}

function readColumnDefinition(tokens, cursor) {
  const columnName = tokens[cursor]?.name;
  const type = tokens[cursor + 1];
  if (!isUnquotedIdentifier(tokens[cursor]) || type?.kind !== 'word'
    || !APPROVED_COLUMN_TYPES.has(type.keyword)) return null;

  cursor += 2;
  let sawNotNull = false;
  let sawDefault = false;
  let sawPrimaryKey = false;
  let sawUnique = false;
  let sawDocumentReference = false;

  while (cursor < tokens.length && tokens[cursor].kind !== 'comma') {
    if (wordsAt(tokens, cursor, ['NOT', 'NULL']) && !sawNotNull) {
      sawNotNull = true;
      cursor += 2;
      continue;
    }
    if (isKeyword(tokens[cursor], 'DEFAULT') && !sawDefault) {
      const expressionStart = cursor + 1;
      let expressionEnd = expressionStart + 1;
      if (isKeyword(tokens[expressionStart], 'NOW')) expressionEnd += 2;
      if (!isAllowedDefaultExpression(tokens.slice(expressionStart, expressionEnd))) return null;
      sawDefault = true;
      cursor = expressionEnd;
      continue;
    }
    if (wordsAt(tokens, cursor, ['PRIMARY', 'KEY']) && !sawPrimaryKey) {
      sawPrimaryKey = true;
      cursor += 2;
      continue;
    }
    if (isKeyword(tokens[cursor], 'UNIQUE') && !sawUnique) {
      sawUnique = true;
      cursor += 1;
      continue;
    }
    if (isKeyword(tokens[cursor], 'REFERENCES') && !sawDocumentReference
      && columnName === 'document_id'
      && isUnquotedIdentifier(tokens[cursor + 1]) && tokens[cursor + 1].name === 'documents') {
      const referencedColumns = readParenthesized(tokens, cursor + 2);
      if (!referencedColumns || !hasOnlySimpleIdentifiers(referencedColumns.inner)
        || referencedColumns.inner[0].name !== 'id'
        || !wordsAt(tokens, referencedColumns.cursor, ['ON', 'DELETE', 'CASCADE'])) {
        return null;
      }
      sawDocumentReference = true;
      cursor = referencedColumns.cursor + 3;
      continue;
    }
    return null;
  }

  return cursor;
}

function isApprovedCoiOverridesActiveIndex(tokens) {
  if (!wordsAt(tokens, 0, ['CREATE', 'UNIQUE', 'INDEX', 'IF', 'NOT', 'EXISTS'])
    || !isUnquotedIdentifier(tokens[6]) || tokens[6].name !== 'coi_overrides_one_active_check'
    || !isKeyword(tokens[7], 'ON') || !isUnquotedIdentifier(tokens[8]) || tokens[8].name !== 'coi_overrides') {
    return false;
  }
  const columns = readParenthesized(tokens, 9);
  const columnParts = columns && splitTopLevel(columns.inner);
  return Boolean(columns && columnParts
    && columnParts.length === 2
    && columnParts[0].length === 1 && columnParts[0][0].name === 'document_id'
    && columnParts[1].length === 1 && columnParts[1][0].name === 'check_id'
    && isKeyword(tokens[columns.cursor], 'WHERE')
    && isApprovedIndexPredicate(tokens.slice(columns.cursor + 1)));
}

function isAllowedTableConstraint(tokens) {
  const isPrimaryKey = wordsAt(tokens, 0, ['PRIMARY', 'KEY']);
  const isUnique = isKeyword(tokens[0], 'UNIQUE');
  const prefixLength = isPrimaryKey ? 2 : (isUnique ? 1 : 0);
  if (prefixLength === 0) return false;
  const names = readParenthesized(tokens, prefixLength);
  return Boolean(names && names.cursor === tokens.length && hasOnlySimpleIdentifiers(names.inner));
}

function isApprovedCreateTable(tokens) {
  if (!wordsAt(tokens, 0, ['CREATE', 'TABLE', 'IF', 'NOT', 'EXISTS']) || !isUnquotedIdentifier(tokens[5])) {
    return false;
  }
  const body = readParenthesized(tokens, 6);
  if (!body || body.cursor !== tokens.length) return false;
  const definitions = splitTopLevel(body.inner);
  if (!definitions || definitions.length === 0) return false;

  return definitions.every((definition) => (
    isAllowedTableConstraint(definition) || readColumnDefinition(definition, 0) === definition.length
  ));
}

function isApprovedIndexColumns(tokens) {
  const columns = splitTopLevel(tokens);
  return Boolean(columns && columns.length > 0 && columns.every((column) => (
    (column.length === 1 && isUnquotedIdentifier(column[0]))
    || (column.length === 2 && isUnquotedIdentifier(column[0]) && isKeyword(column[1], 'DESC'))
  )));
}

function isApprovedIndexPredicate(tokens) {
  const andAt = tokens.findIndex((token) => isKeyword(token, 'AND'));
  if (andAt > 0 && andAt < tokens.length - 1) {
    return isApprovedIndexPredicate(tokens.slice(0, andAt))
      && isApprovedIndexPredicate(tokens.slice(andAt + 1));
  }
  if (tokens.length === 3) {
    return isUnquotedIdentifier(tokens[0]) && (
      (isKeyword(tokens[1], 'IS') && isKeyword(tokens[2], 'NULL'))
      || (isKind(tokens[1], 'operator', '=')
        && (isKeyword(tokens[2], 'TRUE') || isKeyword(tokens[2], 'FALSE')
          || (tokens[2].kind === 'literal' && tokens[2].value === 'in')))
      || (isKind(tokens[1], 'operator', '>=') && tokens[2].kind === 'number')
    );
  }
  if (tokens.length === 4) {
    return isUnquotedIdentifier(tokens[0])
      && isKeyword(tokens[1], 'IS')
      && isKeyword(tokens[2], 'NOT')
      && isKeyword(tokens[3], 'NULL');
  }
  return false;
}

function isApprovedCreateIndex(tokens) {
  const unique = wordsAt(tokens, 0, ['CREATE', 'UNIQUE', 'INDEX', 'IF', 'NOT', 'EXISTS']);
  const prefixLength = unique
    ? 6
    : wordsAt(tokens, 0, ['CREATE', 'INDEX', 'IF', 'NOT', 'EXISTS']) ? 5 : 0;
  if (!prefixLength
    || !isUnquotedIdentifier(tokens[prefixLength])
    || !isKeyword(tokens[prefixLength + 1], 'ON')
    || !isUnquotedIdentifier(tokens[prefixLength + 2])) {
    return false;
  }
  const columns = readParenthesized(tokens, prefixLength + 3);
  if (!columns || !isApprovedIndexColumns(columns.inner)) return false;
  if (columns.cursor === tokens.length) return !unique;
  return isKeyword(tokens[columns.cursor], 'WHERE')
    && isApprovedIndexPredicate(tokens.slice(columns.cursor + 1));
}

function parseAlterHeader(tokens) {
  if (!wordsAt(tokens, 0, ['ALTER', 'TABLE'])) return null;
  let cursor = 2;
  if (wordsAt(tokens, cursor, ['IF', 'EXISTS'])) cursor += 2;
  if (!isUnquotedIdentifier(tokens[cursor])) return null;
  return { table: tokens[cursor].name, cursor: cursor + 1 };
}

function parseApprovedAddColumns(tokens, cursor) {
  let additions = 0;
  while (cursor < tokens.length) {
    if (!wordsAt(tokens, cursor, ['ADD', 'COLUMN', 'IF', 'NOT', 'EXISTS'])) return false;
    cursor = readColumnDefinition(tokens, cursor + 5);
    if (cursor === null) return false;
    additions += 1;
    if (cursor === tokens.length) return additions > 0;
    if (!isKind(tokens[cursor], 'comma')) return false;
    cursor += 1;
  }
  return false;
}

function parseConstraintDrop(tokens, header) {
  const cursor = header.cursor;
  if (!wordsAt(tokens, cursor, ['DROP', 'CONSTRAINT'])) return null;
  if (isKeyword(tokens[cursor + 3], 'CASCADE')) return { error: 'drops a constraint with CASCADE' };
  if (!isUnquotedIdentifier(tokens[cursor + 2]) || cursor + 3 !== tokens.length) {
    return { error: 'has a malformed dropped constraint clause' };
  }
  return { key: `${header.table}\u0000${tokens[cursor + 2].name}` };
}

function parseForeignKeyConstraintAdd(tokens, header) {
  let cursor = header.cursor;
  if (!wordsAt(tokens, cursor, ['ADD', 'CONSTRAINT']) || !isUnquotedIdentifier(tokens[cursor + 2])) return null;
  const constraintName = tokens[cursor + 2].name;
  cursor += 3;
  if (!wordsAt(tokens, cursor, ['FOREIGN', 'KEY'])) return null;
  const localColumns = readParenthesized(tokens, cursor + 2);
  if (!localColumns || !hasOnlySimpleIdentifiers(localColumns.inner)) return null;
  cursor = localColumns.cursor;
  if (!isKeyword(tokens[cursor], 'REFERENCES') || !isUnquotedIdentifier(tokens[cursor + 1])) return null;
  const foreignColumns = readParenthesized(tokens, cursor + 2);
  if (!foreignColumns || !hasOnlySimpleIdentifiers(foreignColumns.inner)) return null;
  cursor = foreignColumns.cursor;
  if (!wordsAt(tokens, cursor, ['ON', 'DELETE', 'CASCADE']) || cursor + 3 !== tokens.length) return null;
  return { key: `${header.table}\u0000${constraintName}` };
}

function isApprovedColumnComment(tokens) {
  return tokens.length === 8
    && wordsAt(tokens, 0, ['COMMENT', 'ON', 'COLUMN'])
    && isUnquotedIdentifier(tokens[3])
    && isKind(tokens[4], 'dot')
    && isUnquotedIdentifier(tokens[5])
    && isKeyword(tokens[6], 'IS')
    && tokens[7].kind === 'literal';
}

function policyKey(table, policy) {
  return `${table}\u0000${policy}`;
}

function parsePolicyDrop(tokens) {
  if (!wordsAt(tokens, 0, ['DROP', 'POLICY', 'IF', 'EXISTS'])
    || !isUnquotedIdentifier(tokens[4])
    || !isKeyword(tokens[5], 'ON')
    || !isUnquotedIdentifier(tokens[6])
    || tokens.length !== 7) {
    return null;
  }
  return { key: policyKey(tokens[6].name, tokens[4].name) };
}

function parsePolicyCreate(tokens) {
  if (tokens.length !== 20
    || !wordsAt(tokens, 0, ['CREATE', 'POLICY'])
    || !isUnquotedIdentifier(tokens[2])
    || !isKeyword(tokens[3], 'ON')
    || !isUnquotedIdentifier(tokens[4])
    || !wordsAt(tokens, 5, ['FOR', 'ALL', 'TO'])
    || !isKeyword(tokens[8], 'POSTGRES')
    || !isKind(tokens[9], 'comma')
    || !isKeyword(tokens[10], 'SERVICE_ROLE')
    || !isKeyword(tokens[11], 'USING')
    || !isKind(tokens[12], 'lparen')
    || !isKeyword(tokens[13], 'TRUE')
    || !isKind(tokens[14], 'rparen')
    || !wordsAt(tokens, 15, ['WITH', 'CHECK'])
    || !isKind(tokens[17], 'lparen')
    || !isKeyword(tokens[18], 'TRUE')
    || !isKind(tokens[19], 'rparen')) {
    return null;
  }
  return { key: policyKey(tokens[4].name, tokens[2].name) };
}

function migrationTokenSignature(tokens) {
  return tokens.map((token) => {
    if (token.kind === 'word') return `word:${token.keyword}`;
    if (token.kind === 'literal') return `literal:${JSON.stringify(token.value)}`;
    if (token.kind === 'number') return `number:${token.value}`;
    if (token.kind === 'operator') return `operator:${token.value}`;
    return token.kind;
  }).join(' ');
}

function allowedUpdateSignature(sql) {
  const lexed = lexMigrationSql(sql);
  if (lexed.error) throw new Error(`Invalid approved UPDATE signature: ${lexed.error}`);
  return migrationTokenSignature(lexed.tokens);
}

function allowedInsertSignature(sql) {
  const lexed = lexMigrationSql(sql);
  if (lexed.error) throw new Error(`Invalid approved INSERT signature: ${lexed.error}`);
  const statements = splitStatements(lexed.tokens);
  if (statements.length !== 1) throw new Error('Approved INSERT signature must contain exactly one statement');
  return migrationTokenSignature(statements[0]);
}

// Each INSERT is a normalized statement signature from the approved migration corpus.
// This deliberately permits no arbitrary expressions, function calls, subqueries, or joins.
const APPROVED_INSERT_SIGNATURES = new Set([
  `INSERT INTO permissions (key, module, description, created_at)
   VALUES
     ('feature_requests.manage', 'feature_requests', 'Manage feature request status and deletion', NOW()),
     ('invoices.permanent_delete', 'invoices', 'Permanently delete invoice records', NOW())
   ON CONFLICT (key) DO UPDATE
   SET module = EXCLUDED.module, description = EXCLUDED.description`,
  `INSERT INTO role_permissions (role_id, permission_key, granted)
   SELECT roles.id, permission_keys.permission_key, TRUE
   FROM roles
   CROSS JOIN (
     VALUES ('feature_requests.manage'), ('invoices.permanent_delete')
   ) AS permission_keys(permission_key)
   WHERE roles.name = 'admin'
   ON CONFLICT (role_id, permission_key) DO UPDATE
   SET granted = EXCLUDED.granted`,
  `INSERT INTO permissions (key, module, description, created_at)
   VALUES ('invoices.manage_rules', 'invoices', 'Manage and apply invoice automation rules', NOW())
   ON CONFLICT (key) DO UPDATE
   SET module = EXCLUDED.module, description = EXCLUDED.description`,
  `INSERT INTO role_permissions (role_id, permission_key, granted)
   SELECT roles.id, 'invoices.manage_rules', TRUE
   FROM roles
   WHERE roles.name = 'admin'
   ON CONFLICT (role_id, permission_key) DO UPDATE
   SET granted = EXCLUDED.granted`,
  `INSERT INTO permissions (key, module, description, created_at)
   VALUES ('accounting.invoices.manage_classifications', 'accounting', 'Create, update, and delete document classification types', NOW())
   ON CONFLICT (key) DO NOTHING`,
  `INSERT INTO role_permissions (role_id, permission_key, granted)
   SELECT roles.id, 'accounting.invoices.manage_classifications', TRUE
   FROM roles
   WHERE roles.name = 'admin'
   ON CONFLICT (role_id, permission_key) DO UPDATE
   SET granted = TRUE`,
  `INSERT INTO permissions (key, module, description)
   VALUES ('accounting.invoices.submit_spectrum', 'invoices', 'Upload COI documents to Spectrum ERP')
   ON CONFLICT (key) DO NOTHING`,
  `INSERT INTO role_permissions (role_id, permission_key)
   SELECT r.id, 'accounting.invoices.submit_spectrum'
   FROM roles r
   WHERE r.name = 'admin' AND r.is_system = true
   ON CONFLICT DO NOTHING`,
  `INSERT INTO permissions (key, module, description, created_at)
   VALUES ('accounting.invoices.request_waiver', 'invoices', 'Send lien waiver request emails to vendors via Graph reply-on-thread', NOW())
   ON CONFLICT (key) DO UPDATE
   SET module = EXCLUDED.module, description = EXCLUDED.description`,
  `INSERT INTO role_permissions (role_id, permission_key, granted)
   SELECT roles.id, 'accounting.invoices.request_waiver', TRUE
   FROM roles
   WHERE roles.name = 'admin'
   ON CONFLICT (role_id, permission_key) DO UPDATE
   SET granted = EXCLUDED.granted`,
  `INSERT INTO permissions (key, module, description, created_at)
   VALUES
     ('accounting.invoices.coi_override', 'accounting', 'Apply and revoke COI compliance overrides', NOW()),
     ('accounting.invoices.manage_settings', 'accounting', 'Manage invoice compliance settings', NOW())
   ON CONFLICT (key) DO UPDATE
   SET module = EXCLUDED.module, description = EXCLUDED.description`,
  `INSERT INTO role_permissions (role_id, permission_key, granted)
   VALUES
     ('6ae067e6-6b6c-44f1-8765-9b745e21e7e5', 'accounting.invoices.coi_override', TRUE),
     ('0782c7ec-4f29-4f0b-8a19-277ab6aa4b86', 'accounting.invoices.coi_override', TRUE)
   ON CONFLICT (role_id, permission_key) DO UPDATE
   SET granted = EXCLUDED.granted`,
].map(allowedInsertSignature));

function isApprovedInsert(tokens) {
  return APPROVED_INSERT_SIGNATURES.has(migrationTokenSignature(tokens));
}

function isApprovedCoiConfigVersionsBackfill(tokens) {
  return APPROVED_COI_CONFIG_VERSION_SIGNATURES.has(migrationTokenSignature(tokens));
}
function isApprovedCoiConfigVersionsIndex(tokens) {
  return APPROVED_COI_CONFIG_VERSION_SIGNATURES.has(migrationTokenSignature(tokens));
}

function isApprovedDocumentDestinationVersionsStatement(tokens) {
  return APPROVED_DOCUMENT_DESTINATION_VERSION_SIGNATURES.has(migrationTokenSignature(tokens));
}

const APPROVED_COI_CONFIG_VERSION_SIGNATURES = new Set([
  `CREATE TABLE IF NOT EXISTS coi_config_versions (id TEXT PRIMARY KEY, version INTEGER NOT NULL, effective_from TIMESTAMPTZ NOT NULL, config JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), author TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS coi_config_versions_version_key ON coi_config_versions (version)`,
  `CREATE INDEX IF NOT EXISTS coi_config_versions_effective_order ON coi_config_versions (effective_from DESC, created_at DESC, id DESC)`,
  `INSERT INTO coi_config_versions (id, version, effective_from, config, created_at, author) SELECT 'v1', 1, COALESCE(updated_at, NOW()), config, COALESCE(updated_at, NOW()), COALESCE(updated_by, 'seed') FROM coi_compliance_config WHERE id = 1 ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO coi_config_versions (id, version, effective_from, config, created_at, author) SELECT 'v2-exhibit-e', 2, NOW(), CAST('{"certificateHolder":{"name":"Northwind Contracting Group Inc.","nameAliases":["northwind contracting group","northwind contracting group inc","northwind contracting group inc.","northwind contracting group, inc.","ncg"],"address":"500 Example Gateway, Suite 180, Springfield, GA 30000"},"cancellationNoticeMinimumDays":30,"warnWindowDays":30,"carrierRating":{"minRating":"A-","minFsc":"VII"},"coverageRequirements":[{"type":"general-liability","label":"Commercial General Liability","required":true,"limits":[{"key":"eachOccurrence","label":"Each Occurrence","minimum":1000000},{"key":"generalAggregate","label":"General Aggregate","minimum":2000000},{"key":"productsCompOps","label":"Products-Comp/Op Agg","minimum":2000000},{"key":"damageToRented","label":"Damage to Rented Premises","minimum":50000,"tier":"exception"},{"key":"medicalExpense","label":"Medical Expense","minimum":5000,"tier":"exception"},{"key":"personalAdvInjury","label":"Personal & Adv Injury","minimum":1000000}]},{"type":"automobile","label":"Automobile Liability","required":true,"limits":[{"key":"combinedSingleLimit","label":"Combined Single Limit","minimum":1000000}]},{"type":"umbrella","label":"Umbrella / Excess Liability","required":true,"limits":[{"key":"eachOccurrence","label":"Each Occurrence","minimum":2000000},{"key":"aggregate","label":"Aggregate","minimum":2000000}]},{"type":"workers-comp","label":"Workers Compensation","required":true,"limits":[{"key":"eachAccident","label":"Each Accident","minimum":500000},{"key":"diseaseEachEmployee","label":"Disease - Each Employee","minimum":500000},{"key":"diseasePolicyLimit","label":"Disease - Policy Limit","minimum":500000}]},{"type":"professional","label":"Professional Liability","required":false,"limits":[{"key":"eachLoss","label":"Each Loss","minimum":1000000},{"key":"aggregate","label":"Aggregate","minimum":2000000}]},{"type":"pollution","label":"Pollution Liability","required":false,"limits":[{"key":"eachLoss","label":"Each Loss","minimum":1000000},{"key":"aggregate","label":"Aggregate","minimum":2000000}]}],"coverageTypeAliases":{"general-liability":"general-liability","general liability":"general-liability","commercial general liability":"general-liability","cgl":"general-liability","gl":"general-liability","automobile":"automobile","auto":"automobile","auto liability":"automobile","automobile liability":"automobile","commercial auto":"automobile","umbrella":"umbrella","excess":"umbrella","umbrella / excess":"umbrella","umbrella/excess":"umbrella","excess liability":"umbrella","umbrella liability":"umbrella","workers-comp":"workers-comp","workers comp":"workers-comp","workers compensation":"workers-comp","workers'' compensation":"workers-comp","wc":"workers-comp","professional":"professional","professional liability":"professional","e&o":"professional","errors and omissions":"professional","pollution":"pollution","pollution liability":"pollution","contractors pollution":"pollution","contractors pollution liability":"pollution"}}' AS JSONB), NOW(), 'exhibit-e-alignment' ON CONFLICT (id) DO NOTHING`,
].map(allowedInsertSignature));

const APPROVED_DOCUMENT_DESTINATION_VERSION_SIGNATURES = new Set([
  `CREATE TABLE IF NOT EXISTS document_destination_versions (id TEXT PRIMARY KEY, version INTEGER NOT NULL, effective_from TIMESTAMPTZ NOT NULL, config JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), author TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS document_destination_versions_version_key ON document_destination_versions (version)`,
  `CREATE INDEX IF NOT EXISTS document_destination_versions_effective_order ON document_destination_versions (effective_from DESC, created_at DESC, id DESC)`,
  `INSERT INTO document_destination_versions (id, version, effective_from, config, created_at, author) SELECT 'v1', 1, COALESCE(updated_at, NOW()), config, COALESCE(updated_at, NOW()), COALESCE(updated_by, 'seed') FROM document_destinations WHERE id = 1 ON CONFLICT (id) DO NOTHING`,
].map(allowedInsertSignature));

const APPROVED_UPDATE_SIGNATURES = new Set([
  `UPDATE permissions
   SET key = 'accounting.' || key, module = 'accounting'
   WHERE key LIKE 'invoices.%' AND key NOT LIKE 'accounting.%'`,
  `UPDATE role_permissions
   SET permission_key = 'accounting.' || permission_key
   WHERE permission_key LIKE 'invoices.%' AND permission_key NOT LIKE 'accounting.%'`,
  `UPDATE user_permission_overrides
   SET permission_key = 'accounting.' || permission_key
   WHERE permission_key LIKE 'invoices.%' AND permission_key NOT LIKE 'accounting.%'`,
  `UPDATE documents
   SET waiver_on_document = true,
       waiver_on_document_at = NOW(),
       waiver_on_document_by = 'grandfathered-pre-gate-2026-07-14',
       updated_at = NOW()
   WHERE classification IN ('invoice', 'pay-application')
     AND status = 'approved'
     AND lien_waiver_required = true
     AND linked_lien_waiver_id IS NULL
     AND waiver_on_document IS NOT TRUE`,
  `UPDATE toolbox_users
   SET role_version = role_version + 1
   WHERE role_id IN ('6ae067e6-6b6c-44f1-8765-9b745e21e7e5', '0782c7ec-4f29-4f0b-8a19-277ab6aa4b86')`,
  `UPDATE documents
   SET flagged_at = COALESCE(flagged_at, NOW()),
       flagged_by = COALESCE(flagged_by, 'migration:retire-needs-review'),
       flag_reason = COALESCE(flag_reason, 'Migrated from retired needs-review status'),
       status = 'pending',
       updated_at = NOW()
   WHERE status IN ('needs_review', 'needs-review')
     AND deleted_at IS NULL`,
].map(allowedUpdateSignature));

function isApprovedGuardedUpdate(tokens) {
  return APPROVED_UPDATE_SIGNATURES.has(migrationTokenSignature(tokens));
}

function classifyMigrationSql(sql) {
  const lexed = lexMigrationSql(sql);
  const reasons = [];
  if (lexed.error) {
    reasons.push(lexed.error);
  } else {
    const statements = splitStatements(lexed.tokens);
    const droppedConstraints = new Map();
    const addedConstraints = new Map();
    const droppedPolicies = new Map();
    const createdPolicies = new Map();

    if (statements.length === 0) reasons.push('contains no executable migration statements');

    for (const statement of statements) {
      if (containsQuotedIdentifier(statement)) {
        reasons.push('uses quoted identifiers outside the approved corpus grammar');
        continue;
      }
      if (isProceduralStatement(statement)) {
        reasons.push('contains an executable procedural SQL body requiring independent review');
        continue;
      }
      if (statement.length === 1 && (isKeyword(statement[0], 'BEGIN') || isKeyword(statement[0], 'COMMIT'))) {
        continue;
      }
      if (isApprovedCreateTable(statement) || isApprovedCreateIndex(statement)
        || isApprovedCoiOverridesActiveIndex(statement)
        || isApprovedCoiConfigVersionsBackfill(statement)
        || isApprovedCoiConfigVersionsIndex(statement)
        || isApprovedDocumentDestinationVersionsStatement(statement)
        || isApprovedColumnComment(statement) || isApprovedInsert(statement)
        || isApprovedGuardedUpdate(statement)) {
        continue;
      }

      const policyDrop = parsePolicyDrop(statement);
      if (policyDrop) {
        droppedPolicies.set(policyDrop.key, (droppedPolicies.get(policyDrop.key) || 0) + 1);
        continue;
      }
      const policyCreate = parsePolicyCreate(statement);
      if (policyCreate) {
        createdPolicies.set(policyCreate.key, (createdPolicies.get(policyCreate.key) || 0) + 1);
        continue;
      }

      const alterHeader = parseAlterHeader(statement);
      if (alterHeader) {
        if (wordsAt(statement, alterHeader.cursor, ['ENABLE', 'ROW', 'LEVEL', 'SECURITY'])
          && alterHeader.cursor + 4 === statement.length) {
          continue;
        }
        if (parseApprovedAddColumns(statement, alterHeader.cursor)) continue;
        const constraintDrop = parseConstraintDrop(statement, alterHeader);
        if (constraintDrop) {
          if (constraintDrop.error) reasons.push(constraintDrop.error);
          else droppedConstraints.set(constraintDrop.key, (droppedConstraints.get(constraintDrop.key) || 0) + 1);
          continue;
        }
        const constraintAdd = parseForeignKeyConstraintAdd(statement, alterHeader);
        if (constraintAdd) {
          addedConstraints.set(constraintAdd.key, (addedConstraints.get(constraintAdd.key) || 0) + 1);
          continue;
        }
      }

      reasons.push('contains a statement outside the approved migration allowlist');
    }

    for (const [key, count] of droppedConstraints) {
      if (addedConstraints.get(key) !== count) {
        reasons.push('drops a constraint without an exact same-table foreign-key replacement');
      }
    }
    for (const [key, count] of addedConstraints) {
      if (droppedConstraints.get(key) !== count) {
        reasons.push('adds a foreign-key constraint without an exact same-table replacement pair');
      }
    }
    for (const [key, count] of droppedPolicies) {
      if (createdPolicies.get(key) !== count) {
        reasons.push('drops a policy without an exact same-table replacement');
      }
    }
    for (const [key, count] of createdPolicies) {
      if (droppedPolicies.get(key) !== count) {
        reasons.push('creates a policy without an exact same-table replacement pair');
      }
    }
  }

  if (reasons.length > 0) {
    return {
      classification: 'mark-applied',
      safeToApplyPending: false,
      reasons: [...new Set(reasons)],
    };
  }

  return {
    classification: 'safe-rerun',
    safeToApplyPending: true,
    reasons: ['every statement matches the approved migration allowlist'],
  };
}

function listMigrationFiles(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const filenames = fs
    .readdirSync(migrationsDir)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  const invalidFilenames = filenames.filter((filename) => !MIGRATION_FILENAME_RE.test(filename));
  if (invalidFilenames.length > 0) {
    throw new Error(`Invalid migration filename(s): ${invalidFilenames.join(', ')}`);
  }

  return filenames.map((filename) => {
    const filePath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(filePath, 'utf8');
    return {
      filename,
      path: filePath,
      sql,
      safety: classifyMigrationSql(sql),
    };
  });
}

function planMigrations(migrations, appliedFilenames) {
  const applied = new Set(appliedFilenames);
  const skipped = migrations.filter((migration) => applied.has(migration.filename));
  const pending = migrations.filter((migration) => !applied.has(migration.filename));
  const blocked = pending.filter((migration) => !migration.safety.safeToApplyPending);

  return {
    skipped,
    pending,
    blocked,
    applicable: pending.filter((migration) => migration.safety.safeToApplyPending),
  };
}

function assertConfirmedForLiveMutation(command, targetInfo, options) {
  if (
    targetInfo.requiresConfirmation &&
    ['apply', 'mark-applied'].includes(command) &&
    !options.confirmTarget
  ) {
    throw new Error(
      `${command} against SUPABASE_DB_URL requires --confirm-target after reviewing the printed target facts`,
    );
  }
}

async function ensureSchemaMigrations(pool) {
  await pool.query(ENSURE_SCHEMA_MIGRATIONS_SQL);
}

async function getAppliedMigrationFilenames(pool) {
  const tableCheck = await pool.query("SELECT to_regclass('public.schema_migrations') AS table_name");
  if (!tableCheck.rows[0] || !tableCheck.rows[0].table_name) {
    return new Set();
  }

  const result = await pool.query('SELECT filename FROM public.schema_migrations ORDER BY filename');
  return new Set(result.rows.map((row) => row.filename));
}

async function markMigrationsApplied(pool, migrations, filenames, log = console.log) {
  const selected = selectMigrations(migrations, filenames);
  await ensureSchemaMigrations(pool);

  for (const migration of selected) {
    await pool.query(
      'INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
      [migration.filename],
    );
    log(`Marked ${migration.filename} as applied`);
  }

  return selected;
}

async function applyPendingMigrations(pool, migrations, log = console.log) {
  await ensureSchemaMigrations(pool);

  const applied = await getAppliedMigrationFilenames(pool);
  const plan = planMigrations(migrations, applied);

  if (plan.blocked.length > 0) {
    const details = plan.blocked
      .map((migration) => `${migration.filename}: ${migration.safety.reasons.join('; ')}`)
      .join('\n');
    throw new Error(
      `Pending migration(s) are not safe to auto-apply. Mark already-applied historical files first:\n${details}`,
    );
  }

  for (const migration of plan.applicable) {
    log(`Applying ${migration.filename}`);
    await pool.query(migration.sql);
    await pool.query(
      'INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
      [migration.filename],
    );
    log(`Applied ${migration.filename}`);
  }

  return plan;
}

function selectMigrations(migrations, filenames) {
  if (!filenames || filenames.length === 0) {
    throw new Error('No migration filenames selected');
  }

  if (filenames.includes('--all')) {
    return migrations;
  }

  const byFilename = new Map(migrations.map((migration) => [migration.filename, migration]));
  return filenames.map((filename) => {
    const migration = byFilename.get(filename);
    if (!migration) {
      throw new Error(`Unknown migration filename: ${filename}`);
    }
    return migration;
  });
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  ENSURE_SCHEMA_MIGRATIONS_SQL,
  MIGRATION_FILENAME_RE,
  applyPendingMigrations,
  assertConfirmedForLiveMutation,
  classifyMigrationSql,
  createPool,
  ensureSchemaMigrations,
  getAppliedMigrationFilenames,
  getTargetInfo,
  listMigrationFiles,
  loadEnvFile,
  markMigrationsApplied,
  planMigrations,
  selectMigrations,
};
