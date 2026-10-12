"use client";

import { RequestCardMenu } from "@/modules/feature-requests/components/RequestCardMenu";
import { StatusControl } from "@/modules/feature-requests/components/StatusControl";
import { VoteButtons } from "@/modules/feature-requests/components/VoteButtons";
import { VoterStack } from "@/modules/feature-requests/components/VoterStack";
import { STATUS_COLORS } from "@/modules/feature-requests/lib/constants";
import type { FeatureRequest } from "@/modules/feature-requests/types";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { UserAvatar } from "@/modules/shared/components/UserAvatar";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/modules/shared/components/ui/card";
import { cn } from "@/modules/shared/lib/utils";

interface RequestCardProps {
  request: FeatureRequest;
  index: number;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function timeAgo(dateString: string): string {
  const diffSeconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (!Number.isFinite(diffSeconds) || diffSeconds < 60) return "just now";

  for (const interval of [
    ["y", 31_536_000],
    ["mo", 2_592_000],
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
  ] as const) {
    const count = Math.floor(diffSeconds / interval[1]);
    if (count >= 1) return `${count}${interval[0]} ago`;
  }

  return "just now";
}

export function RequestCard({ request, index }: RequestCardProps) {
  return (
    <Card
      className={cn(
        "transition-[border-color,box-shadow] duration-200 h-full flex flex-col bg-card",
        "hover:shadow-lg hover:shadow-primary/5 hover:border-primary/15",
      )}
      style={{
        animation: "card-enter 0.4s ease-out both",
        animationDelay: `${index * 60}ms`,
      }}
    >
      <CardHeader className="pb-2">
        {/* Top row: status + menu */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5 min-w-0">
            <PermissionGate
              requires="feature_requests.manage"
              fallback={
                <Badge className={cn("text-xs", STATUS_COLORS[request.status])}>
                  {formatLabel(request.status)}
                </Badge>
              }
            >
              <StatusControl requestId={request.id} currentStatus={request.status} />
            </PermissionGate>
          </div>
          <RequestCardMenu request={request} />
        </div>

        {/* Title */}
        <h3 className="font-semibold leading-tight mt-1">{request.title}</h3>

        {/* Description preview */}
        <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
          {request.description}
        </p>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-3 pt-0">
        {/* Vote buttons row */}
        <VoteButtons
          requestId={request.id}
          mustHaveVotes={request.mustHaveVotes}
          niceToHaveVotes={request.niceToHaveVotes}
          currentUserVote={request.currentUserVote}
        />

        {/* Footer: author + time + voters */}
        <div className="flex items-center gap-2 pt-2 border-t border-border/50 mt-auto">
          <UserAvatar
            size="xs"
            user={{ name: request.authorName, image: request.authorImage ?? undefined }}
          />
          <span className="text-xs text-muted-foreground truncate flex-1">
            {request.authorName}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {timeAgo(request.createdAt)}
          </span>
          <VoterStack voters={request.voters} />
        </div>
      </CardContent>
    </Card>
  );
}
