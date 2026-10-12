import type { AriaRole } from "react";
import { AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";

import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

export type StatusPanelTone = "info" | "success" | "warning" | "error";

export interface StatusPanelProps {
  actionLabel?: string;
  className?: string;
  icon?: LucideIcon;
  message: string;
  onAction?: () => void;
  role?: AriaRole;
  title: string;
  tone?: StatusPanelTone;
}

const TONE_CLASSES: Record<StatusPanelTone, { frame: string; icon: string; defaultIcon: LucideIcon }> = {
  info: { frame: "border-primary/25 bg-primary/5", icon: "text-primary", defaultIcon: Info },
  success: { frame: "border-emerald-300/50 bg-emerald-500/10", icon: "text-emerald-600", defaultIcon: CheckCircle2 },
  warning: { frame: "border-amber-300/50 bg-amber-500/10", icon: "text-amber-600", defaultIcon: AlertTriangle },
  error: { frame: "border-destructive/30 bg-destructive/5", icon: "text-destructive", defaultIcon: AlertTriangle },
};

export function StatusPanel({
  actionLabel = "Try again",
  className,
  icon,
  message,
  onAction,
  role,
  title,
  tone = "info",
}: StatusPanelProps) {
  const toneClasses = TONE_CLASSES[tone];
  const Icon = icon ?? toneClasses.defaultIcon;

  return (
    <div
      role={role ?? (tone === "error" ? "alert" : "status")}
      className={cn(
        "flex min-h-36 items-center justify-center border border-dashed p-6 text-center",
        toneClasses.frame,
        className,
      )}
    >
      <div className="flex max-w-md flex-col items-center gap-3">
        <Icon className={cn("h-8 w-8", toneClasses.icon)} aria-hidden="true" />
        <div>
          <p className="font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
        {onAction ? (
          <Button size="sm" variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
