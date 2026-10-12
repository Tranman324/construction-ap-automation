import { cn } from "@/modules/shared/lib/utils";
import type { Value } from "./resolveCardModel";

const EMPTY = "—";
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** Display text for a value. Money is en-US USD with 2 decimals; dates are `MMM D, YYYY` in UTC; null/invalid is an em dash. */
export function formatValue(value: Value | undefined): string {
  if (value == null) return EMPTY;
  if (typeof value === "string") return value;
  switch (value.kind) {
    case "money":
      return Number.isFinite(value.value) ? USD.format(value.value) : EMPTY;
    case "date": {
      const date = new Date(value.value);
      return Number.isNaN(date.getTime()) ? EMPTY : DATE.format(date);
    }
    default:
      return value.value;
  }
}

function isMonoValue(value: Value | undefined): boolean {
  return typeof value === "object" && value !== null && (value.kind === "money" || value.kind === "mono");
}

/** Renders a value and its muted note as flex items, so the parent cell's gap spaces them. */
export function ValueView({ value }: { value: Value | undefined }) {
  if (value == null) return <span className="text-muted-foreground">{EMPTY}</span>;
  const mono = isMonoValue(value) ? "font-mono tabular-nums" : "";
  const note = typeof value === "object" ? value.note : undefined;
  return (
    <>
      <span className={cn(mono)}>{formatValue(value)}</span>
      {note ? <span className={cn("font-normal text-muted-foreground", mono)}>{note}</span> : null}
    </>
  );
}
