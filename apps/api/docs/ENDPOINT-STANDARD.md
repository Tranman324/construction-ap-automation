# Endpoint Standard

Use this standard when adding or changing an API route, its service boundary, or its public response contract. It records the protections that are already shipped; it does not create new permission keys, authorization exceptions, or automatic guarantees beyond the mechanisms named below.

## Endpoint checklist

- Reuse an existing permission key and put `requirePermission('<existing key>')` in the route registration for a protected endpoint. Validate request bodies, query values, and path parameters with the established `validate(...)` middleware and schemas in `lib/schemas.js` before calling a service.
- Keep a route transport-only: parse and validate the request, authorize it, call a domain service, and map its outcome to HTTP. Do not import or require database clients from route modules or `server.js`.
- For a mutation, emit the established audit event with the acting user. Preserve existing legacy `audit_log` behavior and use `before_state`/`after_state` for undoable actions where the existing audit helpers do.
- For a list endpoint, use a strict query schema and bound `limit`/`offset` through `lib/pagination.js`. Queries and in-memory slices need deterministic ordering with a stable final tie-breaker before pagination.
- Return API failures in the canonical shape `{ error, code?, details? }`. `code` remains top-level and machine-readable; endpoint-specific metadata belongs in `details`.
- SharePoint metadata and delete work remain best effort: log failures and return the established warning without blocking the completed local transition. Explicit SharePoint filing (`POST /api/invoices/:id/file` with `uploadToSharePoint: true`, except statements) is different: upload failure leaves the locked document unchanged, returns HTTP 200 with the canonical `invoice` and `sharePoint: { uploaded: false, error }`, and emits no successful filing audit or undo action. Unfiled documents therefore stay unfiled and retryable; a previously shelved document keeps its prior state. Local-only shelving and statement filing are unchanged.
- In the same change as an endpoint or response-shape change, update `apps/api/API.md` and `apps/web/docs/specs/invoices/CONTRACTS.md` when that contract covers the endpoint. Add or extend offline behavioral coverage for the changed authorization, validation, audit, and response behavior.

## Router template

Reuse the route's existing service and schema rather than creating a new boundary pattern. A protected mutation normally follows this shape:

```js
router.post(
  '/:id/action',
  requirePermission('accounting.invoices.<existing-key>'),
  validate(actionSchema),
  async (req, res) => {
    try {
      const result = await actionService({
        id: req.params.id,
        actor: req.user,
        input: req.body,
      });
      return res.status(200).json(result);
    } catch (error) {
      return safeError(res, error, 'action');
    }
  }
);
```

Use the production route's established status, service arguments, audit helper, and response shape; the snippet is guidance, not a replacement for those contracts. Do not add a permission key or a permission exception without explicit approval.

### Deliberate exceptions

The public health route is intentionally unauthenticated. The following authenticated routes are existing, narrowly scoped authorization exceptions and are verified by the endpoint inventory:

- `POST /api/audit/events` is the SEC-01 exception: it deliberately has no `requirePermission`, but it is mounted behind `requireAuth`, validates its input, and replaces every supplied actor field with `req.user`.
- The approved feature-request landing permits authenticated list/create/vote traffic without a role grant. Its management and status-changing operations remain constrained by their existing ownership and permission checks.

These exceptions do not authorize new auth-only endpoints. The `GET /api/audit/events` read endpoint remains protected by `platform.manage_permissions`.

## Shipped enforcement and its limits

### Canonical errors: runtime emission boundary

`middleware/responseFinalizer.js` is mounted after request logging and before API routes. For every non-HEAD response with status `>= 400`, it accepts only the canonical error keys at the HTTP emission boundary. In production it repairs a nonconforming body and logs route/status/request context; in test mode it rejects the nonconforming emission before bytes are sent. It also blocks streamed error writes and preserves bodyless and successful responses.

Use `lib/response.js` (`errorBody`, `sendError`) or `middleware/errorResponse.js` (`fail`, `safeError`) to construct conventional responses, but canonicality is enforced at emission—not by a construction or call-shape scan. `tests/security/response-finalizer.test.js`, `tests/security/error-pagination.test.js`, and `tests/helpers/assertCanonicalErrorResponse.js` exercise this behavior, including dynamic and detached emitters.

### Route database boundary: standard ESLint

`apps/api/eslint.config.js` applies standard ESLint `no-restricted-imports` and `no-restricted-modules` rules to `server.js`, root routes, module route entrypoints, and nested module routes. They reject static imports/requires of `lib/db`, `pg`, and `@supabase/supabase-js`; services are the permitted database-client boundary. `npm test` runs `npm run lint` first, and `tests/security/route-import-boundary.test.js` proves direct CommonJS, normalized-path, and ES-module violations fail.

This is intentionally a static import/module boundary, not a semantic dependency proof. Dynamic imports and routes that reach a low-level service facade are review-only concerns under the explicit policy; reviewers must inspect them, but they are not an automated acceptance path. Do not add or restore a custom source scanner or walker as an invariant proof.

### Behavioral semantics

The endpoint inventory and behavioral tests protect the shipped semantics rather than merely documenting them:

- `tests/security/endpoint-gates-and-validation.test.js` inventories registered endpoints, authenticated mounts, permission gates, approved auth-only exceptions, and validation behavior.
- `tests/audit-events.static.test.js` and `tests/security/platform-audit-trail.test.js` cover actor-derived audit emission, compatibility behavior, and best-effort audit failures.
- `tests/security/error-pagination.test.js` covers canonical responder behavior, bounded pagination, strict list validation, and stable pagination ordering.
- `tests/invoices/sharepoint-filing.test.js` proves unchanged document state and retry after SharePoint upload failure, plus local completion after metadata-only warnings. `tests/invoices/undo-waiver-override.test.js` covers local rollback and warning behavior when SharePoint delete work fails.

Extend the relevant behavioral test for a changed route; do not treat this document as a substitute for exercising the actual service path.

## Pull-request review record

Complete the endpoint section of the pull-request template for a route or service change. State the permission or approved exception, audit event, validation and pagination behavior, SharePoint failure behavior where applicable, contract-document updates, and tests run. The checklist is a review record; it does not replace the runtime finalizer, ESLint boundary, or behavioral suites above.
