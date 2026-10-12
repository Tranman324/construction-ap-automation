import type { Category, Status } from "@/modules/feature-requests/types";

export const CATEGORIES: readonly { label: string; value: Category }[] = [
  { label: "Workflow", value: "workflow" },
  { label: "Reporting", value: "reporting" },
  { label: "Integration", value: "integration" },
  { label: "Design", value: "design" },
  { label: "Admin", value: "admin" },
] as const;

export const STATUS_TRANSITIONS: Record<Status, Status[]> = {
  open: ["in_progress", "declined"],
  in_progress: ["completed", "open"],
  completed: ["open"],
  declined: ["open"],
};

export const CATEGORY_COLORS: Readonly<Record<Category, string>> = {
  workflow:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  reporting:
    "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  integration:
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  design:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  admin: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
} as const;

export const STATUS_COLORS: Readonly<Record<Status, string>> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  in_progress:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  declined: "bg-gray-100 text-gray-800 dark:bg-gray-800/60 dark:text-gray-300",
} as const;