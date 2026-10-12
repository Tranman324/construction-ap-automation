import type { ReactNode } from "react";

/**
 * Data contract for the closed ResolveCard. Pure types plus one guard: no React components and no
 * icon imports here, so the model stays serialisable data and every card is built from literals.
 */

/** Closed tone set. The icon is derived from the tone (the model has no icon slot). */
export const TONES = ["blocking", "failed", "waiting", "info"] as const;
export type Tone = (typeof TONES)[number];

/** Closed icon-name set for actions (design catalog names). Mapped to lucide components in resolveCardIcons.ts. */
export type ResolveIconName =
  | "bar-chart" | "check" | "circle-off" | "credit-card" | "external-link" | "link"
  | "mail" | "plus" | "refresh-cw" | "save" | "scissors" | "send" | "trash";

/** Typed value: the component formats it; callers never pass formatted money or dates. */
export interface TextValue { kind: "text" | "mono"; value: string; note?: string }
/** Money is a number only (never a pre-formatted string); rendered as en-US USD with 2 decimals. */
export interface MoneyValue { kind: "money"; value: number; note?: string }
/** Dates are ISO-8601 strings; rendered as `MMM D, YYYY` in UTC. */
export interface DateValue { kind: "date"; value: string; note?: string }
export type Value = string | TextValue | MoneyValue | DateValue | null;

interface ActionCommon {
  id: string;
  label: string;
  icon?: ResolveIconName;
  /** Permission key checked through usePermissions; an action the user lacks is removed, not disabled. */
  permission?: string;
  /** Added vs. the spec type: the design jsx reads `a.testid`. */
  testid?: string;
}

/** State only a button can have: a link action is never disabled or pending. */
interface ButtonState {
  disabled?: boolean;
  disabledReason?: string;
  pending?: boolean;
  pendingLabel?: string;
}

/** `armedLabel` only exists when `confirm === "two-step"`. */
type ConfirmSpec =
  | { confirm?: undefined; armedLabel?: undefined }
  | { confirm: "dialog"; armedLabel?: undefined }
  | { confirm: "two-step"; armedLabel?: string };

/** A button action: reports through `onAction`; never carries an `href`. */
type ButtonKind = ActionCommon & ButtonState & ConfirmSpec & { href?: undefined };
/** A navigation action: rendered as a Next `<Link>` inside the shared Button. Mutually exclusive with confirm, disabled and pending. */
type LinkKind = ActionCommon & {
  href: string;
  confirm?: undefined;
  armedLabel?: undefined;
  disabled?: undefined;
  disabledReason?: undefined;
  pending?: undefined;
  pendingLabel?: undefined;
};

export type PrimaryAction = (ButtonKind | LinkKind) & { emphasis: "primary" };
export type SecondaryAction = (ButtonKind | LinkKind) & { emphasis: "secondary" };
export type Action = PrimaryAction | SecondaryAction;

/**
 * At most 3 actions and at most 1 primary, enforced by the tuple union. The tuples are `readonly`
 * so `as const` literals are accepted; a plain `Action[]` is rejected on purpose.
 */
export type Actions =
  | readonly []
  | readonly [Action]
  | readonly [PrimaryAction, SecondaryAction]
  | readonly [SecondaryAction, PrimaryAction]
  | readonly [SecondaryAction, SecondaryAction]
  | readonly [PrimaryAction, SecondaryAction, SecondaryAction]
  | readonly [SecondaryAction, PrimaryAction, SecondaryAction]
  | readonly [SecondaryAction, SecondaryAction, PrimaryAction]
  | readonly [SecondaryAction, SecondaryAction, SecondaryAction];

export interface CompareRow { label: string; a: Value; b: Value; differs?: boolean; testid?: string }
export interface FactRow { label: string; value: Value; bad?: boolean }
export type Evidence =
  | { layout: "compare"; columns: readonly [string, string]; rows: readonly CompareRow[] }
  | { layout: "facts"; rows: readonly FactRow[] };

export interface ResolveCardModel {
  id: string;
  tone: Tone;
  title: string;
  context?: string;
  sentence?: string;
  actions?: Actions;
  /** Replaces the sentence while an action is armed: one string, or a map keyed by action id. */
  armedWarning?: string | Readonly<Record<string, string>>;
  evidence?: Evidence;
  /** Shown in the actions slot when permission filtering removes every action. */
  fallback?: string;
  testid?: string;
  /** Present only so the union with LegacyResolveCard is discriminable and sound. */
  content?: never;
}

/** @deprecated Raw-JSX card. Allowed only in the two allowlisted tray files (README 15.1). */
export interface LegacyResolveCard {
  id: string;
  label: string;
  waiting?: boolean;
  /** Notice only (nothing to resolve): the card, and the tray when it is in front, use the `info` tone instead of `blocking`. */
  notice?: boolean;
  content: ReactNode;
}

export type ResolveCarouselCard = ResolveCardModel | LegacyResolveCard;

/** Discriminates on `content`, NOT `tone`: DocumentResolveTray spreads DocumentAlert (which has `tone`) into legacy cards. */
export function isResolveCardModel(card: ResolveCarouselCard): card is ResolveCardModel {
  return !("content" in card);
}

/** Card-level handler: fired for `confirm: "dialog"` immediately; for `"two-step"` only on the confirming click; never for disabled or pending. */
export type ResolveActionHandler = (actionId: string) => void;
/** Carousel-level handler: the carousel binds the current card id. */
export type ResolveCarouselActionHandler = (cardId: string, actionId: string) => void;
