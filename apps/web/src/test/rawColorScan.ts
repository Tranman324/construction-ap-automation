/**
 * Finds raw colors in component source: hex literals, rgb()/hsl() calls and Tailwind palette classes.
 * Design tokens (`text-rc-ink`, `var(--rc-...)`), arbitrary sizes (`size-[13px]`) and `rgba`-free values pass.
 * Known limit: a hex is skipped when the character before the separating space is a letter ("issue #123"), so
 * a bare word followed by a hex-looking number in prose is not flagged. `&#123;` entities are skipped too.
 */
const HEX = /(?<![A-Za-z] |&)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const COLOR_FN = /\b(?:rgba?|hsla?)\(/g;
const PALETTE = /\b(?:amber|violet|red|blue|green|yellow|orange|slate|gray|zinc|neutral|stone|emerald|teal|cyan|sky|indigo|purple|pink|rose|lime|fuchsia)-\d{2,3}\b/g;

export function findRawColors(source: string): string[] {
  return [HEX, COLOR_FN, PALETTE].flatMap((pattern) => source.match(pattern) ?? []);
}
