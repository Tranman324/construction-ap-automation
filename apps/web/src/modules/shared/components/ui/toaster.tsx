"use client"

import { Toaster as Sonner } from "sonner"
import { useTheme } from "next-themes"

interface DocumentToastAnchor {
  left: number;
  bottom: number;
}

interface DocumentToastAnchorEventDetail {
  anchor: DocumentToastAnchor | null;
}

declare global {
  interface Window {
    __toolboxDocumentToastAnchor?: DocumentToastAnchor | null;
  }
}

const DOCUMENT_TOAST_ANCHOR_EVENT = "toolbox:document-toast-anchor";

/** Legacy viewer metadata API retained for callers; Toolbox toasts now share one corner. */
export function setDocumentToastAnchor(anchor: DocumentToastAnchor | null): void {
  if (typeof window === "undefined") return;
  window.__toolboxDocumentToastAnchor = anchor;
  window.dispatchEvent(new CustomEvent<DocumentToastAnchorEventDetail>(
    DOCUMENT_TOAST_ANCHOR_EVENT,
    { detail: { anchor } },
  ));
}

// ─── Toaster ──────────────────────────────────────────────────────────────────

/**
 * Toaster — drop the <Toaster /> once in your root layout.
 * Automatically tracks the active theme (light/dark/system).
 *
 * @example
 * // app/layout.tsx
 * import { Toaster } from "@/modules/shared/components/ui/toaster"
 * <Toaster />
 *
 * // Anywhere in the app:
 * import { toast } from "@/modules/shared/components/ui/toaster"
 * toast.success("Profile saved")
 * toast.error("Failed to save", { description: "Check your connection and try again." })
 */
export function Toaster() {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={(theme as "light" | "dark" | "system") ?? "system"}
      className="toaster group toaster--global"
      position="bottom-left"
      offset={16}
      mobileOffset={12}
      gap={8}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
    />
  )
}

// Re-export toast() so consumers can import from one place if they prefer
export { toast } from "sonner"
