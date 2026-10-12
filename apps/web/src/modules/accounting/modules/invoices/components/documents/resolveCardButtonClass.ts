import type { Tone } from "./resolveCardModel";

export type ActionEmphasis = "primary" | "secondary";

/**
 * Card action styling for the shared `Button` (variant ghost, size sm, pressable), passed as `className`.
 * Every string is a complete literal so Tailwind's scanner emits it; twMerge drops the ghost/sm classes it replaces.
 * The `hover:text-*` and `dark:hover:bg-*` entries are load-bearing: without them the ghost accent hover wins.
 */
const SIZE = "h-[28px] gap-[5px] rounded-[8px] px-[11px] py-0 text-[12px] font-semibold has-[>svg]:px-[11px] [&_svg:not([class*='size-'])]:size-[13px] border border-transparent";

const BLOCKING_PRIMARY = "bg-rc-blocking-solid text-rc-blocking-solid-fg hover:bg-rc-blocking-solid-hover hover:text-rc-blocking-solid-fg dark:hover:bg-rc-blocking-solid-hover";
const FAILED_PRIMARY = "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground dark:hover:bg-primary-hover";
const NEUTRAL = "border-border bg-background text-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent";
const SECONDARY = "bg-transparent border-rc-line-strong text-rc-ink hover:bg-rc-tint hover:text-rc-ink dark:hover:bg-rc-tint";
const ARMED = "border-rc-icon bg-rc-tint text-rc-ink hover:bg-rc-tint-strong hover:text-rc-ink dark:hover:bg-rc-tint-strong";

const PRIMARY: Record<Tone, string> = { blocking: BLOCKING_PRIMARY, failed: FAILED_PRIMARY, waiting: NEUTRAL, info: NEUTRAL };
const SECONDARY_BY_TONE: Record<Tone, string> = { blocking: SECONDARY, failed: SECONDARY, waiting: NEUTRAL, info: NEUTRAL };

export function resolveCardButtonClass(tone: Tone, emphasis: ActionEmphasis, armed: boolean): string {
  if (armed) return `${SIZE} ${ARMED}`;
  return `${SIZE} ${emphasis === "primary" ? PRIMARY[tone] : SECONDARY_BY_TONE[tone]}`;
}
