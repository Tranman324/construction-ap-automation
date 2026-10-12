"use client";

import { UserAvatar } from "@/modules/shared/components/UserAvatar";
import { normalizePlatformUser } from "@/modules/shared/lib/userProfile";

export interface InvoiceActivityActorObject {
  userId?: string | null;
  name?: string | null;
  role?: string | null;
  avatarUrl?: string | null;
  avatar_url?: string | null;
}

export interface InvoiceActivityEntry {
  id: string;
  action: string;
  actor: unknown;
  createdAt: string;
}

interface NormalizedActivityActor {
  displayName: string;
  avatarUrl: string | null;
  role: string | null;
}

interface InvoiceActivityListProps {
  entries: readonly InvoiceActivityEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeActivityActor(actor: unknown): NormalizedActivityActor {
  if (isRecord(actor)) {
    const userId = readString(actor.userId);
    const name = readString(actor.name);
    const role = readString(actor.role);
    const avatarUrl = readString(actor.avatarUrl) ?? readString(actor.avatar_url);
    const displayName = name ?? userId ?? "System";
    const profile = normalizePlatformUser({
      id: userId ?? "",
      azure_id: userId,
      avatar_url: avatarUrl,
      name: displayName,
    });

    return {
      displayName,
      avatarUrl: profile.avatar_url,
      role,
    };
  }

  const displayName = readString(actor) ?? "System";
  const profile = normalizePlatformUser({
    id: "",
    name: displayName,
    email: displayName.includes("@") ? displayName : null,
  });

  return {
    displayName,
    avatarUrl: profile.avatar_url,
    role: null,
  };
}

function formatActionLabel(action: string): string {
  return action.replace(/[-_]/g, " ");
}

function formatActivityDate(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? createdAt : date.toLocaleDateString();
}

export function InvoiceActivityList({ entries }: InvoiceActivityListProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity recorded.</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const actor = normalizeActivityActor(entry.actor);

        return (
          <div key={entry.id} className="flex gap-2.5 text-sm">
            <UserAvatar
              user={{ name: actor.displayName, image: actor.avatarUrl }}
              size="xs"
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="capitalize text-foreground">{formatActionLabel(entry.action)}</span>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatActivityDate(entry.createdAt)}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {actor.displayName}
                {actor.role ? <span className="ml-1">({actor.role})</span> : null}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
