## Summary

Describe the user-visible change and any compatibility considerations.

## Endpoint standard (complete for API route or service changes)

- [ ] The route has a handler-level `requirePermission(...)`, or I identified an existing, explicitly approved exception and explained it below.
- [ ] The route is transport-only and does not statically import or require `lib/db`, `pg`, or `@supabase/supabase-js`; I ran the backend lint/test command.
- [ ] The mutation emits the established actor-attributed audit event and preserves required legacy audit behavior/snapshots.
- [ ] Request, path, and query validation are in place; list reads use bounded pagination and deterministic ordering where applicable.
- [ ] Error responses preserve `{ error, code?, details? }`; I did not add a construction/call-shape scanner.
- [ ] SharePoint failures remain best effort and are surfaced as warnings without blocking local state, where applicable.
- [ ] `apps/api/API.md` and `apps/web/docs/specs/invoices/CONTRACTS.md` were updated for an endpoint or response-contract change, or I explained why neither applies.
- [ ] I added or updated behavioral coverage and recorded the commands/results below.

Exception, contract, or non-applicability notes:

<!-- Explain any checked exception or N/A item. -->

## Validation

<!-- Commands run and their results. -->
