"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { useClassifications, useIgnoreRules } from "@/modules/accounting/modules/invoices/hooks/queries";
import { useAddIgnoreRule, useDeleteIgnoreRule } from "@/modules/accounting/modules/invoices/hooks/mutations";
import type { IgnoreRule } from "@/modules/accounting/modules/invoices/types/api";

import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/modules/shared/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import { Separator } from "@/modules/shared/components/ui/separator";
import { RetentionPoliciesSection } from "@/modules/accounting/modules/invoices/components/settings/RetentionPoliciesSection";
import { cn } from "@/modules/shared/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

type RuleType = "sender" | "domain" | "classification";

// ─── Badge color helpers ──────────────────────────────────────────────────────

function ruleTypeBadge(type: RuleType) {
  switch (type) {
    case "sender":
      return "border-blue-400 text-blue-700 dark:text-blue-400";
    case "domain":
      return "border-purple-400 text-purple-700 dark:text-purple-400";
    case "classification":
      return "border-orange-400 text-orange-700 dark:text-orange-400";
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface IgnoreRulesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function IgnoreRulesPanel({ open, onOpenChange }: IgnoreRulesPanelProps) {
  // ── Queries / Mutations ───────────────────────────────────────────────────
  const { data: rules, isLoading } = useIgnoreRules();
  const { classifications, isError: classificationsError, isLoading: classificationsLoading } = useClassifications();
  const addRule = useAddIgnoreRule();
  const deleteRule = useDeleteIgnoreRule();

  // ── Add-rule form state ───────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [ruleType, setRuleType] = useState<RuleType | "">("");
  const [ruleValue, setRuleValue] = useState("");
  const [ruleReason, setRuleReason] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // ── Inline delete confirmation state ─────────────────────────────────────
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // ── Sorted rules ─────────────────────────────────────────────────────────
  const sortedRules: IgnoreRule[] = [...(rules ?? [])].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.value.localeCompare(b.value);
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  function resetForm() {
    setRuleType("");
    setRuleValue("");
    setRuleReason("");
    setAddError(null);
  }

  function toggleForm() {
    if (showForm) {
      resetForm();
    }
    setShowForm((v) => !v);
  }

  function handleSubmit() {
    if (!ruleType || !ruleValue.trim()) return;
    setAddError(null);
    addRule.mutate(
      { type: ruleType, value: ruleValue.trim(), reason: ruleReason.trim() },
      {
        onSuccess: () => {
          resetForm();
          setShowForm(false);
        },
        onError: (err: Error) => {
          setAddError(err.message ?? "Failed to add rule.");
        },
      }
    );
  }

  function handleDelete(id: string) {
    deleteRule.mutate(
      { id },
      {
        onSuccess: () => setConfirmingDeleteId(null),
      }
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <PermissionGate requires="accounting.invoices.manage_retention">
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-[480px] sm:max-w-[480px] flex flex-col gap-0 p-0"
        >
        {/* ── Panel Header ─────────────────────────────────────────────── */}
        <SheetHeader className="px-5 py-4 border-b flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="text-base">Ignore Rules</SheetTitle>
              <SheetDescription className="text-xs mt-0.5">
                Manage retention policies and ignore rules for incoming documents.
              </SheetDescription>
            </div>
            <Button
              variant={showForm ? "outline" : "default"}
              size="sm"
              className="shrink-0 mt-0.5"
              onClick={toggleForm}
            >
              {showForm ? "Cancel" : "Add Ignore Rule"}
            </Button>
          </div>
        </SheetHeader>

        {/* ── Add Rule Form ─────────────────────────────────────────────── */}
        {showForm && (
          <div className="px-5 py-4 border-b bg-muted/30 flex-shrink-0 space-y-3">
            {/* Row 1 — Type */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Rule type
              </label>
              <Select
                value={ruleType}
                onValueChange={(v) => {
                  setRuleType(v as RuleType);
                  setRuleValue("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sender">Sender</SelectItem>
                  <SelectItem value="domain">Domain</SelectItem>
                  <SelectItem value="classification">Classification</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Row 2 — Value (conditional) */}
            {ruleType && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {ruleType === "sender"
                    ? "Email address"
                    : ruleType === "domain"
                    ? "Domain"
                    : "Classification"}
                </label>
                {ruleType === "classification" && (classificationsError || classificationsLoading) ? (
                  <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    Classification options unavailable
                  </p>
                ) : ruleType === "classification" ? (
                  <Select
                    value={ruleValue}
                    onValueChange={setRuleValue}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select classification…" />
                    </SelectTrigger>
                    <SelectContent>
                      {classifications.filter((classification) => classification.status === "active").map((classification) => (
                        <SelectItem key={classification.name} value={classification.name}>
                          {classification.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={ruleValue}
                    onChange={(e) => setRuleValue(e.target.value)}
                    placeholder={
                      ruleType === "sender"
                        ? "e.g. invoices@vendor.example"
                        : "e.g. vendor.example"
                    }
                  />
                )}
              </div>
            )}

            {/* Row 3 — Reason */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Reason{" "}
                <span className="text-muted-foreground/60 font-normal">
                  (optional)
                </span>
              </label>
              <Input
                value={ruleReason}
                onChange={(e) => setRuleReason(e.target.value)}
                placeholder="Why is this being ignored?"
              />
            </div>

            {/* Inline error */}
            {addError && (
              <p className="text-xs text-destructive">{addError}</p>
            )}

            {/* Submit */}
            <Button
              className="w-full"
              disabled={!ruleType || !ruleValue.trim() || addRule.isPending}
              onClick={handleSubmit}
            >
              {addRule.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />
                  Adding…
                </span>
              ) : (
                "Add Rule"
              )}
            </Button>
          </div>
        )}

        {/* ── Rules List ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 border-b">
            <RetentionPoliciesSection />
          </div>

          <div className="px-5 py-3 border-b bg-muted/20">
            <p className="text-sm font-semibold">Ignore Rules</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically filter recurring unwanted email traffic.
            </p>
          </div>

          {isLoading ? (
            <div className="px-5 py-4 space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : sortedRules.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No ignore rules configured. Add rules to automatically filter
                recurring unwanted emails.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {sortedRules.map((rule) => (
                <li key={rule.id} className="px-5 py-3">
                  {confirmingDeleteId === rule.id ? (
                    /* ── Inline delete confirmation ────────────────────── */
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground flex-1">
                        Remove this rule?
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={deleteRule.isPending}
                        onClick={() => handleDelete(rule.id)}
                        className="h-7 px-3 text-xs"
                      >
                        {deleteRule.isPending ? "Removing…" : "Confirm"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deleteRule.isPending}
                        onClick={() => setConfirmingDeleteId(null)}
                        className="h-7 px-3 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    /* ── Normal rule row ────────────────────────────────── */
                    <div className="flex items-center gap-2.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 capitalize text-xs",
                          ruleTypeBadge(rule.type)
                        )}
                      >
                        {rule.type}
                      </Badge>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {rule.value}
                        </p>
                        {rule.reason && (
                          <p className="text-xs text-muted-foreground italic truncate">
                            {rule.reason}
                          </p>
                        )}
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        aria-label={`Delete rule for ${rule.value}`}
                        onClick={() => setConfirmingDeleteId(rule.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Separator />
        </div>
        </SheetContent>
      </Sheet>
    </PermissionGate>
  );
}
