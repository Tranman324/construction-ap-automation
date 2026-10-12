# Motion system

The shared motion vocabulary lives in `src/app/globals.css`. Consumers use the
named variables or Tailwind utilities below; they do not invent local timing,
curves, or transition shorthands.

## Tokens

| Family | Name | Value |
| --- | --- | --- |
| Curve | `--ease-out` / `ease-out-strong` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| Curve | `--ease-in-out` / `ease-in-out-smooth` | `cubic-bezier(0.77, 0, 0.175, 1)` |
| Curve | `--ease-drawer` / `ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` |
| Curve | `--ease-press` / `ease-press` | `cubic-bezier(0.2, 0, 0, 1)` |
| Curve | `--ease-sidebar` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Duration | `--dur-instant` / `duration-instant` | `0ms` |
| Duration | `--dur-hover` / `duration-hover` | `120ms` |
| Duration | `--dur-press` / `duration-press` | `150ms` |
| Duration | `--dur-tip` / `duration-tip` | `150ms` |
| Duration | `--dur-pop` / `duration-pop` | `200ms` |
| Duration | `--dur-modal` / `duration-modal` | `240ms` |
| Duration | `--dur-drawer` / `duration-drawer` | `300ms` |
| Duration | `--dur-exit` / `duration-exit` | `140ms` |
| Duration | `--dur-stagger` / `duration-stagger` | `50ms` |
| Supplemental | `--dur-quick`, `--dur-reveal`, `--dur-notice`, `--dur-scrim` | `100ms`, `180ms`, `220ms`, `260ms` |
| Supplemental | `--dur-sheet`, `--dur-progress`, `--dur-spin` | `280ms`, `320ms`, `0.7s` |
| Surface | `--scrim-ink` / `bg-scrim-ink` | `rgba(15, 23, 42, 0.44)` |
| Surface | `--scrim-blur` / `backdrop-scrim-blur` | `6px` |
| Press | `--press-scale` / `scale-press` | `0.96` |

Dark mode changes `--scrim-ink` to `rgba(2, 6, 18, 0.58)`; the remaining
motion tokens stay stable across themes.

## Patterns

- Use `duration-*` and the named ease utilities. Raw timing or curves in a
  consumer are banned; so are bare `ease`, `ease-in`, and `transition: all`.
- Exits are shorter than corresponding entries. Use trigger-aware transform
  origins so a menu, popover, drawer, or modal grows from its trigger or edge.
- Hover movement is gated to devices that can hover. Prefer color, opacity, or
  shadow feedback when hover movement is not meaningful.
- Focus rings are instant (`duration-instant`) and must not wait for a motion.
- Do not animate row or list entrances. Preserve stable scanning and layout.
- Scrims use `--scrim-ink` and `--scrim-blur`; drawers use the drawer curve.
- Press feedback may use `--press-scale`, but never as a substitute for a
  visible focus or disabled state.

## Reduced motion

Within `prefers-reduced-motion: reduce`, remove movement and scale. Preserve
opacity and color feedback so state changes remain perceivable, and keep focus
rings instant. Do not hide content or make an interaction depend on motion.

## Naming

Use `ease-*` for curves and `duration-*` for Tailwind timing utilities. Keep
semantic aliases in the shared token block when a later consumer needs a value
not already covered by the canonical scale. A consumer should reference the
semantic name, never repeat the numeric value.

## Shared platform motion and presentation

### Shared motion

- `SurfaceMotion.tsx` in `src/modules/shared/components/patterns/` exports `SurfaceMotionPreset` (`card-resolve`, `card-promote`), `SurfaceMotionState` (`rest`/`enter`/`exit`), `SURFACE_MOTION_CONTRACTS`, `getSurfaceMotionClassName`, `getSurfaceMotionStyles`, and `getSurfaceMotionDurationMs`; its CSS module defines the preset states.
- `CardStack` uses `getSurfaceMotionClassName` and `getSurfaceMotionDurationMs` for a confirmed front-card resolve and next-card promotion; its CSS module supplies the reduced-motion path.
- `ActionMotion.module.css` in `src/modules/shared/components/motion/` holds shared row, activity, resolve-tray, spinner, and tab-body motion hooks; current callers include `InvoiceTable`, `NeedsSplitQueue`, `TrashTable`, `ActivityFeed`, and document panels.
- `useQueueArrival.ts` in `src/modules/shared/hooks/` arms only the first loading-to-ready edge and returns the number of arriving rows; `InvoiceTable`, `NeedsSplitQueue`, and `TrashTable` pass their current row IDs.
- Current code uses the first-ready queue arrival and `ActivityFeed`'s `newActivityEntry`; keep these event-specific and do not generalize them into a row/list-entrance pattern.

