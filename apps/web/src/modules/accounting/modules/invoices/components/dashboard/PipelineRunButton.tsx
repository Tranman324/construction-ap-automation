"use client";

import { useEffect, useReducer, useRef } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { useRunPipeline } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { usePipelineStatus } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { PipelineStatus } from "@/modules/accounting/modules/invoices/types/api";
import { isApiError } from "@/modules/shared/lib/api";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Button } from "@/modules/shared/components/ui/button";
import { toast } from "@/modules/shared/components/ui/toaster";

interface PipelineRunButtonProps {
  onCompleted?: () => void;
}

function formatRunSummary(result: PipelineStatus["lastResult"]): string | null {
  if (!result) return null;
  return `Processed ${result.processed.toLocaleString()} · queued ${result.queued.toLocaleString()} · errors ${result.errors.toLocaleString()}`;
}

type PipelineRunState = {
  requested: boolean;
  observedRunning: boolean;
};

type PipelineRunAction =
  | { type: "begin" }
  | { type: "observed-running" }
  | { type: "complete" }
  | { type: "reset" };

const initialPipelineRunState: PipelineRunState = {
  requested: false,
  observedRunning: false,
};

function pipelineRunReducer(state: PipelineRunState, action: PipelineRunAction): PipelineRunState {
  switch (action.type) {
    case "begin":
      return { requested: true, observedRunning: false };
    case "observed-running":
      return state.observedRunning ? state : { ...state, observedRunning: true };
    case "complete":
      return { requested: false, observedRunning: state.observedRunning };
    case "reset":
      return initialPipelineRunState;
  }
}

export function PipelineRunButton({ onCompleted }: PipelineRunButtonProps) {
  return (
    <PermissionGate requires="accounting.invoices.manage_retention">
      <PipelineRunButtonControl onCompleted={onCompleted} />
    </PermissionGate>
  );
}

function PipelineRunButtonControl({ onCompleted }: PipelineRunButtonProps) {
  const runPipeline = useRunPipeline();
  const [runState, dispatchRunState] = useReducer(pipelineRunReducer, initialPipelineRunState);
  const requestedLastRunRef = useRef<string | null>(null);
  const completedRunRef = useRef<string | null>(null);
  const { data: pipelineStatus } = usePipelineStatus(5_000, runState.requested);
  const running = runPipeline.isPending || runState.requested || pipelineStatus?.running === true;

  useEffect(() => {
    if (!runState.requested || !pipelineStatus?.running) return;
    dispatchRunState({ type: "observed-running" });
  }, [pipelineStatus, runState.requested]);

  useEffect(() => {
    if (!runState.requested || pipelineStatus?.running || !pipelineStatus?.lastResult) return;

    const lastRunChanged =
      Boolean(pipelineStatus.lastRun) && pipelineStatus.lastRun !== requestedLastRunRef.current;
    if (!runState.observedRunning && !lastRunChanged) return;

    const runKey = pipelineStatus.lastRun ?? "completed-without-timestamp";
    if (completedRunRef.current === runKey) return;

    completedRunRef.current = runKey;
    dispatchRunState({ type: "complete" });
    if (pipelineStatus.lastResult.failed) {
      toast.error("Inbox scan failed", {
        description: "The scan did not finish cleanly. Check the pipeline logs and try again.",
      });
    } else {
      toast.success("Inbox scan complete", {
        description: formatRunSummary(pipelineStatus.lastResult) ?? "The invoice inbox has been checked.",
      });
    }
    onCompleted?.();
  }, [onCompleted, pipelineStatus, runState]);

  function handleRunPipeline() {
    requestedLastRunRef.current = pipelineStatus?.lastRun ?? null;
    completedRunRef.current = null;
    dispatchRunState({ type: "begin" });
    runPipeline.mutate(undefined, {
      onSuccess: () => {
        toast.success("Pipeline started", {
          description: "Checking the invoice inbox now.",
        });
      },
      onError: (error: Error) => {
        if (isApiError(error) && error.status === 409) {
          // A 409 is an authoritative observation that the server is already
          // running — count it toward the completion invariant (A-7). If the
          // cached status predates the concurrent run (not running), consume
          // its run key so the stale snapshot cannot satisfy completion; the
          // concurrent run stamped a fresh lastRun, so its completion still
          // registers.
          if (!pipelineStatus?.running) {
            completedRunRef.current = pipelineStatus?.lastRun ?? "completed-without-timestamp";
          }
          dispatchRunState({ type: "observed-running" });
          return;
        }

        dispatchRunState({ type: "reset" });
        toast.error("Failed to start pipeline", {
          description: error.message || "Please try again.",
        });
      },
    });
  }

  const Icon = running ? Loader2 : RefreshCw;

  return (
    <span className="inline-flex">
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-2 px-3.5 text-sm font-semibold"
        disabled={running}
        onClick={handleRunPipeline}
        type="button"
      >
        <Icon className={running ? "h-4 w-4 animate-spin duration-spin" : "h-4 w-4"} aria-hidden="true" />
        {running ? "Scanning..." : "Scan Now"}
      </Button>
    </span>
  );
}
