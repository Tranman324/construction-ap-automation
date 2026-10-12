# Toolbox 3.0 — UI/UX Implementation Guide

> **Purpose:** This document gives a new implementation agent full domain expertise over the Toolbox 3.0 frontend — its architecture, every component, every hook, the design system, layout mechanics, data contracts, and known issues. Read this before making any UI changes.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack & Versions](#2-tech-stack--versions)
3. [Project Structure](#3-project-structure)
4. [Design System](#4-design-system)
5. [Layout Architecture](#5-layout-architecture)
6. [Page Inventory](#6-page-inventory)
7. [Component Inventory](#7-component-inventory)
8. [Hooks & Data Layer](#8-hooks--data-layer)
9. [Type System](#9-type-system)
10. [Radix UI / shadcn Patterns](#10-radix-ui--shadcn-patterns)
11. [Data Flow & State Management](#11-data-flow--state-management)
12. [Spectrum Submit System](#12-spectrum-submit-system)
13. [Rules Engine](#13-rules-engine)
14. [Known Issues & Pending Work](#14-known-issues--pending-work)
15. [API Reference Summary](#15-api-reference-summary)
16. [Implementation Rules](#16-implementation-rules)

---

## 1. Project Overview

**Toolbox** is NCG's internal invoice-processing dashboard. Emails arrive containing invoices, receipts, lien waivers, and other documents. An AI pipeline classifies each document, extracts data (vendor, amount, job number, etc.), and matches it against Spectrum ERP reference data (vendors, jobs, subcontracts). Human reviewers then approve, correct, or discard items before submitting approved invoices to Spectrum.

**Two lanes:**
- **Invoice Queue** (`filed=false`) — Invoices, receipts, pay-applications, credit-memos being reviewed
- **Documents Shelf** (`filed=true`) — Filed support documents (lien waivers, COIs, W-9s, contracts, etc.)

**Invoice lifecycle:** `pending` → `approved` / `modified` → `submitted` (to Spectrum)

---

## 2. Tech Stack & Versions

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.1.6 |
| React | React | 19.2.3 |
| Language | TypeScript | 5.x (strict mode) |
| CSS | Tailwind CSS v4 | 4.x via `@tailwindcss/postcss` |
| UI Components | shadcn/ui (new-york style) | Radix UI primitives |
| Icons | lucide-react | 0.574.0 |
| Data Fetching | TanStack React Query | 5.90.21 |
| Tables | TanStack React Table | 8.21.3 |
| Forms | Uncontrolled local state (no form library) | — |
| Auth | NextAuth.js v4 (Azure AD) | 4.24.13 |
| Theming | next-themes | 0.4.6 (light default, no system) |
| Charts | Tremor | 3.18.7 |
| Command Palette | cmdk | 1.1.1 |
| Testing | Vitest + Testing Library | 4.x |

**Important:** This project uses **Tailwind CSS v4** (not v3). There is no `tailwind.config.js` — all theme tokens are defined as CSS custom properties in `src/app/globals.css` using `@theme inline {}`.

---

## 3. Project Structure

```
src/
├── app/
│   ├── globals.css              ← All CSS variables, theme tokens, animations
│   ├── layout.tsx               ← Root layout: fonts, ThemeProvider, Providers, AuthProvider
│   ├── login/page.tsx           ← Login page
│   ├── api/auth/                ← NextAuth API routes
│   └── (dashboard)/
│       ├── layout.tsx           ← Wraps children in AppLayout (sidebar + main)
│       ├── page.tsx             ← Dashboard home (Invoice Queue)
│       ├── error.tsx            ← Error boundary
│       ├── invoices/[id]/page.tsx ← Invoice detail (two-panel split)
│       └── documents/
│           ├── page.tsx         ← Documents Shelf
│           └── [id]/            ← Document detail
│
├── components/
│   ├── ui/                      ← shadcn/ui primitives (DO NOT EDIT directly)
│   │   ├── button.tsx, card.tsx, dialog.tsx, select.tsx, table.tsx, tabs.tsx, ...
│   │   └── command.tsx, popover.tsx, sheet.tsx, tooltip.tsx, ...
│   ├── layout/
│   │   ├── AppLayout.tsx        ← Main shell: mesh background + sidebar rail/panel + UtilityBar + content
│   │   ├── SidebarRailPanel.tsx ← Module rail, panel, mobile overlay, profile/sign-out
│   │   ├── UtilityBar.tsx       ← Breadcrumbs, command palette trigger, theme, notifications, mobile menu
│   │   └── InlinePageSearch.tsx ← Module-local search for pages with active filtering
│   ├── dashboard/
│   │   ├── StatsBar.tsx         ← KPI tile showing pending amount
│   │   ├── SubmitToSpectrumButton.tsx ← "Submit N to Spectrum" button
│   │   └── SubmitConfirmationDialog.tsx ← Bulk submit confirmation modal
│   ├── invoices/
│   │   ├── InvoiceTable.tsx     ← TanStack Table for invoice list
│   │   ├── InvoiceDetailForm.tsx ← Editable form (vendor/job/sub/amount/dates/notes)
│   │   ├── InvoiceActionBar.tsx ← Bottom action bar (Discard/Approve/Skip/Undo Approve)
│   │   ├── SpectrumSubmitSection.tsx ← Per-invoice Spectrum overrides + submit button
│   │   ├── SpectrumRefreshButton.tsx ← Manual Spectrum data sync trigger
│   │   ├── BulkActionBar.tsx    ← Fixed bottom bar for multi-select actions
│   │   ├── StatusTabs.tsx       ← Status filter tabs with counts
│   │   ├── PaginationBar.tsx    ← Page size + prev/next navigation
│   │   ├── ColumnToggleDropdown.tsx ← Show/hide table columns
│   │   ├── CreateRuleFromInvoice.tsx ← "Create Rule" dropdown on invoice detail
│   │   ├── LienWaiverDetailForm.tsx  ← Form variant for lien waivers
│   │   ├── dropdowns/
│   │   │   ├── ComboboxShell.tsx   ← Reusable Popover+Command combobox
│   │   │   ├── VendorDropdown.tsx  ← Server-searched vendor picker
│   │   │   ├── JobDropdown.tsx     ← Server-searched job picker
│   │   │   └── SubcontractDropdown.tsx ← Static-list subcontract picker
│   │   └── renderers/
│   │       ├── StatusBadge.tsx     ← Colored status pill
│   │       ├── ClassificationBadge.tsx ← Icon + label for doc type
│   │       ├── CurrencyCell.tsx    ← $-formatted table cell
│   │       ├── DateCell.tsx        ← Human-readable date cell
│   │       └── ConfidenceIndicator.tsx ← Dot + percentage
│   ├── documents/
│   │   └── LienWaiverEditPanel.tsx ← Slide-over for editing lien waiver metadata
│   ├── settings/
│   │   ├── IgnoreRulesPanel.tsx ← Sheet for managing email ignore rules
│   │   ├── RulesPanel.tsx       ← Sheet for listing/managing automation rules
│   │   ├── RuleEditor.tsx       ← Full-screen dialog for create/edit rule
│   │   ├── RuleCriterionRow.tsx ← Single criterion row in rule editor
│   │   └── RuleActionRow.tsx    ← Single action row in rule editor
│   ├── AuthGate.tsx             ← Auth wrapper (passthrough in dev mode)
│   ├── ThemeToggle.tsx          ← Light/dark mode toggle
│   ├── LogoFull.tsx             ← Full NCG Toolbox logo SVG
│   └── LogoMark.tsx             ← Logo mark only
│
├── lib/
│   ├── api.ts                   ← Fetch wrapper (get/post/patch/del) with proxy
│   ├── auth.tsx                 ← useAuth hook + AuthProvider
│   ├── utils.ts                 ← cn() utility (clsx + twMerge)
│   ├── providers.tsx            ← QueryClientProvider + SessionProvider
│   ├── SidebarContext.tsx       ← Sidebar toggle context
│   ├── hooks/
│   │   ├── queries.ts           ← All useQuery hooks
│   │   ├── mutations.ts         ← All useMutation hooks
│   │   ├── useCascadingDropdowns.ts ← Vendor→Job→Subcontract cascade logic
│   │   ├── useInvoiceFilters.ts ← URL-synced filter state for dashboard
│   │   └── useRules.ts          ← CRUD hooks for automation rules
│   └── rules/
│       ├── engine.ts            ← Client-side rule evaluation engine
│       └── helpers.ts           ← Rule matching helpers
│
├── types/
│   ├── api.ts                   ← API response/request type definitions
│   ├── invoice.ts               ← Invoice, ExtractedData, MatchingData, etc.
│   ├── ui.ts                    ← InvoiceFilters, StatusColor, getConfidenceLevel
│   ├── rules.ts                 ← Rule, RuleCriterion, RuleAction types
│   ├── index.ts                 ← Re-exports all type modules
│   └── next-auth.d.ts           ← NextAuth session type augmentation
│
└── test/                        ← Test files
```

---

## 4. Design System

### 4.1 Brand Colors

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--color-ncg-navy` | `#1D2C5B` | `#1D2C5B` | Primary in light mode |
| `--color-ncg-cyan` | `#00AEEF` | `#00AEEF` | Primary in dark mode, accents |
| `--primary` | Navy (`#1D2C5B`) | Cyan (`#00AEEF`) | All primary UI elements |
| `--background` | Blue-tinted (`#eef2ff`) | Deep navy (`#060d24`) | Page background |
| `--card` | White (`#ffffff`) | Dark navy (`#0c1630`) | Card surfaces |
| `--muted` | Soft blue (`#e2eaf7`) | Dark blue (`#0f1e38`) | Muted elements |

### 4.2 Semantic Status Colors (defined in `types/ui.ts` → `StatusColor`)

| Status | Color |
|---|---|
| `pending` | `text-yellow-600 bg-yellow-50` |
| `approved` | `text-green-600 bg-green-50` |
| `rejected` | `text-red-600 bg-red-50` |
| `submitted` | `text-purple-600 bg-purple-50` |
| `discarded` | `text-gray-500 bg-gray-50` |
| `duplicate` | `text-violet-600 bg-violet-50` |
| `reviewed` | `text-teal-600 bg-teal-50` |

### 4.3 Confidence Colors

| Level | Threshold | Color |
|---|---|---|
| High | ≥ 0.9 | Green (`bg-green-500`) |
| Medium | 0.7–0.89 | Yellow (`bg-yellow-400`) |
| Low | < 0.7 | Red (`bg-red-500`) |

Table rows get a subtle background tint based on confidence level:
```ts
const CONFIDENCE_TINT = {
  high:   "bg-green-50/50 dark:bg-green-950/20",
  medium: "bg-yellow-50/50 dark:bg-yellow-950/20",
  low:    "bg-red-50/50 dark:bg-red-950/20",
};
```

### 4.4 Typography

- **Font:** Geist Sans (variable: `--font-geist-sans`) + Geist Mono
- **Section headers:** `text-xs font-semibold text-muted-foreground uppercase tracking-wide`
- **Field labels:** `text-xs font-medium text-muted-foreground`
- **Monospace data:** `font-mono text-xs` (invoice numbers, amounts, job numbers)
- **Tabular numbers:** `tabular-nums` class on all numeric displays

### 4.5 Border Radius

Global `--radius: 0.625rem` with derived sizes (`sm`, `md`, `lg`, `xl`, etc.)

### 4.6 Animations

The platform background is owned by `PlatformMeshBackground` and the `.tbx-platform-*` hooks in `globals.css`. Keep it behind content, theme-aware, and respectful of reduced-motion settings.

Plus `fadeIn` and `fadeInUp` keyframes for page transitions.

### 4.7 Sidebar

- Expanded: `w-[250px]`, collapsible on desktop
- Collapsed: `w-14` (icon-only)
- Mobile (`<1024px`): slide-over with backdrop overlay
- `--sidebar-width: 250px` CSS variable used by `BulkActionBar` fixed positioning

---

## 5. Layout Architecture

### Root Layout (`src/app/layout.tsx`)
```
<html> → <body> → ThemeProvider → TooltipProvider → Providers (QueryClient + SessionProvider) → AuthProvider → {children}
```

### Dashboard Layout (`src/app/(dashboard)/layout.tsx`)
```
<AppLayout> → flex h-screen: [SidebarRailPanel] + [main.flex-1]
  main contains:
    - UtilityBar (global shell controls)
    - tbx-platform-content wrapper with {children}
```

### Page Layout Pattern (Dashboard Home)
```
flex flex-col h-full overflow-hidden
├── Non-scrolling page header                 ← shrink-0, border-b
│   ├── StatsBar
│   ├── InlinePageSearch + controls row (Columns, Settings, Submit)
│   └── StatusTabs
└── Scrollable body                           ← flex-1, overflow-y-auto
    ├── Search results banner (if searching)
    ├── InvoiceTable
    └── PaginationBar
+ BulkActionBar (fixed bottom, only when selected)
```

### Invoice Detail Page Layout
```
flex flex-col h-full overflow-hidden
├── Back button bar                           ← shrink-0, border-b
│   └── Back | vendor name | Prev/Next nav
└── Two-panel split (flex-1)
    ├── Left (55%): Document Viewer
    │   ├── Toolbar (filename, open tab, download, zoom)
    │   └── iframe/img/placeholder
    └── Right (45%): Data Sections (overflow-y-auto)
        ├── Document Type (reclassify dropdown)
        ├── Email Metadata (from/subject/received/body)
        ├── Invoice/LienWaiver Details form
        ├── Line Items table
        ├── SpectrumSubmitSection (overrides + submit)
        ├── Unsaved changes banner
        └── InvoiceActionBar (sticky bottom)
```

---

## 6. Page Inventory

### 6.1 Dashboard Home — `src/app/(dashboard)/page.tsx`

**Key behaviors:**
- URL-synced filters via `useInvoiceFilters()` (status, search, sort, sortDir, page, limit)
- Client-side rule filtering via `applyRules()` (hides invoices matching `hide_from_queue` rules)
- Column visibility and order persisted in localStorage
- Row click navigates to detail, encoding current filter state in URL params
- Multi-select checkboxes → `BulkActionBar` with approve all / reject all / file all
- Sort cycles: unsorted → asc → desc → unsorted

### 6.2 Invoice Detail — `src/app/(dashboard)/invoices/[id]/page.tsx`

**Key behaviors:**
- Two-panel: 55% document viewer + 45% data/form
- Prev/Next navigation using `useInvoices()` with same filters as dashboard
- Nav list is snapshot-pinned (doesn't re-sort when invoice statuses change)
- `InvoiceDetailForm` is exposed via imperative handle (`formRef`) for "Save & Approve"
- Document viewer handles: PDF (iframe), images (img tag), non-renderable (download link), no-attachment (placeholder)
- Content-Type sniffed via HEAD request to `/file` endpoint
- Email body rendered in sandboxed iframe with `sanitizeEmailHtml()`
- Classification changeable via dropdown (triggers `useReclassifyInvoice`)
- After approve/discard, auto-navigates to next invoice or back to dashboard

### 6.3 Documents Shelf — `src/app/(dashboard)/documents/page.tsx`

**Key behaviors:**
- Separate page for filed documents (`?filed=true`)
- Classification filter pills (All Types, Lien Waiver, COI, W-9, etc.)
- Status tabs: All / Pending / Reviewed / Discarded
- Pending lien waivers shown in attention section
- Bulk actions: Review / Discard / Delete
- Row click opens document detail or lien waiver edit panel

---

## 7. Component Inventory

### 7.1 `InvoiceDetailForm` (`src/components/invoices/InvoiceDetailForm.tsx`)

**Purpose:** Editable form for invoice header fields on detail page.

**Fields:**
- Vendor (ComboboxShell → VendorDropdown, server-searched)
- Job (ComboboxShell → JobDropdown, server-searched)
- Subcontract (ComboboxShell → SubcontractDropdown, static list filtered by vendor+job)
- Invoice Number (text input)
- Amount (number input with $ prefix)
- Invoice Date / Due Date (date inputs)
- Notes (textarea)

**Key patterns:**
- `forwardRef` with `useImperativeHandle` exposes `{ hasEdits, triggerSave }` to parent
- Cascading dropdowns via `useCascadingDropdowns()` hook — changing vendor or job clears subcontract
- Dirty tracking per field — changed fields show blue "Modified" chip + ring-2 highlight
- `initialRef` tracks server state; `localFields` tracks user edits
- Re-syncs with server data when `invoice.extracted.*` fields change
- Subcontract info line shows contract amount + unbilled balance
- Over-billing warning when invoice > unbilled balance

### 7.2 `InvoiceActionBar` (`src/components/invoices/InvoiceActionBar.tsx`)

**Purpose:** Bottom action bar on invoice detail page.

**Buttons (varies by state):**
- **Discard** (always shown, left side) — red outline, confirmation dialog with "don't ask again" localStorage preference
- **Approve** (pending invoices) — green, saves unsaved changes first
- **Undo Approve** (approved/modified invoices) — outline, calls `POST /api/invoices/:id/unapprove`
- **File to Documents** (non-invoice classifications) — files the document
- **Skip** (when `onSkip` provided) — ghost button with SkipForward icon

**Props:**
```ts
{
  invoiceId: string;
  classification: string;
  invoiceStatus?: string;
  formRef: React.RefObject<InvoiceDetailFormHandle | null>;
  hasUnsavedChanges: boolean;
  onActionSuccess?: () => void;
  onSkip?: () => void;
}
```

### 7.3 `SpectrumSubmitSection` (`src/components/invoices/SpectrumSubmitSection.tsx`)

**Purpose:** Per-invoice Spectrum override fields + submit button. Shows only for `classification === "invoice"` AND `status === "pending" || "approved"`.

**Fields:**
| Field | Trigger Display | Dropdown Items | Submits |
|---|---|---|---|
| Routing Code | Code only (e.g. "JC") | Code only | Code only |
| Phase Code | Full label (e.g. "15400 - Plumbing Fixtures") | Full label | Code only |
| GL Account | Full label (e.g. "5450 - Subcontract Job Cost") | Full label | Code only |
| Cost Type | Full label (e.g. "S - Subcontract") | Full label | Code only |

**Auto-population logic:**
- Routing code: Job PM → `pm_to_routing` lookup → code. Falls back to "D" (AP Default)
- Phase code: Defaults to first phase code if subcontract selected, blank if no subcontract
- GL Account: "5450" if subcontract selected, "5300" if not
- Cost Type: "S" if subcontract, "M" if not. Auto-updates when phase code changes (from `default_cost_type`)

**Override indicator:** Amber dot next to label when value differs from default.

### 7.4 `ComboboxShell` (`src/components/invoices/dropdowns/ComboboxShell.tsx`)

**Purpose:** Reusable combobox base using Radix Popover + cmdk Command.

**Props:**
```ts
{
  value: string | null;
  displayLabel?: string | null;
  onSelect: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  onSearchChange?: (term: string) => void;
  isLoading?: boolean;
  hideSearch?: boolean;
  open?: boolean;              // controlled mode
  onOpenChange?: (open: boolean) => void;
  onClear?: () => void;       // shows X button when set
  children: React.ReactNode;  // CommandItem children
}
```

**Includes:** `ConfidenceBadge` subcomponent (shows confidence level or "Manual" badge).

**Re-exports:** `CommandItem` and `Check` from cmdk for dropdown files.

### 7.5 `InvoiceTable` (`src/components/invoices/InvoiceTable.tsx`)

**Purpose:** TanStack React Table for invoice list on dashboard and documents shelf.

**Columns:** select, classification, vendorName, invoiceNumber, amount, jobNumber, status, queuedAt, emailFrom, emailSubject

**Features:**
- Row selection with checkbox column
- Sortable headers (date, received, vendor, amount)
- Drag-and-drop column reordering
- Column visibility toggle
- Confidence-based row tinting
- Non-invoice rows get `text-muted-foreground`
- Skeleton loading state (10 rows)
- Manual pagination (server-side)

### 7.6 `StatusTabs` (`src/components/invoices/StatusTabs.tsx`)

**Tabs:** All | Pending | Approved | Submitted | Discarded | Duplicates

Each tab shows count from `DashboardStats`. Uses shadcn `Tabs` with `variant="line"`.

### 7.7 `BulkActionBar` (`src/components/invoices/BulkActionBar.tsx`)

Fixed to bottom of viewport, positioned `left: var(--sidebar-width)`. Shows selection count + Approve All / Reject All / File to Documents / Clear buttons.

### 7.8 `SpectrumRefreshButton` (`src/components/invoices/SpectrumRefreshButton.tsx`)

Triggers Spectrum data sync. Polls every 3s while running. Shows sync results (vendor/job/subcontract counts). 60-second client-side cooldown between syncs. Invalidates vendors, jobs, subcontracts, routingCodes, phaseCodes caches on completion.

### 7.9 `StatsBar` (`src/components/dashboard/StatsBar.tsx`)

Large "Awaiting Approval" tile with pending dollar amount. Right side shows pending count, approved count, today processed count, missing lien waivers count. Clickable — filters to pending.

### 7.10 `SubmitConfirmationDialog` (`src/components/dashboard/SubmitConfirmationDialog.tsx`)

Three-phase dialog: confirm → submitting (spinner overlay) → results (per-invoice success/fail). Lists all approved invoices with vendor, invoice #, amount, status.

---

## 8. Hooks & Data Layer

### 8.1 Queries (`src/lib/hooks/queries.ts`)

| Hook | Endpoint | Query Key | Options |
|---|---|---|---|
| `useInvoices(filters)` | `GET /api/invoices` | `["invoices", filters]` | 30s stale |
| `useInvoice(id)` | `GET /api/invoices/:id` | `["invoice", id]` | enabled: !!id |
| `useStats(params?)` | `GET /api/invoices/stats` | `["stats", params]` | 60s stale |
| `useVendorSearch(term)` | `GET /api/vendors` | `["vendors", debouncedTerm]` | 300ms debounce, 60s stale |
| `useJobSearch(term)` | `GET /api/jobs` | `["jobs", debouncedTerm]` | 300ms debounce, 60s stale |
| `useJobByNumber(num)` | `GET /api/jobs?search=num` | `["jobByNumber", num]` | 5min stale, finds exact match |
| `useInvoiceEmail(id)` | `GET /api/invoices/:id/email` | `["invoiceEmail", id]` | no retry |
| `useSubcontracts(v, j)` | `GET /api/subcontracts` | `["subcontracts", v, j]` | enabled: !!(v \|\| j) |
| `useRoutingCodes()` | `GET /api/routing-codes` | `["routingCodes"]` | 5min stale |
| `usePhaseCodes()` | `GET /api/phase-codes` | `["phaseCodes"]` | 5min stale |
| `useIgnoreRules()` | `GET /api/ignore-rules` | `["ignoreRules"]` | — |
| `usePipelineStatus(interval)` | `GET /api/pipeline/status` | `["pipelineStatus"]` | refetchInterval |
| `useClassifications()` | `GET /api/classifications` | `["classifications"]` | 5min stale |
| `useSpectrumRefreshStatus(interval)` | `GET /api/vendors/refresh/status` | `["spectrumRefresh"]` | refetchInterval |
| `useAuditTrail(id)` | `GET /api/invoices/:id/audit` | `["audit", id]` | no retry |

### 8.2 Mutations (`src/lib/hooks/mutations.ts`)

| Hook | Method | Endpoint | Invalidates |
|---|---|---|---|
| `useUpdateInvoice()` | PATCH | `/api/invoices/:id` | invoice, invoices |
| `useApproveInvoice()` | POST | `/api/invoices/:id/approve` | invoice, invoices, stats |
| `useUnapproveInvoice()` | POST | `/api/invoices/:id/unapprove` | invoice, invoices, stats |
| `useRejectInvoice()` | POST | `/api/invoices/:id/reject` | invoice, invoices, stats |
| `useDiscardInvoice()` | POST | `/api/invoices/:id/discard` | invoice, invoices, stats |
| `useBulkAction()` | POST | `/api/invoices/bulk` | invoices, stats |
| `useSubmitToSpectrum()` | POST | `/api/invoices/submit` | invoices, stats |
| `useAddIgnoreRule()` | POST | `/api/ignore-rules` | ignoreRules |
| `useDeleteIgnoreRule()` | DELETE | `/api/ignore-rules/:id` | ignoreRules |
| `useRunPipeline()` | POST | `/api/pipeline/run` | pipelineStatus |
| `useReclassifyInvoice()` | POST | `/api/invoices/:id/reclassify` | invoice, invoices, stats |
| `useRetryInvoice()` | POST | `/api/invoices/:id/retry` | invoice, invoices, stats |
| `useRefreshSpectrum()` | POST | `/api/vendors/refresh` | — (polling handles refresh) |
| `useFileDocument()` | POST | `/api/invoices/:id/file` | invoice, invoices, stats |
| `useMarkReviewed()` | POST | `/api/invoices/:id/review` | invoice, invoices, stats |
| `useDeleteInvoice()` | DELETE | `/api/invoices/:id` | invoices, stats |

### 8.3 `useCascadingDropdowns` (`src/lib/hooks/useCascadingDropdowns.ts`)

Manages the Vendor → Job → Subcontract cascade:
- Changing vendor or job clears subcontract
- Tracks which fields are "manual" (user-changed)
- Exposes `changedFields` (only dirty fields) for PATCH payload
- Re-syncs when server data changes (after save)
- `dirtyFields` Set tracks which of vendor/job/subcontract were touched

### 8.4 `useInvoiceFilters` (`src/lib/hooks/useInvoiceFilters.ts`)

Syncs filter state with URL search params. Validates status, sort, sortDir values. Resets page to 1 when filters change.

### 8.5 API Client (`src/lib/api.ts`)

All browser requests go through `/api/backend/` prefix → Next.js rewrites to backend. Server-side requests go directly to `NEXT_PUBLIC_API_URL`. Supports `get`, `post`, `patch`, `del` methods. Default headers (like `x-user-id`) can be injected at runtime.

---

## 9. Type System

### 9.1 Invoice (`src/types/invoice.ts`)

```ts
interface Invoice {
  id: string;
  classification: ClassificationType;  // 'invoice' | 'receipt' | 'lien-waiver' | ...
  confidence: number;
  file: string;
  email: InvoiceEmail;  // { from, subject, receivedAt, bodyPreview, body, bodyContentType }
  status: InvoiceStatus; // 'pending' | 'approved' | 'rejected' | 'discarded' | 'submitted' | ...
  queuedAt: string;
  extracted: ExtractedData | null;  // { vendorName, invoiceNumber, amount, lineItems, ... }
  matching: MatchingData | null;    // { vendor, job, subcontract, isMultiJob, sourceInvoiceTotal }
  overallConfidence: number;
  needsReview: boolean;
  splitFrom: string | null;
  duplicateOf: string | null;
  reason: string | null;
  error: { stage: string; message: string; timestamp: string } | null;
  lienWaiverStatus?: 'attached' | 'missing';
  wasModified?: boolean;
  notes?: string | null;
  flagged?: boolean;
  hidden?: boolean;
  assignedTo?: string | null;
}
```

### 9.2 Key Reference Types (`src/types/api.ts`)

- `Vendor` — `{ code, name }`
- `Job` — `{ number, description, address, status, pm }`
- `Subcontract` — `{ subcontractNumber, job, vendorCode, vendor, revContract, totalBilled, status }`
- `RoutingCodeOption` — `{ code, description, confirm_by?, approvers? }`
- `PhaseCodeOption` — `{ phase_code, description, default_cost_type }`
- `SubmitPayload` — `{ ids: string[], overrides?: Record<string, { routing_code?, phase_code?, gl_account?, cost_type? }> }`
- `SubmitResponse` — `{ success, submitted, total?, message, results? }`

### 9.3 Filter Types (`src/types/ui.ts`)

```ts
interface InvoiceFilters {
  status?: InvoiceStatus | 'all';
  classification?: string;
  search?: string;
  sort?: 'date' | 'received' | 'vendor' | 'amount';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  filed?: boolean;
}
```

---

## 10. Radix UI / shadcn Patterns

### 10.1 shadcn/ui Configuration

- Style: `new-york`
- Config: `components.json` at repo root
- Alias: `@/components/ui/*`
- **DO NOT** edit `src/components/ui/*.tsx` files directly unless fixing a bug. Use `npx shadcn@latest add <component>` to add new ones.

### 10.2 Select Component — CRITICAL PATTERN

The Radix `Select` primitive **requires** `<SelectValue>` inside `<SelectTrigger>` for proper functionality. To customize what text appears in the trigger:

```tsx
// ✅ CORRECT — custom trigger text via SelectValue children
<Select value={val} onValueChange={setVal}>
  <SelectTrigger>
    <SelectValue>{customDisplayText}</SelectValue>
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="a">Full label for A</SelectItem>
  </SelectContent>
</Select>

// ❌ WRONG — removing SelectValue breaks dropdown
<SelectTrigger>
  <span>{customText}</span>
</SelectTrigger>

// ❌ WRONG — sr-only SelectValue causes duplicate text
<SelectTrigger>
  <SelectValue className="sr-only" />
  <span>{customText}</span>
</SelectTrigger>
```

### 10.3 Combobox Pattern (Popover + Command)

Used for Vendor, Job, Subcontract dropdowns. Pattern:
```
Popover → PopoverTrigger (Button role=combobox) → PopoverContent
  → Command (shouldFilter={false}, server search)
    → CommandInput (optional, hidden for static lists)
    → CommandList → CommandGroup → CommandItem(s)
```

The `ComboboxShell` component wraps this pattern — all three dropdown components use it.

### 10.4 Dialog vs Sheet

- **Dialog** (`dialog.tsx`): Centered modal. Used for confirmation dialogs, rule editor.
- **Sheet** (`sheet.tsx`): Side panel. Used for settings panels (IgnoreRulesPanel, RulesPanel).
- **AlertDialog** (`alert-dialog.tsx`): Confirmation with explicit action. Used for discard confirmation.

### 10.5 Tooltip Pattern

Global `<TooltipProvider>` is in root layout. Tooltips are used throughout:
```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <span>Hoverable content</span>
  </TooltipTrigger>
  <TooltipContent side="bottom">Tooltip text</TooltipContent>
</Tooltip>
```

---

## 11. Data Flow & State Management

### 11.1 No Global State

There is **no** Redux, Zustand, or global store. State is managed:
1. **Server state** — TanStack Query (cache, invalidation, refetching)
2. **URL state** — `useSearchParams()` via `useInvoiceFilters()` hook
3. **Local component state** — `useState` / `useRef` for form fields, UI toggles
4. **localStorage** — column visibility, column order, discard confirmation preference
5. **Imperative handle** — `InvoiceDetailForm` exposes `{ hasEdits, triggerSave }` to parent via ref

### 11.2 Navigation State Preservation

When navigating from dashboard to invoice detail:
- Dashboard URL params (sort, sortDir, status, search) are encoded into the `from` param
- Detail page reads these to fetch the same sorted/filtered list for prev/next navigation
- "Back" button returns to the exact dashboard state

### 11.3 Cache Invalidation Strategy

All mutations invalidate relevant query keys on success. The general pattern:
- Single-invoice mutations invalidate: `["invoice", id]`, `["invoices"]`, `["stats"]`
- Bulk mutations invalidate: `["invoices"]`, `["stats"]`
- Spectrum refresh invalidates: `["vendors"]`, `["jobs"]`, `["subcontracts"]`, `["routingCodes"]`, `["phaseCodes"]`

---

## 12. Spectrum Submit System

### 12.1 Bulk Submit (Dashboard)

1. User clicks "Submit N to Spectrum" button → `SubmitConfirmationDialog` opens
2. Dialog fetches all approved invoices and shows list
3. User confirms → `POST /api/invoices/submit` with all approved IDs
4. Results phase shows per-invoice success/fail

### 12.2 Single Submit (Invoice Detail)

1. `SpectrumSubmitSection` renders below line items for invoices with status=pending or approved
2. Four override dropdowns auto-populate from job/subcontract data
3. User can override any field before submitting
4. "Submit to Spectrum" button sends `POST /api/invoices/submit` with single ID + overrides
5. Success/error shown inline

### 12.3 Display/Submit Contracts

| Field | Trigger Display | Dropdown Display | Submitted Value |
|---|---|---|---|
| Routing Code | Code only (`"JC"`) | Code only (`"JC"`) | Code (`"JC"`) |
| Phase Code | Full label (`"15400 - Plumbing Fixtures"`) | Full label | Code only (`"15400"`) |
| GL Account | Full label (`"5450 - Subcontract Job Cost"`) | Full label | Code only (`"5450"`) |
| Cost Type | Full label (`"S - Subcontract"`) | Full label | Code only (`"S"`) |

---

## 13. Rules Engine

### 13.1 Architecture

- Rules stored server-side, fetched via `GET /api/rules` (scoped by user via `x-user-id` header)
- Client-side evaluation in `src/lib/rules/engine.ts` — `applyRules()` filters invoices for `hide_from_queue` action
- Server-side auto-application at pipeline ingestion time + manual retroactive via `POST /api/rules/apply`

### 13.2 UI Components

- **RulesPanel** — Sheet listing all rules with reorder (up/down), toggle active, edit, delete
- **RuleEditor** — Full-width dialog with two panels: criteria (left) + actions (right)
- **CreateRuleFromInvoice** — Dropdown on invoice detail to pre-fill criteria from current invoice's sender/subject/vendor

### 13.3 Criteria Fields

`vendor_name`, `vendor_code`, `amount`, `description`, `invoice_number`, `job_number`, `classification`, `status`, `email_from`, `email_subject`

### 13.4 Action Types

`auto_approve`, `auto_discard`, `auto_file`, `hide_from_queue`, `set_vendor`, `set_job`, `set_classification`, `assign_reviewer`, `add_note`, `flag`

---

## 14. Known Issues & Pending Work

### 14.1 ComboboxShell Keyboard Focus

**Bug:** When the combobox popover opens, keyboard focus doesn't always land on the search input. The `onOpenAutoFocus` handler in `ComboboxShell` calls `inputRef.current?.focus()` but timing issues with Radix Popover can prevent it from working.

**File:** `src/components/invoices/dropdowns/ComboboxShell.tsx`

### 14.2 SubcontractDropdown Closure

**Bug:** When selecting a subcontract, the dropdown sometimes doesn't close properly. The `onSelect` handler calls `setOpen(false)` but the Popover's `onOpenChange` may re-open it.

**Files:** `src/components/invoices/dropdowns/SubcontractDropdown.tsx`, `ComboboxShell.tsx`

### 14.3 Backend Endpoints Needed

- `POST /api/invoices/:id/unapprove` — Frontend is wired and ready, backend needs to implement
- `GET /api/phase-codes` — Frontend is wired, backend needs to serve this

### 14.4 Future Considerations

- Dashboard page doesn't display `modified` status as a distinct tab (shown as "approved" with "edited" chip)
- No undo for multi-select bulk actions
- Spectrum submit errors don't auto-retry — user must retry manually
- No keyboard shortcuts for approve/discard/skip
- No accessibility audit has been performed

---

## 15. API Reference Summary

**Full API docs:** `docs/reference/API-REFERENCE.md`

**Backend base URL:** `https://api.toolbox.northwindcg.example`
**Frontend proxy:** Browser calls `/api/backend/*` → Next.js rewrites to backend `/api/*`

Key endpoints for UI work:
- `GET /api/invoices` — List with filters, pagination, sorting
- `GET /api/invoices/:id` — Single invoice detail
- `GET /api/invoices/:id/file` — Document binary (PDF/image)
- `GET /api/invoices/stats` — Dashboard counts + amounts
- `PATCH /api/invoices/:id` — Update/correct fields
- `POST /api/invoices/:id/approve` — Approve
- `POST /api/invoices/:id/unapprove` — Revert to pending
- `POST /api/invoices/:id/discard` — Discard
- `POST /api/invoices/:id/reclassify` — Change classification
- `POST /api/invoices/submit` — Submit to Spectrum
- `POST /api/invoices/bulk` — Bulk actions
- `GET /api/vendors` / `GET /api/jobs` / `GET /api/subcontracts` — Reference data
- `GET /api/routing-codes` / `GET /api/phase-codes` — Spectrum parameters
- `GET /api/rules` — Automation rules

---

## 16. Implementation Rules

### 16.1 File Organization

- **Never edit** `src/components/ui/*.tsx` unless fixing a primitives bug
- New invoice-related components go in `src/components/invoices/`
- New hooks go in `src/lib/hooks/`
- New types go in the appropriate file in `src/types/` and re-exported via `index.ts`

### 16.2 Styling Conventions

- Use Tailwind utility classes exclusively — no CSS modules, no inline styles (except for computed values like zoom transforms)
- Use `cn()` from `@/lib/utils` for conditional class merging
- Use semantic color tokens (`text-muted-foreground`, `bg-card`, etc.) not hardcoded colors
- Dark mode works via the `.dark` class — all custom colors have dark variants in `globals.css`

### 16.3 Component Conventions

- All client components must have `"use client"` directive
- Props interfaces defined above the component, exported when needed
- Use explicit TypeScript types on all parameters — no `any`
- Destructure props in the function signature
- Use `forwardRef` + `useImperativeHandle` when parent needs to trigger actions

### 16.4 Data Conventions

- All API calls go through `src/lib/api.ts` — never use `fetch()` directly in components
- All query hooks are in `src/lib/hooks/queries.ts`, all mutation hooks in `mutations.ts`
- Always invalidate relevant query keys in mutation `onSuccess`
- Use `staleTime` for infrequently changing data (vendors, jobs, routing codes)

### 16.5 UX Conventions

- Spinner pattern: `h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin` inline in button
- Loading states: Use `<Skeleton>` components from shadcn
- Error feedback: Inline `text-xs text-destructive` messages near the action that failed
- Success feedback: Inline green text or banner, auto-dismiss after 3s
- Confirmation dialogs: Use `AlertDialog` for destructive actions
- "Modified" indicator: Blue "Modified" chip next to field labels, `ring-2 ring-primary` on input
- All money values: `tabular-nums font-mono`, formatted with `Intl.NumberFormat`
- All dates: `formatDistanceToNow` for relative, `Intl.DateTimeFormat` for absolute

### 16.6 Testing

- Unit tests use Vitest + Testing Library
- Config: `vitest.config.ts` at root
- Test files co-located: `*.test.tsx` next to source files
- Run: `npm test` or `npx vitest`
