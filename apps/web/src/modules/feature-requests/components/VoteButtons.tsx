"use client";

import { useEffect, useState } from "react";
import { Flame, Sparkles } from "lucide-react";
import { useRemoveVote, useVote } from "@/modules/feature-requests/hooks/mutations";
import type { VoteType } from "@/modules/feature-requests/types";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

interface VoteButtonsProps {
  requestId: string;
  mustHaveVotes: number;
  niceToHaveVotes: number;
  currentUserVote: VoteType | null;
}

const buttonClasses =
  "h-8 gap-1 px-2.5 transition-colors duration-200 ease-out sm:h-8";

export function VoteButtons({
  requestId,
  mustHaveVotes,
  niceToHaveVotes,
  currentUserVote,
}: VoteButtonsProps) {
  const vote = useVote();
  const removeVote = useRemoveVote();
  const isPending = vote.isPending || removeVote.isPending;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;

    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error]);

  function handleVote(type: VoteType) {
    if (isPending) return;

    if (currentUserVote === type) {
      removeVote.mutate(
        { id: requestId },
        {
          onSuccess: () => setError(null),
          onError: (mutationError) => setError(mutationError.message ?? "Vote update failed"),
        },
      );
      return;
    }

    vote.mutate(
      { id: requestId, voteType: type },
      {
        onSuccess: () => setError(null),
        onError: (mutationError) => setError(mutationError.message ?? "Vote failed"),
      },
    );
  }

  const mustHaveActive = currentUserVote === "must_have";
  const niceToHaveActive = currentUserVote === "nice_to_have";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant={mustHaveActive ? "default" : "outline"}
          className={cn(
            buttonClasses,
            mustHaveActive
              ? "shadow-sm shadow-primary/15"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => handleVote("must_have")}
          disabled={isPending}
          aria-pressed={mustHaveActive}
          aria-label={mustHaveActive ? "Remove Must-Have vote" : "Vote Must-Have"}
        >
          <Flame className={cn("size-3.5", !mustHaveActive && "text-primary")} />
          <span className="hidden sm:inline">Must-Have</span>
          <span className="tabular-nums">{mustHaveVotes}</span>
        </Button>

        <Button
          type="button"
          size="xs"
          variant={niceToHaveActive ? "default" : "outline"}
          className={cn(
            buttonClasses,
            niceToHaveActive
              ? "shadow-sm shadow-primary/15"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => handleVote("nice_to_have")}
          disabled={isPending}
          aria-pressed={niceToHaveActive}
          aria-label={niceToHaveActive ? "Remove Nice-to-Have vote" : "Vote Nice-to-Have"}
        >
          <Sparkles className={cn("size-3.5", !niceToHaveActive && "text-primary")} />
          <span className="hidden sm:inline">Nice-to-Have</span>
          <span className="tabular-nums">{niceToHaveVotes}</span>
        </Button>
      </div>

      {error && (
        <p className="text-xs text-destructive animate-in fade-in">{error}</p>
      )}
    </div>
  );
}