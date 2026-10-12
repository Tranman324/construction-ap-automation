"use client";

import { useState } from "react";
import { BookOpenText } from "lucide-react";

import { usePreviewTitleRule } from "@/modules/platform-admin/hooks/mutations";
import type { TitleRule, TitleRulePreviewResponse } from "@/modules/platform-admin/types/admin";
import { AdminFieldHelp } from "@/modules/platform-admin/components/AdminFieldHelp";
import { AdminInlineNotice } from "@/modules/platform-admin/components/AdminInlineNotice";
import { formatAdminRoleLabel } from "@/modules/platform-admin/lib/adminRoles";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/modules/shared/components/ui/card";
import { Input } from "@/modules/shared/components/ui/input";

type PreviewState =
  | { status: "idle" }
  | { status: "matched"; rule: TitleRule }
  | { status: "unmatched" };

function getPreviewErrorMessage(error: Error) {
  if (error.message.trim().length > 0) {
    return error.message;
  }

  return "Failed to preview title rule.";
}

export function TitleRulePreviewPanel() {
  const previewRule = usePreviewTitleRule();
  const [previewJobTitle, setPreviewJobTitle] = useState("");
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>({ status: "idle" });

  function handlePreview() {
    const jobTitle = previewJobTitle.trim();

    if (jobTitle.length === 0) {
      setPreviewMessage("Job title is required for preview.");
      setPreviewState({ status: "idle" });
      return;
    }

    previewRule.mutate(
      { jobTitle },
      {
        onSuccess: (result: TitleRulePreviewResponse) => {
          setPreviewMessage(null);
          setPreviewState(
            result.matched ? { status: "matched", rule: result.matched } : { status: "unmatched" },
          );
        },
        onError: (error) => {
          setPreviewMessage(getPreviewErrorMessage(error));
          setPreviewState({ status: "idle" });
        },
      },
    );
  }

  return (
    <Card className="border-border/60 bg-card/90 shadow-sm shadow-primary/5 backdrop-blur-sm">
      <CardHeader className="gap-3 border-b border-border/50 pb-5">
        <div className="flex items-start gap-3">
          <div className="rounded-full border border-primary/15 bg-primary/[0.07] p-2 text-primary">
            <BookOpenText className="h-4 w-4" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-lg text-foreground">Preview rule matching</CardTitle>
            <CardDescription className="text-sm leading-6">
              Send exactly one job title through the preview endpoint to confirm the highest-priority active match.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 py-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor="title-rule-preview-job-title" className="text-sm font-medium text-foreground">Preview job title</label>
              <AdminFieldHelp label="Preview job title" description="A sample job title sent to the preview endpoint to show which active rule would assign a role." />
            </div>
            <Input
              id="title-rule-preview-job-title"
              value={previewJobTitle}
              onChange={(event) => setPreviewJobTitle(event.target.value)}
              placeholder="Project Executive"
              aria-label="Preview job title"
            />
          </div>
          <Button type="button" onClick={handlePreview} disabled={previewRule.isPending}>
            {previewRule.isPending ? "Checking..." : "Run preview"}
          </Button>
        </div>

        {previewMessage ? <AdminInlineNotice tone="error" message={previewMessage} /> : null}
        {previewState.status === "matched" ? (
          <div data-testid="title-rule-preview-result" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-foreground">
            <p className="font-semibold">Matched {previewState.rule.pattern}</p>
            <p className="mt-1 text-muted-foreground">Role: {formatAdminRoleLabel(previewState.rule.role_name, "Unknown role")}</p>
          </div>
        ) : null}
        {previewState.status === "unmatched" ? (
          <div data-testid="title-rule-preview-result" className="rounded-xl border border-border/50 bg-background/70 p-4 text-sm text-muted-foreground">
            No active rule matched
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}