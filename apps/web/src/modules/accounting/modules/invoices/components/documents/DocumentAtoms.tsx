"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileQuestion,
  Loader2,
  Minus,
  XCircle,
} from "lucide-react";

import type {
  DocumentAlert,
  DocumentChecklistItem,
  DocumentKeyValueRow,
  DocumentMatchState,
  DocumentSection as DocumentSectionModel,
  DocumentTone,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import { getDocumentChecklistProgress, isDocumentActionDisabled } from "@/modules/accounting/modules/invoices/types/documentSpec";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";
import { TONE_ICONS } from "./resolveCardIcons";

const toneClasses: Record<DocumentTone, string> = {
  neutral: "border-border bg-muted/50 text-muted-foreground",
  info: "border-primary/30 bg-primary/10 text-primary",
  ok: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
  warn: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
  bad: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300",
};

const checklistIcon = {
  done: CheckCircle2,
  warning: AlertTriangle,
  blocked: XCircle,
  todo: Circle,
};

const checklistTone = {
  done: "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300",
  warning: "border-amber-200 bg-amber-50/80 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300",
  blocked: "border-red-200 bg-red-50/80 text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300",
  todo: "border-border bg-card text-muted-foreground",
};

export function DocumentSection({ section }: { section: DocumentSectionModel }) {
  const Icon = section.icon;
  return (
    <section
      className="space-y-3"
      data-document-section-id={section.id}
    >
      <div className="flex min-h-7 items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
        <h3 className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
          {section.title}
        </h3>
        {section.flagged && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
        <div className="ml-auto">{section.action}</div>
      </div>
      <div>{section.children}</div>
    </section>
  );
}

export function DocumentKeyValueRows({ rows }: { rows: readonly DocumentKeyValueRow[] }) {
  return (
    <dl className="overflow-hidden rounded-lg border border-border">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 border-t border-border/60 px-3 py-2 first:border-t-0"
        >
          <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
          <dd className={cn("min-w-0 text-sm text-foreground", row.mono && "font-mono text-xs")}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DocumentStatPill({
  tone = "neutral",
  label,
  pulse,
}: {
  tone?: DocumentTone;
  label: string;
  pulse?: boolean;
}) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 border", toneClasses[tone])}>
      <span className={cn("h-1.5 w-1.5 rounded-full bg-current", pulse && "opacity-80")} />
      {label}
    </Badge>
  );
}

/** `noticeOnly` (every remaining alert is a notice, same rule as the tray's "To review") uses the notice tray's info tone. */
export function DocumentAlertCountPill({ count, onClick, noticeOnly = false }: { count: number; onClick?: () => void; noticeOnly?: boolean }) {
  const plural = count === 1 ? "" : "s";
  if (noticeOnly) {
    const NoticeIcon = TONE_ICONS.info;
    return (
      <button
        type="button"
        onClick={onClick}
        data-tone="info"
        className="inline-flex h-5 items-center gap-1 rounded-full border border-rc-line bg-rc-wash px-1.5 py-0 text-3xs font-semibold text-rc-ink"
        aria-label={`${count} alert${plural} to review`}
      >
        <NoticeIcon className="h-3 w-3 text-rc-icon" aria-hidden="true" />
        {count} to review
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-5 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0 text-3xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
      aria-label={`${count} unresolved alert${plural}`}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {count} to resolve
    </button>
  );
}

export function DocumentMatchPill({ state, label }: { state: DocumentMatchState; label?: string }) {
  const meta = {
    matched: { tone: "ok" as const, icon: CheckCircle2, label: label ?? "Matched" },
    missing: { tone: "bad" as const, icon: AlertTriangle, label: label ?? "Not in AP" },
    diff: { tone: "warn" as const, icon: AlertTriangle, label: label ?? "Amount differs" },
    neutral: { tone: "neutral" as const, icon: Minus, label: label ?? "Unmatched" },
  }[state];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 border", toneClasses[meta.tone])}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

export function DocumentChecklistLine({
  item,
  onJump,
}: {
  item: DocumentChecklistItem;
  onJump?: (sectionId: string) => void;
}) {
  const Icon = checklistIcon[item.state] ?? FileQuestion;
  const content = (
    <>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <strong className="block text-sm font-semibold text-foreground">{item.label}</strong>
        {item.hint && <span className="block text-xs text-muted-foreground">{item.hint}</span>}
      </span>
    </>
  );

  if (item.sectionId && onJump) {
    return (
      <button
        type="button"
        className={cn("flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left", checklistTone[item.state])}
        onClick={() => onJump(item.sectionId!)}
      >
        {content}
      </button>
    );
  }

  return <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2", checklistTone[item.state])}>{content}</div>;
}

export function DocumentAlertBanners({ alerts }: { alerts: readonly DocumentAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const Icon = alert.icon ?? AlertTriangle;
        const action = alert.action;
        const ActionIcon = action?.pending ? Loader2 : action?.icon;
        return (
          <div key={alert.id} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2", toneClasses[alert.tone])}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
              <p className="min-w-0 text-sm">
                <span className="font-semibold">{alert.label}</span>
                {alert.detail && <span className="ml-1 opacity-85">{alert.detail}</span>}
              </p>
              {action && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                  disabled={isDocumentActionDisabled(action)}
                  onClick={() => void action.onClick()}
                >
                  {ActionIcon && <ActionIcon className={cn("h-3.5 w-3.5", action.pending && "animate-spin")} aria-hidden="true" />}
                  {action.label}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DocumentChecklistCard({
  items,
  onJump,
}: {
  items: readonly DocumentChecklistItem[];
  onJump?: (sectionId: string) => void;
}) {
  const progress = getDocumentChecklistProgress(items);
  const width = progress.total === 0 ? 0 : (progress.done / progress.total) * 100;
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground">Clearance Checklist</span>
        <span className="font-mono text-xs text-foreground">{progress.done} / {progress.total}</span>
      </div>
      <div className="h-1 bg-muted">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${width}%` }} />
      </div>
      <div className="space-y-2 p-3">
        {items.map((item) => (
          <DocumentChecklistLine key={item.id} item={item} onJump={onJump} />
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">No checklist items.</p>}
      </div>
    </div>
  );
}
