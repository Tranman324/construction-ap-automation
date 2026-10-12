"use client";

import { useId, useState, type RefObject } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import { PanelNoticeOutlet, usePanelNotices } from "./PanelNotice";
import { ResolveCard } from "./ResolveCard";
import { TONE_ICONS } from "./resolveCardIcons";
import { isResolveCardModel, type ResolveCarouselActionHandler, type ResolveCarouselCard, type Tone } from "./resolveCardModel";

/** Legacy cards are blocking unless flagged as a notice (structural type: the deprecated legacy type stays allowlisted). */
const legacyTone = (card: { notice?: boolean }): Tone => (card.notice ? "info" : "blocking");
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";
import { isNoticeOnly } from "../../types/documentSpec";

/** A single visible card; domain owners retain all permissions and mutation state. The tray tone follows the front card. */
export function ResolveCarousel({ cards, testId, trayRef, onAction }: {
  cards: readonly ResolveCarouselCard[];
  testId: "invoice-resolve-tray" | "document-resolve-tray";
  onAction?: ResolveCarouselActionHandler;
  trayRef?: RefObject<HTMLElement | null>;
}) {
  const notices = usePanelNotices().filter((entry) => !entry.resolved);
  const items = [...notices.map((notice) => ({ key: `notice:${notice.id}`, noticeId: notice.id })),
    ...cards.map((card) => ({ key: `card:${card.id}`, card }))];
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const index = Math.max(0, items.findIndex((item) => item.key === selected));
  const current = items[index];
  const waiting = cards.filter((card) => (isResolveCardModel(card) ? card.tone === "waiting" : card.waiting)).length;
  if (!current) return null;
  const trayTone: Tone = !("card" in current) ? "blocking" : isResolveCardModel(current.card) ? current.card.tone : legacyTone(current.card);
  const TrayIcon = TONE_ICONS[trayTone];
  // Document tray only: when every remaining item is a notice card, nothing needs resolving (panel notices count as blockers).
  const noticesOnly = testId === "document-resolve-tray" && isNoticeOnly(items.map((item) => ("card" in item && !isResolveCardModel(item.card) ? item.card : {})));
  // The tone washes are translucent, so an opaque gutter and card surface sit under them; page content never shows through.
  return <aside ref={trayRef} className={`${motionStyles.resolveTray} bg-background px-[14px] py-2.5`} data-testid={testId}>
    <div data-testid="resolve-tray-surface" className="rounded-xl bg-card shadow-[0_-2px_8px_rgba(15,23,42,0.08)]">
    <div data-tone={trayTone} className="overflow-hidden rounded-xl border border-rc-line bg-rc-wash">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-rc-ink">
        <TrayIcon className="h-3.5 w-3.5" aria-hidden="true" />
        <strong data-testid={testId === "invoice-resolve-tray" ? "resolve-tray-header" : "document-resolve-tray-header"}>{noticesOnly ? "To review" : "To resolve"} <span className="rounded-full bg-rc-tint px-2 font-mono">{items.length}</span></strong>
        {waiting > 0 && <span className="rounded-full bg-rc-waiting-tint px-2 text-rc-waiting-ink">{waiting} waiting</span>}
        <div className="ml-auto flex items-center gap-1">
          {!collapsed && <nav aria-label="Issue cards" className="flex items-center gap-1">
            <Button type="button" aria-label="Previous issue" variant="outline" size="icon" className="h-7 w-7" disabled={index === 0} onClick={() => setSelected(items[index - 1].key)}><ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" /></Button>
            <span className="min-w-10 text-center text-foreground" aria-live="polite">{index + 1} of {items.length}</span>
            <Button type="button" aria-label="Next issue" variant="outline" size="icon" className="h-7 w-7" disabled={index === items.length - 1} onClick={() => setSelected(items[index + 1].key)}><ChevronRight aria-hidden="true" className="h-3.5 w-3.5" /></Button>
          </nav>}
          <Button type="button" aria-label={collapsed ? "Expand tray" : "Collapse tray"} variant="ghost" size="icon" className="h-7 w-7" aria-controls={contentId} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
            <ChevronDown className={collapsed ? "h-3.5 w-3.5 rotate-180" : "h-3.5 w-3.5"} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <span className="sr-only" data-testid="resolve-tray-count">{items.length}</span>
      <div id={contentId} hidden={collapsed}>
        <PanelNoticeOutlet unresolvedOnly selectedId={"noticeId" in current ? current.noticeId : ""} />
        {cards.map((card) => isResolveCardModel(card)
          ? <div key={card.id} hidden={current.key !== `card:${card.id}`} className="mx-2.5 mb-2.5" data-waiting={card.tone === "waiting" ? "true" : "false"}>
            <ResolveCard model={card} onAction={onAction ? (actionId) => onAction(card.id, actionId) : undefined} />
          </div>
          : <div key={card.id} hidden={current.key !== `card:${card.id}`} data-tone={legacyTone(card)} className="mx-2.5 mb-2.5 rounded-[10px] border border-rc-line bg-card px-[13px] py-2.5 text-xs" data-waiting={card.waiting ? "true" : "false"}>{card.content}</div>)}
      </div>
    </div>
    </div>
  </aside>;
}
