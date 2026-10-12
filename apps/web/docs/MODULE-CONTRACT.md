# Toolbox Module Contract
**The cartridge spec.** Every module plugs into the platform by following this contract.
A coding agent given this doc + the `_template` module should be able to build a new
module without asking how anything works.

**Status:** v1.0 — 2026-06-10 · **Owner:** the product owner
**Vision context:** Toolbox is platform-first. The platform owns styling, layout, auth,
permissions, data conventions, env, and observability. Modules are independent
cartridges that declare what they need and consume what the platform provides. End
state: enterprise-ready, sellable product where new modules can be vibe-coded quickly
without re-deciding anything platform-level.

---

## 1. The Golden Rules

1. **Modules never import from other modules** — except another module's `public.ts`
   (see §6). Everything else comes from `@/modules/shared/*`.
2. **Modules never re-declare design** — no hex colors, no ad-hoc radii/shadows, no
   bespoke page chrome. Tokens + primitives + patterns only. Need a new value? Add a
   token to the platform first, then consume it.
3. **All data flows through hooks** — components never fetch. Hooks wrap the shared
   API client (`shared/lib/api.ts`) via TanStack Query. Mock-vs-real data is a hook
   implementation detail (the Projects module proves this works).
4. **All access is permission-gated** — declared in the module's `permissions.ts`,
   enforced by `PermissionGate`/`usePermissions` on the frontend AND
   `requirePermission()` on the backend. Never role-check by email or name.
   (`ADMIN_EMAILS` in feature-requests is the canonical anti-pattern — see audit BE-3.)
5. **All meaningful mutations emit audit events** — declared in `events.ts`, emitted
   via `auditEmitter`. If it changes money, access, or state, it's audited.
6. **Platform changes are platform PRs** — a module task never modifies
   `shared/`, `middleware.ts`, `globals.css`, or the registries. If a module needs a
   platform capability, that's a separate, deliberate change.

## 2. Cartridge Anatomy (required files)

```
src/modules/<module-id>/
├── register.ts          ← REQUIRED. registerModule('<id>', { events, permissions })
├── permissions.ts       ← REQUIRED. Permission definitions (even if just <id>.view)
├── events.ts            ← REQUIRED. Audit event catalog (can start empty)
├── public.ts            ← OPTIONAL. The module's public API (see §6). Absent = sealed.
├── components/          ← UI, composed from shared primitives + patterns
├── hooks/               ← All data access. TanStack Query wrappers.
├── lib/                 ← Module-internal logic
├── types/               ← Module-internal types
└── mock/                ← OPTIONAL. Mock data, dynamically imported only (audit FE-2)
```

Plus one entry in `MODULE_REGISTRY` (`shared/lib/moduleRegistry.ts`): id, label, icon,
availability (`live` | `future`), permission, defaultSubmodule, children.

