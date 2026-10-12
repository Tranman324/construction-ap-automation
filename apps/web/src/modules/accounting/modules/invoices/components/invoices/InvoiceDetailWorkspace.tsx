"use client";

import type { LucideIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { cn } from "@/modules/shared/lib/utils";
import { FloatingResolveRegion } from "../documents/FloatingResolveRegion";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";

export type InvoiceDetailTabId = "details" | "allocation" | "waiver" | "activity";

export interface InvoiceDetailTab {
  id: InvoiceDetailTabId;
  label: string;
  icon: LucideIcon;
  alert?: boolean;
  badge?: number;
  disabled?: boolean;
}

interface InvoiceDetailWorkspaceProps {
  header?: ReactNode;
  headerLeading?: ReactNode;
  headerActions?: ReactNode;
  document: ReactNode;
  statusStrip?: ReactNode;
  panelNotice?: ReactNode;
  tabs: readonly InvoiceDetailTab[];
  activeTab: InvoiceDetailTabId;
  onTabChange: (tab: InvoiceDetailTabId) => void;
  hasUnsavedChanges: boolean;
  dirtyMessage?: string;
  footerAccessory?: ReactNode;
  resolveTray?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
  className?: string;
}

export function InvoiceDetailWorkspace({
  header,
  headerLeading,
  headerActions,
  document,
  statusStrip,
  panelNotice,
  tabs,
  activeTab,
  onTabChange,
  hasUnsavedChanges,
  dirtyMessage = "Unsaved corrections - Save & Approve submits them automatically.",
  footerAccessory,
  resolveTray,
  footer,
  children,
  className,
}: InvoiceDetailWorkspaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div className={cn(motionStyles.spinnerScope, "flex h-full flex-col overflow-hidden bg-background", className)}>
      {header ?? (
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">{headerLeading}</div>
          {headerActions ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {headerActions}
            </div>
          ) : null}
        </header>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section className="flex min-h-[38vh] flex-col overflow-hidden border-b md:min-h-0 md:w-[55%] md:border-b-0 md:border-r">
          {document}
        </section>

        <aside className="flex min-h-0 flex-1 flex-col overflow-hidden md:w-[45%]">
          {statusStrip ? (
            <div className="shrink-0 border-b bg-muted/30">{statusStrip}</div>
          ) : null}

          {panelNotice ? (
            <div className="shrink-0">{panelNotice}</div>
          ) : null}

          <div
            role="tablist"
            aria-label="Invoice detail sections"
            className="flex shrink-0 gap-1 border-b bg-card px-3 pt-2"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const selected = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`invoice-detail-${tab.id}`}
                  disabled={tab.disabled}
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    "relative -mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors",
                    "border-transparent text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-45",
                    selected && "border-primary text-primary",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{tab.label}</span>
                  {tab.alert ? (
                    <span
                      aria-label={`${tab.label} needs attention`}
                      className="h-1.5 w-1.5 rounded-full bg-amber-500"
                    />
                  ) : null}
                  {tab.badge != null && tab.badge > 0 ? (
                    <span className="min-w-4 rounded-full bg-muted px-1 text-center text-3xs font-semibold leading-4 text-muted-foreground">
                      {tab.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <FloatingResolveRegion tray={resolveTray} scrollRef={scrollRef}>
          <div
            ref={scrollRef}
            id={`invoice-detail-${activeTab}`}
            role="tabpanel"
            className={`${motionStyles.invoiceTabBody} min-h-0 flex-1 overflow-y-auto`}
            style={{ paddingBottom: "var(--resolve-tray-height, 0px)", scrollPaddingBottom: "var(--resolve-tray-height, 0px)" }}
          >
            <div className="flex min-h-full flex-col gap-4 px-4 py-4">
              {children}
            </div>
          </div>

          </FloatingResolveRegion>

          <footer className={cn(
            "shrink-0 border-t bg-card px-4 py-3",
            footerAccessory && "space-y-3",
          )}>
            {footerAccessory}
            {hasUnsavedChanges ? (
              <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-300" role="status">
                {dirtyMessage}
              </p>
            ) : null}
            {footer}
          </footer>
        </aside>
      </div>
    </div>
  );
}
