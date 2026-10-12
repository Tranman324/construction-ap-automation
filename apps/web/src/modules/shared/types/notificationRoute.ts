export type NotificationChannel = "in-app";
export type NotificationPriority = "low" | "normal" | "high";

export interface NotificationAudience {
  roles?: string[];
  permissions?: string[];
  userIds?: string[];
}

export interface NotificationRoute {
  eventTypes: string[];
  audience: NotificationAudience;
  channel: NotificationChannel;
  priority: NotificationPriority;
}
