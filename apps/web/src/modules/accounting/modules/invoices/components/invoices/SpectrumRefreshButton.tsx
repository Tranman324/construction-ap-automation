"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useSpectrumRefreshStatus } from "@/modules/accounting/modules/invoices/hooks/queries";
import { useRefreshSpectrum } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Button } from "@/modules/shared/components/ui/button";
import type { SpectrumRefreshStatus } from "@/modules/accounting/modules/invoices/types/api";

type SyncStatus = "idle" | "running" | "success" | "error";

// Minimum seconds between manual triggers (client-side rate limit)
const COOLDOWN_SECS = 60;

export function SpectrumRefreshButton() {
  const queryClient = useQueryClient();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastResult, setLastResult] = useState<SpectrumRefreshStatus["lastResult"]>(null);
  const [polling, setPolling] = useState(false);
  const [cooldownSecs, setCooldownSecs] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Always fetch status once on mount; poll every 3 s when waiting
  const { data: refreshStatus } = useSpectrumRefreshStatus(polling ? 3000 : undefined);

  // If server is already running on mount, start polling immediately
  useEffect(() => {
    if (refreshStatus?.running && !polling && syncStatus === "idle") {
      setSyncStatus("running");
      setPolling(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshStatus?.running]);

  // When polling and server says done — stop, show result, invalidate caches
  useEffect(() => {
    if (!polling || !refreshStatus || refreshStatus.running) return;

    setPolling(false);
    setLastResult(refreshStatus.lastResult);
    setSyncStatus("success");

    // Refresh vendor/job/subcontract dropdowns with the new Spectrum data
    void queryClient.invalidateQueries({ queryKey: ["vendors"] });
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    void queryClient.invalidateQueries({ queryKey: ["subcontracts"] });
    void queryClient.invalidateQueries({ queryKey: ["routingCodes"] });
    void queryClient.invalidateQueries({ queryKey: ["phaseCodes"] });

    // Start cooldown countdown
    setCooldownSecs(COOLDOWN_SECS);
    cooldownRef.current = setInterval(() => {
      setCooldownSecs((s) => {
        if (s <= 1) {
          clearInterval(cooldownRef.current!);
          cooldownRef.current = null;
          setSyncStatus("idle");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, [polling, refreshStatus, queryClient]);

  // Clean up interval on unmount
  useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }, []);

  const { mutate: triggerRefresh, isPending: isTriggering } = useRefreshSpectrum();

  function handleClick() {
    if (cooldownSecs > 0 || syncStatus === "running" || isTriggering) return;
    setSyncStatus("running");
    triggerRefresh(undefined, {
      onSuccess: () => setPolling(true),
      onError: (err: Error & { status?: number }) => {
        // 409 = already running on the server — treat as running, start polling
        const is409 = err.message?.includes("409") || (err as { status?: number }).status === 409;
        if (is409) {
          setPolling(true);
        } else {
          setSyncStatus("error");
          setTimeout(() => setSyncStatus("idle"), 4000);
        }
      },
    });
  }

  const isRunning = syncStatus === "running" || isTriggering;
  const isDisabled = isRunning || cooldownSecs > 0;

  return (
    <PermissionGate requires="accounting.invoices.submit_spectrum">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-7 text-xs"
          disabled={isDisabled}
          onClick={handleClick}
          title={
            cooldownSecs > 0
              ? `Next sync available in ${cooldownSecs}s`
              : "Refresh vendor, job, and subcontract data from Spectrum"
          }
        >
          {isRunning ? (
            <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {isRunning ? "Syncing…" : cooldownSecs > 0 ? `Sync (${cooldownSecs}s)` : "Sync"}
        </Button>

        {syncStatus === "success" && lastResult && (
          <span className="text-xs text-green-600 font-medium">
            ✓ {lastResult.vendors.toLocaleString()} vendors · {lastResult.jobs.toLocaleString()} jobs ·{" "}
            {lastResult.subcontracts.toLocaleString()} subcontracts
          </span>
        )}
        {syncStatus === "error" && (
          <span className="text-xs text-destructive font-medium">Sync failed — try again</span>
        )}
      </div>
    </PermissionGate>
  );
}