### Generic `tbx-` names

- Screen: `tbx-screen` wraps `InvoiceQueuePage`; `tbx-screen__head` marks its `PlatformSectionHeader`.
- Filter rail in `DashboardPanelFilters`: `tbx-rail`, `tbx-rail__div`, `tbx-rail__flag`, `tbx-rail__job`, `tbx-rail__srch`, `tbx-rail__srchbtn`, `tbx-rail__srchx`, `tbx-rail__track`.
- Detail/table: `tbx-route-detail` marks the `routeLifecycle` surface; `tbx-tablescroll` and `tbx-table` wrap and style invoice/trash tables; `tbx-iconbtn-lg` sizes search and pager buttons.
- Pager in `PaginationBar`: `tbx-pager`, `tbx-pager__left`, `tbx-pager__nav`, `tbx-pager__page`, `tbx-pager__range`, `tbx-pager__right`, `tbx-pager__sel`, `tbx-pager__size`.
- Cell formatting: `tbx-money` in `CurrencyCell`; `tbx-date` and `tbx-date__y` in `DateCell`.
- Status classes in `StatusBadge`: `tbx-status-pill`, `tbx-status-pill__dot`, and the dynamic `tbx-status-pill--` prefix with variants `tbx-status-pill--overdue`, `tbx-status-pill--pending`, `tbx-status-pill--active`, `tbx-status-pill--complete`, `tbx-status-pill--info`, `tbx-status-pill--draft`, `tbx-status-pill--muted`, `tbx-status-pill--violet`. `complete`/`info` share info colors; `draft`/`muted` share neutral colors.
- `tbx-status-pulse` is the status-dot keyframe; the pill custom properties are `--tbx-pill-color`, `--tbx-pill-bg`, and `--tbx-pill-border`.

### Compact text-size utilities

- `text-2xs` is 11px: compact secondary copy and timestamps, including `ActivityFeed`.
- `text-3xs` is 10px: small status/edit badges, split-page metadata, and tooltips in `PageThumbnailStrip` and `PageMiniThumbnail`.
- `text-4xs` is 9px: tiny page-number and invoice-marker count overlays.
- These tokens set font size only; no line-height utilities were added.

## Invoice table recipe

Keep the existing `InvoiceTable` wrapper and table placement; this is not a new abstraction:

```tsx
<div className={cn(surface === "framed" && "rounded-md border", "tbx-tablescroll overflow-x-auto")}>
  <Table className="tbx-table min-w-[880px]">...</Table>
</div>
```

| Existing caller | Classes or utility |
| --- | --- |
| `PaginationBar` | `tbx-pager`, `tbx-pager__range`, `tbx-pager__page`, `tbx-iconbtn-lg` |
| `CurrencyCell` / `DateCell` | `tbx-money`; `tbx-date` and `tbx-date__y` |
| `StatusBadge` | `tbx-status-pill` with `tbx-status-pill--${config.tone}`; edited badge uses `text-3xs` |
| Compact copy / markers | `ActivityFeed` timestamps use `text-2xs`; `StatusBadge` metadata uses `text-3xs`; invoice-marker counts use `text-4xs` |

`InvoiceMarkerRenderers` uses the tiny count overlay; split thumbnails use `text-4xs` for page numbers and `text-3xs` for tooltips.

## Follow-up for next PR

- [x] Replace the two remaining `text-[11px]` uses in
  `src/app/(dashboard)/accounting/invoices/[id]/page.tsx` with `text-2xs`: the
  Duplicate `Badge` in the duplicate-status notice, and the Activity tab section
  heading. Both are 11px, so the switch causes no visible change. They were left
  out of the platform-styling pilot because that route is outside the
  `modules/accounting/modules/invoices` path the pilot covered. Verify by checking
  that the built CSS still has no new or removed rules.
  Done in branch codex/invoice-detail-text-2xs.
