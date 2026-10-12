import { Fragment } from "react";
import { cn } from "@/modules/shared/lib/utils";
import type { CompareRow, Evidence, FactRow } from "./resolveCardModel";
import { ValueView } from "./resolveCardValue";

const RULE = "border-[color-mix(in_srgb,var(--border)_60%,transparent)]";

function CompareRows({ rows }: { rows: readonly CompareRow[] }) {
  return rows.map((row, i) => (
    <div key={`${row.label}-${i}`} role="row" className="contents">
      <span role="rowheader" className={cn("border-t px-2.5 py-1.5 font-medium text-muted-foreground", RULE)}>{row.label}</span>
      <span
        role="cell"
        className={cn("flex min-w-0 items-center gap-1.5 whitespace-nowrap border-l border-t px-2.5 py-1.5 text-foreground", RULE)}
        data-testid={row.testid}
        data-mismatch={row.testid ? (row.differs ? "true" : "false") : undefined}
      >
        <ValueView value={row.a} />
      </span>
      <span
        role="cell"
        className={cn(
          "flex min-w-0 items-center gap-1.5 whitespace-nowrap border-l border-t px-2.5 py-1.5 text-foreground",
          RULE,
          row.differs && "bg-rc-wash font-bold text-rc-icon",
        )}
      >
        <ValueView value={row.b} />
        {row.differs ? (
          <span className="rounded-full border border-rc-line bg-rc-tint px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[.04em] text-rc-ink">differs</span>
        ) : null}
      </span>
    </div>
  ));
}

const HEADER = "min-w-0 border-b border-rc-line bg-[color-mix(in_srgb,var(--rc-wash)_70%,var(--card))] px-2.5 py-[5px] text-[9.5px] font-bold uppercase leading-[1.35] tracking-[.06em] text-muted-foreground text-pretty";

function Compare({ columns, rows }: { columns: readonly [string, string]; rows: readonly CompareRow[] }) {
  return (
    <div
      role="table"
      aria-label="Evidence"
      className="grid grid-cols-[minmax(76px,max-content)_minmax(0,1fr)_minmax(0,1fr)] overflow-hidden rounded-[8px] border border-rc-line bg-card text-xs"
    >
      <div role="row" className="contents">
        <span role="columnheader" className={HEADER} aria-hidden="true" />
        <span role="columnheader" className={HEADER}>{columns[0]}</span>
        <span role="columnheader" className={HEADER}>{columns[1]}</span>
      </div>
      <CompareRows rows={rows} />
    </div>
  );
}

function Facts({ rows }: { rows: readonly FactRow[] }) {
  return (
    <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] overflow-hidden rounded-[8px] border border-rc-line bg-card text-xs">
      {rows.map((row, i) => (
        <Fragment key={`${row.label}-${i}`}>
          <dt className={cn("border-t px-2.5 py-[5px] font-medium text-muted-foreground", RULE, i === 0 && "border-t-0")}>{row.label}</dt>
          <dd
            className={cn(
              "m-0 flex min-w-0 items-center gap-1.5 border-l border-t px-2.5 py-[5px] text-foreground",
              RULE,
              i === 0 && "border-t-0",
              row.bad && "font-bold text-rc-icon",
            )}
          >
            <ValueView value={row.value} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Evidence block of a ResolveCard: a two-column compare grid or a one-column facts list. Reusable outside the card. */
export function ResolveCardEvidence({ evidence }: { evidence: Evidence }) {
  return evidence.layout === "compare"
    ? <Compare columns={evidence.columns} rows={evidence.rows} />
    : <Facts rows={evidence.rows} />;
}
