"use client";

import { ChevronDown, Loader2, MoreHorizontal } from "lucide-react";

import type { DocumentAction } from "@/modules/accounting/modules/invoices/types/documentSpec";
import { Button } from "@/modules/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/modules/shared/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/modules/shared/components/ui/tooltip";
import { cn } from "@/modules/shared/lib/utils";
import { formatShortcutTooltip, useDocumentShortcutLabels } from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";

interface DocumentActionsDropdownProps {
  actions: readonly DocumentAction[];
  align?: "start" | "center" | "end";
  className?: string;
  label?: string;
}

export function DocumentActionsDropdown({
  actions,
  align = "end",
  className,
  label = "Actions",
}: DocumentActionsDropdownProps) {
  const shortcuts = useDocumentShortcutLabels();
  if (actions.length === 0) return null;

  return (
    <TooltipProvider>
      <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 gap-1.5 px-2.5 text-xs", className)}>
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-52">
        {actions.map((action) => {
          const Icon = action.pending ? Loader2 : action.icon;
          const menuItem = (
            <DropdownMenuItem
              key={action.id}
              variant={action.tone === "destructive" ? "destructive" : "default"}
              disabled={action.disabled || action.pending}
              onSelect={() => {
                void action.onClick();
              }}
            >
              {Icon && (
                <Icon
                  className={cn("h-3.5 w-3.5", action.pending && "animate-spin")}
                  aria-hidden="true"
                />
              )}
              {action.label}
            </DropdownMenuItem>
          );
          const shortcut = action.id === "add-comment" ? shortcuts.comment : action.id === "reply" ? shortcuts.reply : action.id === "forward" ? shortcuts.forward : undefined;
          if (shortcut) {
            return (
              <Tooltip key={action.id}>
                <TooltipTrigger asChild><span className="block">{menuItem}</span></TooltipTrigger>
                <TooltipContent>{formatShortcutTooltip(action.label, shortcut)}</TooltipContent>
              </Tooltip>
            );
          }
          if (!action.disabledReason) return menuItem;
          return (
            <Tooltip key={action.id}>
              <TooltipTrigger asChild>
                <span className="block">{menuItem}</span>
              </TooltipTrigger>
              <TooltipContent>{action.disabledReason}</TooltipContent>
            </Tooltip>
          );
        })}
      </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
