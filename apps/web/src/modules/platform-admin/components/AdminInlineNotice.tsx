import { InlineNotice } from "@/modules/shared/components/patterns";

interface AdminInlineNoticeProps {
  tone: "error" | "success";
  message: string;
}

export function AdminInlineNotice({ tone, message }: AdminInlineNoticeProps) {
  return (
    <InlineNotice
      tone={tone}
      role={tone === "error" ? "alert" : "status"}
      icon={null}
      className="px-3 py-2 text-xs"
    >
      {message}
    </InlineNotice>
  );
}
