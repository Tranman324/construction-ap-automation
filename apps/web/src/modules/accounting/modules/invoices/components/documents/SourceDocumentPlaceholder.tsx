import type { ReactNode } from "react";
import { FileDown, FileX } from "lucide-react";

export interface SourceDocumentPlaceholderProps {
  icon: "missing" | "download";
  title: string;
  detail?: string;
  fileName?: string | null;
  action?: ReactNode;
}

export function SourceDocumentPlaceholder({
  icon,
  title,
  detail,
  fileName,
  action,
}: SourceDocumentPlaceholderProps) {
  const Icon = icon === "download" ? FileDown : FileX;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
      <Icon className="h-12 w-12 opacity-30" />
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {fileName ? <p className="mt-1 break-all font-mono text-xs">{fileName}</p> : null}
        {detail ? <p className="mt-2 text-xs text-muted-foreground/75">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}
