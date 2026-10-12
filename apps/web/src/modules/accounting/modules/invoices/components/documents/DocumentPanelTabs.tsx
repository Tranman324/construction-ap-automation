"use client";

import type { KeyboardEvent } from "react";

import type { DocumentAlert, DocumentTab } from "@/modules/accounting/modules/invoices/types/documentSpec";
import { cn } from "@/modules/shared/lib/utils";

interface DocumentPanelTabsProps {
  documentId?: string;
  tabs: readonly DocumentTab[];
  alerts: readonly DocumentAlert[];
  activityUnreadCount?: number;
  activeTabId: string;
  invoiceDetailStyle: boolean;
  onTabChange: (tabId: string) => void;
}

export function DocumentPanelTabs({
  documentId,
  tabs,
  alerts,
  activityUnreadCount = 0,
  activeTabId,
  invoiceDetailStyle,
  onTabChange,
}: DocumentPanelTabsProps) {
  const panelId = documentId ?? "panel";

  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    onTabChange(nextTab.id);
    document.getElementById(`document-tab-${panelId}-${nextTab.id}`)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Document sections"
      className={cn(
        invoiceDetailStyle
          ? "flex shrink-0 gap-1 border-b bg-card px-3 pt-2"
          : "flex items-center gap-1 border-b border-border px-3 py-2",
      )}
    >
      {tabs.map((tab, tabIndex) => {
        const Icon = tab.icon;
        const alertCount = alerts.filter((alert) => (alert.tabId ?? tabs[0]?.id) === tab.id).length;
        const badgeCount = tab.id === "activity" ? activityUnreadCount : alertCount;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`document-tab-${panelId}-${tab.id}`}
            aria-controls={`document-tabpanel-${panelId}-${tab.id}`}
            aria-selected={activeTabId === tab.id}
            tabIndex={activeTabId === tab.id ? 0 : -1}
            className={cn(
              invoiceDetailStyle
                ? "relative -mb-px inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                : "relative inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              activeTabId === tab.id && (invoiceDetailStyle ? "border-primary text-primary" : "bg-background text-foreground shadow-sm"),
            )}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => selectFromKeyboard(event, tabIndex)}
          >
            {Icon && <Icon className={invoiceDetailStyle ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden="true" />}
            {tab.label}
            {badgeCount > 0 && (
              <span
                aria-label={tab.id === "activity" ? `${badgeCount} new activity` : `${badgeCount} ${tab.label.toLowerCase()} ${badgeCount === 1 ? "issue" : "issues"}`}
                className="min-w-4 rounded-full border border-amber-300 bg-amber-50 px-1 text-center text-3xs font-semibold leading-4 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
              >
                {badgeCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
