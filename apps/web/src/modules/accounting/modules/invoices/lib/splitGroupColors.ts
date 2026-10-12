const GROUP_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-orange-500", "bg-pink-500",
  "bg-cyan-500", "bg-amber-500", "bg-rose-500", "bg-teal-500", "bg-indigo-500",
] as const;

const GROUP_RING_COLORS = [
  "ring-blue-500", "ring-emerald-500", "ring-violet-500", "ring-orange-500", "ring-pink-500",
  "ring-cyan-500", "ring-amber-500", "ring-rose-500", "ring-teal-500", "ring-indigo-500",
] as const;

const GROUP_BORDER_COLORS = [
  "border-blue-500", "border-emerald-500", "border-violet-500", "border-orange-500", "border-pink-500",
  "border-cyan-500", "border-amber-500", "border-rose-500", "border-teal-500", "border-indigo-500",
] as const;

const GROUP_SOFT_COLORS = [
  "bg-blue-50 dark:bg-blue-950/30", "bg-emerald-50 dark:bg-emerald-950/30",
  "bg-violet-50 dark:bg-violet-950/30", "bg-orange-50 dark:bg-orange-950/30",
  "bg-pink-50 dark:bg-pink-950/30", "bg-cyan-50 dark:bg-cyan-950/30",
  "bg-amber-50 dark:bg-amber-950/30", "bg-rose-50 dark:bg-rose-950/30",
  "bg-teal-50 dark:bg-teal-950/30", "bg-indigo-50 dark:bg-indigo-950/30",
] as const;

const GROUP_TEXT_COLORS = [
  "text-blue-700 dark:text-blue-200", "text-emerald-700 dark:text-emerald-200",
  "text-violet-700 dark:text-violet-200", "text-orange-700 dark:text-orange-200",
  "text-pink-700 dark:text-pink-200", "text-cyan-700 dark:text-cyan-200",
  "text-amber-700 dark:text-amber-200", "text-rose-700 dark:text-rose-200",
  "text-teal-700 dark:text-teal-200", "text-indigo-700 dark:text-indigo-200",
] as const;

export function getGroupColor(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

export function getGroupRingColor(index: number): string {
  return GROUP_RING_COLORS[index % GROUP_RING_COLORS.length];
}

export function getGroupBorderColor(index: number): string {
  return GROUP_BORDER_COLORS[index % GROUP_BORDER_COLORS.length];
}

export function getGroupSoftColor(index: number): string {
  return GROUP_SOFT_COLORS[index % GROUP_SOFT_COLORS.length];
}

export function getGroupTextColor(index: number): string {
  return GROUP_TEXT_COLORS[index % GROUP_TEXT_COLORS.length];
}
