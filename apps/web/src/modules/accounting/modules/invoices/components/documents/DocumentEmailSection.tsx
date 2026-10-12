"use client";

import { useEffect, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronUp, Mail } from "lucide-react";

import type { InvoiceEmail } from "@/modules/accounting/modules/invoices/types/invoice";
import { cn } from "@/modules/shared/lib/utils";

export interface DocumentEmailSectionProps {
  email?: InvoiceEmail | null;
  body?: string | null;
  className?: string;
  presentation?: "default" | "glance";
}

const EMAIL_LINK_BASE = '<base target="_blank">';

export function sanitizeDocumentEmailHtml(html: string): string {
  return html
    .replace(/src="cid:[^"]*"/g, 'src=""')
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<base\b[^>]*\/?>/gi, "")
    .replace(/<link\b[^>]*\/?>/gi, "")
    .replace(/<meta\b[^>]+http-equiv\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`)/gi, "")
    .replace(/(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
}

export function prepareDocumentEmailHtmlForFrame(html: string): string {
  const sanitized = sanitizeDocumentEmailHtml(html);
  if (/<head\b[^>]*>/i.test(sanitized)) {
    return sanitized.replace(/<head\b([^>]*)>/i, `<head$1>${EMAIL_LINK_BASE}`);
  }
  if (/<html\b[^>]*>/i.test(sanitized)) {
    return sanitized.replace(/<html\b([^>]*)>/i, `<html$1><head>${EMAIL_LINK_BASE}</head>`);
  }
  return `${EMAIL_LINK_BASE}${sanitized}`;
}

export function cleanEmailPreview(value: string | null | undefined): string {
  if (!value) return "";
  const cautionRe = /^\s*CAUTION\s*:[\s\S]*?content is safe\.?\s*/i;
  return value.replace(cautionRe, "").trim();
}

function formatReceived(value: string | null | undefined): { label: string; title: string } {
  if (!value) return { label: "-", title: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: value, title: value };
  return {
    label: `${format(date, "MMMM d, yyyy")} (${formatDistanceToNow(date, { addSuffix: true })})`,
    title: date.toLocaleString(),
  };
}

export function DocumentEmailSection({
  email,
  body,
  className,
  presentation = "default",
}: DocumentEmailSectionProps) {
  const [bodyOpen, setBodyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const resolvedBody = body ?? email?.body ?? null;
  const preview = cleanEmailPreview(email?.bodyPreview);
  const received = formatReceived(email?.receivedAt);
  const receivedDate = email?.receivedAt ? new Date(email.receivedAt) : null;
  const relativeReceived = receivedDate && !Number.isNaN(receivedDate.getTime())
    ? formatDistanceToNow(receivedDate, { addSuffix: true })
    : received.label;

  useEffect(() => {
    if (!copied) return undefined;
    const timeout = window.setTimeout(() => setCopied(false), 1_600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  function copySender() {
    if (!email?.from) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(email.from).catch(() => undefined);
    }
    setCopied(true);
  }

  return (
    <section aria-label={presentation === "glance" ? "Invoice email" : undefined} className={cn("border-b border-border pb-4", className)}>
      {presentation === "glance" ? (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <button type="button" title="Click to copy email address" onClick={copySender} disabled={!email?.from} className="min-w-0 break-all text-left font-mono text-xs font-semibold text-foreground hover:text-primary">
              {copied ? "Copied!" : email?.from ?? "-"}
            </button>
            <span className="ml-auto whitespace-nowrap text-[11.5px]" title={received.title}>{relativeReceived}</span>
          </div>
          <p className="mt-[7px] break-words text-[13.5px] font-semibold leading-snug text-foreground">{email?.subject ?? "-"}</p>
        </>
      ) : (
        <>
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
          Email
        </p>
      </div>
      <dl className="space-y-1 text-sm">
        <div className="flex items-baseline gap-2">
          <dt className="w-14 shrink-0 text-xs text-muted-foreground">From</dt>
          <dd className="break-all font-mono text-xs text-foreground">
            {email?.from ? (
              <button
                type="button"
                className="cursor-pointer text-left hover:underline"
                title="Click to copy email address"
                onClick={copySender}
              >
                {copied ? <span className="text-green-600">Copied!</span> : email.from}
              </button>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="w-14 shrink-0 text-xs text-muted-foreground">Subject</dt>
          <dd className="min-w-0 flex-1">
            <span className="block truncate text-xs text-foreground" title={email?.subject ?? "-"}>
              {email?.subject ?? "-"}
            </span>
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="w-14 shrink-0 text-xs text-muted-foreground">Received</dt>
          <dd className="text-xs text-foreground" title={received.title}>
            {received.label}
          </dd>
        </div>
      </dl>
        </>
      )}

      {preview ? (
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {preview}
        </p>
      ) : null}

      {resolvedBody ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setBodyOpen((value) => !value)}
            className={cn("flex items-center gap-1 text-xs text-primary hover:underline", presentation === "glance" && "font-semibold")}
          >
            {bodyOpen ? "Hide full email" : "View full email"}
            {bodyOpen ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
          </button>
          {bodyOpen ? (
            <div className="mt-2 overflow-hidden rounded-md border border-border">
              {email?.bodyContentType === "html" ? (
                <iframe
                  srcDoc={prepareDocumentEmailHtmlForFrame(resolvedBody)}
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  className="h-[400px] w-full border-0"
                  title="Email body"
                />
              ) : (
                <div className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words bg-muted/50 p-3 font-mono text-xs text-foreground">
                  {resolvedBody}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
