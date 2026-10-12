"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, SkipForward, Undo2 } from "lucide-react";

import {
  formatShortcutTooltip,
  type DocumentPanelShortcutAction,
  useDocumentShortcutLabels,
} from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";
import type {
  DocumentAction,
  DocumentPanelNavigation,
  DocumentPanelUndoControl,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import { isDocumentActionDisabled } from "@/modules/accounting/modules/invoices/types/documentSpec";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";
import { cn } from "@/modules/shared/lib/utils";

interface DocumentPanelFooterProps {
  primaryAction?: DocumentAction;
  secondaryActions?: readonly DocumentAction[];
  navigation?: DocumentPanelNavigation;
  note?: string;
  undoControl?: DocumentPanelUndoControl;
  onPrimaryActionChange?: (action: DocumentPanelShortcutAction | null) => void;
}

function actionVariant(action: DocumentAction, fallback: "default" | "outline") {
  if (action.tone === "destructive") return "destructive";
  if (action.tone === "neutral") return "outline";
  return fallback;
}

function ActionButton({
  action,
  fallback,
  shortcut,
  ariaShortcut,
}: {
  action: DocumentAction;
  fallback: "default" | "outline";
  shortcut?: string;
  ariaShortcut?: string;
}) {
  const Icon = action.pending ? Loader2 : undefined;
  const disabled = isDocumentActionDisabled(action);
  const button = (
    <Button
      variant={actionVariant(action, fallback)}
      disabled={disabled}
      onClick={() => void action.onClick()}
      aria-keyshortcuts={!disabled ? ariaShortcut : undefined}
      className={cn(action.pending && "[&_svg]:animate-spin")}
    >
      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      {action.label}
    </Button>
  );

  if (!shortcut) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{button}</span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {disabled ? action.label : formatShortcutTooltip(action.label, shortcut)}
      </TooltipContent>
    </Tooltip>
  );
}

function ShortcutTooltip({
  label,
  shortcut,
  enabled,
  children,
}: {
  label: string;
  shortcut: string;
  enabled: boolean;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{formatShortcutTooltip(label, shortcut)}</TooltipContent>
    </Tooltip>
  );
}

export function DocumentPanelUndoButton({ undoControl }: { undoControl: DocumentPanelUndoControl }) {
  const shortcuts = useDocumentShortcutLabels();
  const disabled = undoControl.disabled || undoControl.pending;
  const Icon = undoControl.pending ? Loader2 : Undo2;
  const label = undoControl.label ?? "Undo";
  const tooltip = disabled
    ? undoControl.tooltip
    : formatShortcutTooltip(undoControl.tooltip, shortcuts.undo);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              aria-keyshortcuts={!disabled ? shortcuts.undoAria : undefined}
              onClick={() => {
                if (disabled) return;
                void undoControl.onUndo?.();
              }}
              className={cn(undoControl.pending && "[&_svg]:animate-spin")}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function DocumentPanelFooter({
  primaryAction,
  navigation,
  note,
  undoControl,
  onPrimaryActionChange,
}: DocumentPanelFooterProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const shortcuts = useDocumentShortcutLabels();
  const discardDisabled = navigation?.discardDisabled || navigation?.discardPending;

  useEffect(() => {
    if (!primaryAction) {
      onPrimaryActionChange?.(null);
      return undefined;
    }

    onPrimaryActionChange?.({
      label: primaryAction.label,
      disabled: isDocumentActionDisabled(primaryAction),
      run: primaryAction.onClick,
    });
    return () => onPrimaryActionChange?.(null);
  }, [onPrimaryActionChange, primaryAction]);

  function handleDiscardClick() {
    if (!navigation?.onDiscard || discardDisabled) return;
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setConfirmDiscard(false);
    navigation.onDiscard();
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center gap-2 border-t border-border bg-card px-4 py-3">
      {navigation?.onDiscard && (
        <Button
          variant={confirmDiscard ? "destructive" : "outline"}
          disabled={discardDisabled}
          onClick={handleDiscardClick}
          className={cn(
            !confirmDiscard && "border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive",
            navigation.discardPending && "[&_svg]:animate-spin",
          )}
        >
          {navigation.discardPending ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Discarding...
            </span>
          ) : confirmDiscard ? "Confirm Discard" : "Discard"}
        </Button>
      )}
      {note && <span className="text-xs font-medium text-muted-foreground">{note}</span>}
      <div className="flex-1" />
      {navigation?.canSkip && navigation.onSkip && (
        <ShortcutTooltip label="Skip" shortcut={shortcuts.next} enabled>
          <Button variant="ghost" onClick={navigation.onSkip} aria-keyshortcuts={shortcuts.nextAria}>
            Skip
            <SkipForward className="h-4 w-4" aria-hidden="true" />
          </Button>
        </ShortcutTooltip>
      )}
      {undoControl && <DocumentPanelUndoButton undoControl={undoControl} />}
      {primaryAction && (
        <ActionButton
          action={primaryAction}
          fallback="default"
          shortcut={shortcuts.primary}
          ariaShortcut={shortcuts.primaryAria}
        />
      )}
      </div>
    </TooltipProvider>
  );
}
