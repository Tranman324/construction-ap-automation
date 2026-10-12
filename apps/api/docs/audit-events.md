# Audit Events

The backend owns server-side `audit_events` emission for covered invoice mutations. These events are additive to the permanent legacy `audit_log` table; do not remove, migrate, or deprecate `audit_log`.

## API

- `POST /api/audit/events` inserts an authenticated caller's frontend-compatible audit event payload.
- `GET /api/audit/events` lists paginated events and is protected by `platform.manage_permissions`.

Events round-trip this shape:

```json
{
  "id": "event-id",
  "type": "invoice.approved",
  "timestamp": "2026-06-22T00:00:00.000Z",
  "actor": { "userId": "user-id-or-email", "name": "user@example.com", "role": "admin" },
  "target": { "type": "invoice", "id": "invoice-id", "label": "INV-123" },
  "changes": {},
  "summary": "Invoice approved",
  "module": "invoices",
  "severity": "info"
}
```

## Covered Server Events

The backend emits exactly one `audit_events` row after successful covered mutations, except permanent delete, which emits before deleting the source row:

- `invoice.approved`
- `invoice.unapproved`
- `invoice.rejected`
- `invoice.submitted_spectrum`
- `invoice.discarded`
- `invoice.deleted`
- `invoice.permanently_deleted`
- `invoice.restored`

## Frontend Companion Work

Server-side emission is the source of truth for the covered invoice mutations above. After backend production verification, the Toolbox frontend must disable browser-side `auditEmitter.ts` calls for those same covered mutations to avoid duplicate rows. Keep `POST /api/audit/events` mounted for future external or programmatic callers that are not already covered by server-side emission.
