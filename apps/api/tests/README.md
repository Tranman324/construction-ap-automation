# Test Strategy

`npm test` is the fast offline suite. It runs the existing `node:test` checks that do not require live Supabase, Spectrum, Box, Microsoft Graph, Anthropic, Sentry, API keys, or production network access:

- `tests/audit-events.static.test.js`
- `tests/security/permission-gates.static.test.js`
- `tests/security/permissions.test.js`
- `tests/invoices/approval-validator.test.js`
- `tests/invoices/sanitize.test.js`
- `tests/invoices/spectrum-validation.test.js`
- `tests/invoices/submit-idempotency.static.test.js`
- `tests/invoices/submit-recovery.test.js`
- `tests/invoices/submit-state.test.js`
- `tests/validate-query.test.js`

Offline tests that need behavior from external systems should mock at the service boundary. Current invoice coverage mocks the submit-state query boundary directly and stubs `modules/invoices/services/supabase.js` before loading stale-submit recovery. Future invoice coverage should keep mocking `lib/db.js`, `modules/invoices/services/supabase.js`, and `modules/invoices/services/spectrum.js` rather than opening real PostgreSQL, Supabase, MSSQL, or Spectrum REST connections.

`npm run test:platform` is intentionally separate. The suites under `tests/platform/` are live backend integration tests that call `BACKEND_URL`, require admin/internal auth environment variables, and may mutate disposable role/user state with cleanup.

`npm run test:pipeline` is also intentionally separate. It invokes `tests/run-tests.js`, which calls Anthropic for document classification/extraction regression coverage and may incur cost.

Do not print secrets, auth tokens, service-role keys, credential literals, or full sensitive payloads from any test.
