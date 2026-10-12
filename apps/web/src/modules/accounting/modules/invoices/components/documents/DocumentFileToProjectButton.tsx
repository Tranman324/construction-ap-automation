"use client";

import { CheckCircle2, FolderOpen, Loader2 } from "lucide-react";

import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

interface DocumentFileToProjectButtonProps {
  filed: boolean;
  disabled?: boolean;
  pending?: boolean;
  onClick: () => void | Promise<void>;
}

export function DocumentFileToProjectButton({
  filed,
  disabled,
  pending,
  onClick,
}: DocumentFileToProjectButtonProps) {
  const Icon = pending ? Loader2 : filed ? CheckCircle2 : FolderOpen;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-1.5 text-xs", pending && "[&_svg]:animate-spin")}
      disabled={disabled || pending}
      onClick={() => void onClick()}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {filed ? "Filed to Project" : "File to Project"}
    </Button>
  );
}
