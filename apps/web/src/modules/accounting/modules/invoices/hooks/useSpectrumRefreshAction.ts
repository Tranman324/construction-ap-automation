"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useRefreshSpectrum } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { useSpectrumRefreshStatus } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { SpectrumRefreshStatus } from "@/modules/accounting/modules/invoices/types/api";
import type { DocumentAction } from "@/modules/accounting/modules/invoices/types/documentSpec";
import { toast } from "@/modules/shared/components/ui/toaster";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";

type SyncStatus = "idle" | "running" | "success" | "error";

const COOLDOWN_SECS = 60;
const SPECTRUM_REFRESH_PERMISSION = "accounting.invoices.submit_spectrum";

interface SpectrumRefreshActionOptions {
  enabled?: boolean;
}

function formatRefreshSummary(lastResult: SpectrumRefreshStatus["lastResult"]): string {
  if (!lastResult) return "Vendor, job, subcontract, routing, and phase lists are up to date.";

  return [
    `${lastResult.vendors.toLocaleString()} vendors`,
    `${lastResult.jobs.toLocaleString()} jobs`,
    `${lastResult.subcontracts.toLocaleString()} subcontracts`,
  ].join(" · ");
}

export function useSpectrumRefreshAction({
  enabled = true,
}: SpectrumRefreshActionOptions = {}): DocumentAction | undefined {
  const queryClient = useQueryClient();
  const { hasAnyPermission } = usePermissions();
  const allowed = hasAnyPermission([SPECTRUM_REFRESH_PERMISSION]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [polling, setPolling] = useState(false);
  const [cooldownSecs, setCooldownSecs] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { data: refreshStatus } = useSpectrumRefreshStatus(
    polling ? 3000 : undefined,
    { enabled: enabled && allowed },
  );
  const { mutate: triggerRefresh, isPending: isTriggering } = useRefreshSpectrum();

  useEffect(() => {
    if (!enabled || !allowed) return;

    if (refreshStatus?.running && !polling && syncStatus === "idle") {
      const timeout = setTimeout(() => {
        setSyncStatus("running");
        setPolling(true);
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [allowed, enabled, polling, refreshStatus?.running, syncStatus]);

  useEffect(() => {
    if (!enabled || !allowed || !polling || !refreshStatus || refreshStatus.running) return;

    const timeout = setTimeout(() => {
      setPolling(false);
      setSyncStatus("success");

      void queryClient.invalidateQueries({ queryKey: ["vendors"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["subcontracts"] });
      void queryClient.invalidateQueries({ queryKey: ["routingCodes"] });
      void queryClient.invalidateQueries({ queryKey: ["phaseCodes"] });
      void queryClient.invalidateQueries({ queryKey: ["phase-options"] });

      toast.success("Spectrum sync complete", {
        description: formatRefreshSummary(refreshStatus.lastResult),
      });

      setCooldownSecs(COOLDOWN_SECS);
      cooldownRef.current = setInterval(() => {
        setCooldownSecs((seconds) => {
          if (seconds <= 1) {
            if (cooldownRef.current) clearInterval(cooldownRef.current);
            cooldownRef.current = null;
            setSyncStatus("idle");
            return 0;
          }

          return seconds - 1;
        });
      }, 1000);
    }, 0);

    return () => clearTimeout(timeout);
  }, [allowed, enabled, polling, queryClient, refreshStatus]);

  useEffect(() => () => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
  }, []);

  return useMemo<DocumentAction | undefined>(() => {
    if (!enabled || !allowed) return undefined;

    const isRunning = syncStatus === "running" || isTriggering;
    const isCoolingDown = cooldownSecs > 0;

    return {
      id: "sync-spectrum",
      label: isRunning ? "Syncing Spectrum" : isCoolingDown ? `Sync Spectrum (${cooldownSecs}s)` : "Sync Spectrum",
      icon: RefreshCw,
      disabled: isRunning || isCoolingDown,
      pending: isRunning,
      onClick: () => {
        if (isRunning || isCoolingDown) return;

        setSyncStatus("running");
        triggerRefresh(undefined, {
          onSuccess: () => setPolling(true),
          onError: (error: Error & { status?: number }) => {
            const isAlreadyRunning = error.message?.includes("409") || error.status === 409;
            if (isAlreadyRunning) {
              setPolling(true);
              return;
            }

            setSyncStatus("error");
            toast.error("Spectrum sync failed", {
              description: error.message || "Try again in a moment.",
            });
            window.setTimeout(() => setSyncStatus("idle"), 4000);
          },
        });
      },
    };
  }, [allowed, cooldownSecs, enabled, isTriggering, syncStatus, triggerRefresh]);
}
