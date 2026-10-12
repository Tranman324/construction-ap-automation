"use client";

import { AvatarGroup } from "@/modules/shared/components/UserAvatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";
import type { Voter } from "@/modules/feature-requests/types";

interface VoterStackProps {
  voters: Voter[];
}

export function VoterStack({ voters }: VoterStackProps) {
  if (voters.length === 0) return null;

  const mustHaveVoters = voters.filter((voter) => voter.voteType === "must_have");
  const niceToHaveVoters = voters.filter((voter) => voter.voteType === "nice_to_have");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex">
            <AvatarGroup
              users={voters.map((voter) => ({
                name: voter.name,
                image: voter.image,
              }))}
              size="sm"
              max={3}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent className="space-y-1">
          {mustHaveVoters.length > 0 && (
            <div>
              <span className="font-semibold">Must-Have:</span>{" "}
              {mustHaveVoters.map((voter) => voter.name).join(", ")}
            </div>
          )}
          {niceToHaveVoters.length > 0 && (
            <div>
              <span className="font-semibold">Nice-to-Have:</span>{" "}
              {niceToHaveVoters.map((voter) => voter.name).join(", ")}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}