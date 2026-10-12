"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { cn } from "@/modules/shared/lib/utils";

interface InlinePageSearchProps {
  ariaLabel?: string;
  className?: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
}

export function InlinePageSearch({
  ariaLabel,
  className,
  placeholder,
  value,
  onValueChange,
}: InlinePageSearchProps) {
  return (
    <div className={cn("relative w-full", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label={ariaLabel ?? placeholder}
        className="h-9 rounded-lg border-border/70 bg-background/80 pl-9 pr-9 shadow-sm transition-colors focus-visible:border-primary/30 focus-visible:ring-primary/20"
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      {value ? (
        <Button
          aria-label="Clear search"
          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => onValueChange("")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}