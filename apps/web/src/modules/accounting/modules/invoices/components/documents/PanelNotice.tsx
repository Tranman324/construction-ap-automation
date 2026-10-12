"use client";

import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/modules/shared/components/ui/button";

export interface NoticeEntry { id: string; label: string; resolved: boolean; tabId?: string }
interface NoticeTarget { element: HTMLDivElement; selectedId?: string; unresolvedOnly: boolean }
interface NoticeContextValue {
  target: NoticeTarget | null;
  setTarget: (target: NoticeTarget | null) => void;
  entries: readonly NoticeEntry[];
  register: (token: string, entry: NoticeEntry) => () => void;
}
const NoticeContext = createContext<NoticeContextValue | null>(null);

/** Opt-in presentation transport. State, permissions and mutations stay with each owner. */
export function PanelNoticeProvider({ documentId, children }: { documentId: string; children: ReactNode }) {
  return <NoticeScope key={documentId}>{children}</NoticeScope>;
}

function NoticeScope({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<NoticeTarget | null>(null);
  const [registered, setRegistered] = useState<Record<string, NoticeEntry>>({});
  const register = useCallback((token: string, entry: NoticeEntry) => {
    setRegistered((current) => ({ ...current, [token]: entry }));
    return () => setRegistered((current) => {
      const next = { ...current };
      delete next[token];
      return next;
    });
  }, []);
  const value = useMemo(() => ({ target, setTarget, entries: Object.values(registered), register }), [target, registered, register]);
  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>;
}

export function usePanelNotices() {
  return useContext(NoticeContext)?.entries ?? [];
}

export function PanelNoticeObserver({ onChange }: { onChange: (entries: readonly NoticeEntry[]) => void }) {
  const entries = usePanelNotices();
  useLayoutEffect(() => { onChange(entries); }, [entries, onChange]);
  return null;
}

export function PanelNoticeOutlet({ selectedId, unresolvedOnly = false }: { selectedId?: string; unresolvedOnly?: boolean }) {
  const context = useContext(NoticeContext);
  const setTarget = context?.setTarget;
  const attach = useCallback((node: HTMLDivElement | null) => { setTarget?.(node ? { element: node, selectedId, unresolvedOnly } : null); }, [setTarget, selectedId, unresolvedOnly]);
  return context ? <div ref={attach} className="space-y-2" data-testid="panel-notice-outlet" /> : null;
}

export function PanelNotice({ id, label, resolved = false, tabId, children, dismissible = false, revision = "" }: {
  id: string; label: string; resolved?: boolean; tabId?: string; children: ReactNode; dismissible?: boolean; revision?: string;
}) {
  const context = useContext(NoticeContext);
  const token = useId();
  const register = context?.register;
  const [dismissedRevision, setDismissedRevision] = useState<string | null>(null);
  const dismissed = dismissible && dismissedRevision === revision;
  const inactive = resolved || dismissed;
  useLayoutEffect(() => register?.(token, { id, label, resolved: inactive, tabId }), [register, token, id, label, inactive, tabId]);
  if (!context) return <>{children}</>;
  const target = context.target;
  return target && !(target.unresolvedOnly && inactive) ? createPortal(
    <div hidden={target.selectedId !== undefined && target.selectedId !== id} data-panel-notice={id} className="mx-2.5 my-2 flex min-w-0 items-center gap-3 overflow-hidden rounded-[10px] border border-border bg-card px-3 py-2 text-xs">
      <div className="min-w-0 flex-1 truncate [&>p]:truncate">{children}</div>
      {dismissible && !inactive && <div className="shrink-0"><Button type="button" variant="outline" size="sm" onClick={() => setDismissedRevision(revision)}>Dismiss</Button></div>}
    </div>,
    target.element,
  ) : null;
}
