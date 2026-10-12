import { useEffect, useRef } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";
import { ACTION_ICONS, TONE_ICONS } from "./resolveCardIcons";
import { resolveCardButtonClass } from "./resolveCardButtonClass";
import type { Action, Actions, ResolveActionHandler, ResolveCardModel, Tone } from "./resolveCardModel";
import { useTwoStepArm } from "./useTwoStepArm";

/** The armed action, or null when the id is stale: gone, no longer two-step, disabled or pending. */
export function armedAction(actions: readonly Action[], armedId: string | null): Action | null {
  if (armedId === null) return null;
  const action = actions.find((a) => a.id === armedId);
  return action && action.confirm === "two-step" && !action.disabled && !action.pending ? action : null;
}

/** The armed warning for an action id: one string applies to every action, a map is keyed by action id. */
export function armedWarningFor(warning: ResolveCardModel["armedWarning"], id: string): string | undefined {
  return typeof warning === "string" ? warning : warning?.[id];
}

interface ResolveCardActionsProps {
  tone: Tone;
  actions: Actions;
  fallback?: string;
  /** The model's armed warning; an armed action disarms when its own text changes under it. */
  armedWarning?: ResolveCardModel["armedWarning"];
  onAction?: ResolveActionHandler;
  /** Reports the armed id so the card can swap its sentence for the armed warning. */
  onArmedChange?: (actionId: string | null) => void;
}

/**
 * Action row of a ResolveCard. Actions the user lacks the permission for are removed (same call as PermissionGate),
 * and when none remain the fallback shows instead. `confirm: "two-step"` arms on the first click and fires on the second.
 * An action with `href` renders as a Next `<Link>` inside the same Button: it never calls `onAction`.
 */
export function ResolveCardActions({ tone, actions, fallback, armedWarning, onAction, onArmedChange }: ResolveCardActionsProps) {
  const { hasAnyPermission } = usePermissions();
  const visible: readonly Action[] = actions.filter((a) => a.permission === undefined || hasAnyPermission([a.permission]));
  const arm = useTwoStepArm((id) => onAction?.(id), onArmedChange);
  const armed = armedAction(visible, arm.armedId);
  const { armedId, disarm } = arm;
  useEffect(() => {
    if (armedId !== null && armed === null) disarm();
  }, [armedId, armed, disarm]);
  // What the user armed: if the armed action's own text (label, armed label, warning) changes, the confirmation no longer applies.
  const armedSignature = armed ? [armed.label, armed.armedLabel ?? "", armedWarningFor(armedWarning, armed.id) ?? ""].join("\u0000") : null;
  const armedWith = useRef<{ id: string; signature: string } | null>(null);
  useEffect(() => {
    if (armedId === null || armedSignature === null) {
      armedWith.current = null;
    } else if (armedWith.current?.id !== armedId) {
      armedWith.current = { id: armedId, signature: armedSignature };
    } else if (armedWith.current.signature !== armedSignature) {
      armedWith.current = null;
      disarm();
    }
  }, [armedId, armedSignature, disarm]);

  if (visible.length === 0) {
    return fallback ? <span className="whitespace-nowrap text-[11.5px] font-medium text-muted-foreground">{fallback}</span> : null;
  }
  return (
    <div className="ml-auto inline-flex shrink-0 items-center gap-1.5">
      {visible.map((action) => {
        if (action.href !== undefined) {
          const LinkIcon = action.icon ? ACTION_ICONS[action.icon] : null;
          return (
            // asChild makes the shared Button structural (no press feel), so data-press is restated to keep the look identical to a button action.
            <Button
              key={action.id}
              asChild
              size="sm"
              variant="ghost"
              className={resolveCardButtonClass(tone, action.emphasis, false)}
              data-press="true"
              data-testid={action.testid}
            >
              <Link href={action.href}>
                {LinkIcon ? <LinkIcon aria-hidden="true" /> : null}
                {action.label}
              </Link>
            </Button>
          );
        }
        const isArmed = armed?.id === action.id;
        const Icon = isArmed ? TONE_ICONS.blocking : action.icon ? ACTION_ICONS[action.icon] : null;
        const inactive = action.disabled || action.pending;
        const label = isArmed ? (action.armedLabel ?? `Confirm ${action.label.toLowerCase()}`) : action.pending ? (action.pendingLabel ?? action.label) : action.label;
        const click = () => {
          if (inactive) return;
          if (action.confirm === "two-step") arm.press(action.id);
          else onAction?.(action.id);
        };
        return (
          <Button
            key={action.id}
            type="button"
            size="sm"
            variant="ghost"
            pressable
            className={resolveCardButtonClass(tone, action.emphasis, isArmed)}
            disabled={inactive}
            title={action.disabled ? action.disabledReason : undefined}
            data-testid={action.testid}
            onClick={click}
          >
            {action.pending ? <Loader2 className="animate-spin" aria-label={label.replace(/[….]+$/, "")} /> : Icon ? <Icon aria-hidden="true" /> : null}
            {label}
          </Button>
        );
      })}
    </div>
  );
}