**Checklist for "module is registered":**
- [ ] Registry entry with permission + sidebar children
- [ ] `register.ts` imported by the platform module loader
- [ ] Permissions appear in the admin permission matrix
- [ ] Routes live under `src/app/(dashboard)/<route>/`
- [ ] Edge middleware covers the route (verify, don't assume)
- [ ] Backend routes (if any) mounted + permission-gated (see §8)

## 3. Submodules (expansion within a module)

The registry already supports this — a module is a sidebar group with `children`:
`liveItem()` (built), `placeholderItem()` (coming soon page), `futureItem()` (greyed).

**Pattern for a multi-submodule module** (e.g. Accounting → AP, Credit Card Rec, Billing):
- One module id (`accounting`), one registry entry, children = submodules
- Each submodule gets its own route segment (`/invoices`, `/accounting/card-rec`,
  `/accounting/billing`), its own permission(s) (`invoices.view`, `card_rec.view`,
  `billing.view`), and its own folder under the module:
  ```
  src/modules/accounting/
  ├── register.ts / permissions.ts / events.ts   ← module-level, aggregates submodules
  ├── ap/            ← submodule (today: src/modules/invoices — see migration note)
  ├── card-rec/      ← submodule
  └── billing/       ← submodule
  ```
- Submodules follow the same anatomy as modules (components/hooks/lib/types) and the
  same isolation rule between each other — shared accounting logic lives in
  `accounting/lib/`, not cross-imported between submodules.
- Permissions stay flat strings (`card_rec.view`) — the grouping is organizational,
  not a permission hierarchy. Admin matrix groups by module via the registry.

**Migration note:** `invoices` is currently a top-level module folder mounted under the
`accounting` registry entry (AP Billing). That's fine — don't relocate it until there's
a second accounting submodule. When card-rec or billing gets built, move
`modules/invoices` → `modules/accounting/ap` in the same PR (rename-only, no logic).

## 4. Styling & Layout (platform-owned)

- **Tokens:** `src/app/globals.css` — colors, tones, radii, shadows, type scale.
  Canonical source: the Toolbox 3.0 Design System (Claude Design project) +
  `CODE_ALIGNMENT.md` from the DS handoff.
- **Primitives:** `shared/components/ui/` (shadcn) — buttons, inputs, dialogs, tables.
- **Patterns:** `shared/components/patterns/` — page-level compositions. Current:
  Field, FormSection, SaveBar. Planned (DS handoff, prop contracts written):
  MetricCard, StatGrid, DataTablePattern, DetailPage.
- **Shell:** `shared/components/layout/` — AppLayout, sidebar, top bar, command
  palette. Modules render INSIDE the shell; never modify it.
- **Page recipes** (compose, don't invent):
  | Page type | Recipe |
  |---|---|
  | Dashboard | StatGrid(MetricCards) + DataTablePattern |
  | Detail | DetailPage(hero + tabs) |
  | Form/Settings | FormSection + Field + SaveBar (+ VerticalTabs) |
  | Board/List | (extract from feature-requests when needed) |
- Fonts: Inter + JetBrains Mono (DS decision 2026-06-08). Mono for ALL identifiers
  and money — job #s, invoice #s, amounts, dates. This is the brand signature.

## 5. Data & Environment Conventions

- **API client:** `shared/lib/api.ts` only. Client-side calls hit `/api/backend/*`
  (Next proxy adds the internal secret + user headers). Never fetch directly, never
  touch the secret client-side.
- **Server state:** TanStack Query. Keys namespaced by module: `['invoices', ...]`.
- **Local state:** React state/keyed-state. No global client stores.
- **Mock data:** behind the hook layer, dynamically imported, never in prod bundle.
- **Env vars:**
  - Naming: `NEXT_PUBLIC_*` only for genuinely public values (no secrets, ever).
  - Every new var goes in `.env.example` (frontend + backend) with a one-line comment
    AND the Vercel/VPS env at deploy time. A var that isn't in `.env.example` doesn't exist.
  - Module-specific vars are prefixed: `NEXT_PUBLIC_PROJECTS_DATA`, `ESTIMATES_*`.
- **Tenant-awareness (future-proofing for sale):** anything NCG-specific — Spectrum
  endpoints, Azure tenant, branding — lives in config/env or a backend connector,
  never hardcoded in module logic. New DB tables should not preclude a future
  `tenant_id` column. Don't build multi-tenancy; just don't weld the door shut.

## 6. Inter-Module Communication (how cartridges talk)

Modules don't know about each other — but workflows cross modules (estimate → project
conversion, invoice → project costing). Three sanctioned mechanisms, in order of preference:

### 6a. Backend domain operations (the default for data transfer)
Cross-module data movement is a BACKEND concern. The frontend modules never pass data
to each other directly — they call a domain operation and the backend owns the transaction.

Example — Estimates → Projects conversion:
```
POST /api/estimates/:id/convert        (backend: modules/estimates/routes)
  → validates estimate is convertible
  → creates project row(s) (backend projects service — backend modules MAY call
    each other's service layer, that's where integration lives)
  → marks estimate converted, links estimate_id ↔ project_id
  → emits audit event 'estimate.converted'
  → returns { projectId }
Frontend estimates module then: router.push(projectRoute(projectId))
```
Rules: one transaction, idempotent (converting twice returns the same project),
audited, permission-gated (`estimates.convert`). The receiving module's frontend
needs zero changes — it just has a new row.

### 6b. `public.ts` — a module's typed public surface (frontend)
If module B's UI needs module A's types, route builders, or read hooks, module A
exports them explicitly from `src/modules/<a>/public.ts`. That file is the ONLY
cross-module import allowed, enforced by lint (§9).

```ts
// src/modules/projects/public.ts
export type { ProjectSummary } from './types/project';
export { projectRoute, projectsListRoute } from './lib/routes';
export { useProjectSummary } from './hooks/useProjectSummary';  // read-only hooks only
```
Rules: types, route builders, and READ hooks only. Never export mutations, internal
components, or stores. Small surface = stable surface. If `public.ts` doesn't exist,
the module is sealed.

### 6c. Platform events (loose coupling for reactions)
For "when X happens, Y should react" without coupling: the audit/event system is the
backbone. Event catalogs in `events.ts` are platform-visible; notification routes
(Layer 6) subscribe audiences to events. Future cross-module reactions (e.g. accounting
reacts to `project.closed`) ride this rail — backend-side, via the events table — not
via frontend module imports.

**Decision guide:** moving/creating data → 6a. Linking/displaying another module's
data → 6b. Reacting to another module's activity → 6c.

## 7. Module Lifecycle

1. **Spec** — short doc in `docs/specs/<module>/`: purpose, routes, permissions,
   events, data model, which page recipes (§4) each screen uses, any `public.ts`
   surface, any domain operations (§6a) with their contracts.
2. **Registry entry** as `future` (greyed in sidebar) → build → flip to `live`.
3. **Build** — copy `_template` (when it exists; until then, mirror feature-requests
   as the smallest complete example), follow anatomy §2.
4. **Verify** — checklist §2, lint passes (§9), tests for permission gating + the
   module's money path, `tsc --noEmit` clean.
5. **Ship** — small deploys, Vercel preview first (no staging env by design — audit FE-7).

## 8. Backend Module Contract (invoice-api)

Backend mirrors the cartridge idea: `modules/<id>/routes/`, `services/`, `scripts/`.
- Routes mounted in `server.js`, gated with `requirePermission()` from
  `middleware/permissions.js`. Auth (internal secret) is global middleware — already handled.
- Cross-module integration happens in the SERVICE layer (6a): route handlers may call
  another module's service functions. Services own transactions and idempotency.
- Every new permission string must exist in BOTH backend route gating and the frontend
  permission registry (they're matched by string).
- New tables: add via migration file (runner pending — audit BE-6.1), consider future
  `tenant_id`, always include `created_at`/`updated_at`.
- State machines (like invoice status) use atomic claim transitions
  (`UPDATE … WHERE status = 'x' RETURNING`) — never SELECT-then-act (audit BE-2).
- Mutations that matter insert `audit_events` rows server-side with the acting user
  from `x-user-email` (don't rely on the browser emitter alone — audit BE-4).

## 9. Enforcement (planned — keeps vibe-coded modules honest)

Lint rules to add (tracked as platform work):
- `no-restricted-imports`: `@/modules/<a>/*` from `@/modules/<b>/*` — except `*/public`
- Ban hex colors / arbitrary Tailwind color values outside `globals.css`
- Ban `fetch(` outside `shared/lib/api.ts`
- Ban static imports from `*/mock/*` outside the owning module's hooks (dynamic only)

Until these exist, this doc is the enforcement. Review every module PR against §1.

## 10. Related Docs
- `docs/PLATFORM-CONTEXT.md` — platform conventions (loads in every Copilot session)
- `docs/UI-IMPLEMENTATION-GUIDE.md` — full UI reference
- `docs/audits/2026-06-10-enterprise-readiness-remediation.md` — open hardening tickets
- DS handoff `CODE_ALIGNMENT.md` — design-system → code alignment work order
- Workspace `memory/reference/toolbox/{STATUS,ROADMAP,REFERENCE}.md` — project tracking
