import type { AriaRole, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, type LucideIcon, XCircle } from "lucide-react";

import { cn } from "@/modules/shared/lib/utils";

export type InlineNoticeTone = "neutral" | "info" | "success" | "warning" | "error";

export interface InlineNoticeProps {
  actions?: ReactNode;
  bodyClassName?: string;
  children?: ReactNode;
  className?: string;
  icon?: LucideIcon | null;
  role?: AriaRole;
  title?: ReactNode;
  tone?: InlineNoticeTone;
}

const TONE_CLASSES: Record<InlineNoticeTone, string> = {
  neutral: "border-border bg-muted/20 text-muted-foreground",
  info: "border-primary/20 bg-primary/5 text-primary",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
};

const TONE_ICONS: Record<InlineNoticeTone, LucideIcon | null> = {
  neutral: null,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

export function InlineNotice({
  actions,
  bodyClassName,
  children,
  className,
  icon,
  role,
  title,
  tone = "neutral",
}: InlineNoticeProps) {
  const Icon = icon === undefined ? TONE_ICONS[tone] : icon;

  return (
    <div
      role={role}
      className={cn("flex items-start gap-2 rounded-md border p-3 text-sm", TONE_CLASSES[tone], className)}
    >
      {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <div className={cn("min-w-0 space-y-1", bodyClassName)}>
        {title ? <p className="font-medium">{title}</p> : null}
        {children}
      </div>
      {actions ? <div className="ml-auto shrink-0">{actions}</div> : null}
    </div>
  );
}
