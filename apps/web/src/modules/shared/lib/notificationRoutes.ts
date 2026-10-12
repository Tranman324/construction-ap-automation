import type { NotificationRoute } from "@/modules/shared/types/notificationRoute";

export const NOTIFICATION_ROUTES: NotificationRoute[] = [
  {
    eventTypes: ["admin.user.role_changed", "admin.role.deleted"],
    audience: { permissions: ["platform.admin"] },
    channel: "in-app",
    priority: "high",
  },
  {
    eventTypes: [
      "admin.user.permissions_overridden",
      "admin.role.created",
      "admin.role.updated",
      "admin.title_rule.created",
      "admin.title_rule.updated",
      "admin.title_rule.deleted",
    ],
    audience: { permissions: ["platform.admin"] },
    channel: "in-app",
    priority: "normal",
  },
  {
    eventTypes: ["invoice.approved", "invoice.rejected"],
    audience: { permissions: ["accounting.invoices.approve"] },
    channel: "in-app",
    priority: "normal",
  },
  {
    eventTypes: ["invoice.deleted", "invoice.permanently_deleted"],
    audience: { permissions: ["accounting.invoices.delete"] },
    channel: "in-app",
    priority: "high",
  },
  {
    eventTypes: ["invoice.restored"],
    audience: { permissions: ["accounting.invoices.delete"] },
    channel: "in-app",
    priority: "normal",
  },
  {
    eventTypes: ["invoice.submitted_spectrum"],
    audience: { permissions: ["accounting.invoices.submit_spectrum"] },
    channel: "in-app",
    priority: "normal",
  },
  {
    eventTypes: ["invoice.split_created"],
    audience: { permissions: ["accounting.invoices.manage_splits"] },
    channel: "in-app",
    priority: "normal",
  },
];
