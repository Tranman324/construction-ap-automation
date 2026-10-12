const FOCUSABLE = "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])";

/**
 * Scrolls a rendered document section into view and focuses the field to fix; returns false when the
 * section is not rendered or sits inside a hidden tab panel (so the caller can fall back instead of
 * "revealing" something the person cannot see).
 */
export function revealDocumentSection(pane: HTMLElement, sectionId: string, fieldId?: string): boolean {
  const section = Array.from(pane.querySelectorAll<HTMLElement>("[data-document-section-id]"))
    .find((node) => node.dataset.documentSectionId === sectionId);
  if (!section || section.closest("[hidden]")) return false;
  const field = (fieldId ? Array.from(section.querySelectorAll<HTMLElement>("[data-document-field-id]")).find((node) => node.dataset.documentFieldId === fieldId) : undefined)
    ?? Array.from(section.querySelectorAll<HTMLElement>('[aria-invalid="true"]')).find((node) => node.matches(FOCUSABLE));
  // Scroll the field itself when there is one so the pane's scroll-padding keeps it clear of the floating tray.
  if (field) field.scrollIntoView({ block: "center", behavior: "smooth" });
  else section.scrollIntoView({ block: "start", behavior: "smooth" });
  const target = field ?? section.querySelector<HTMLElement>("h3");
  if (!target) return true;
  if (!field && !target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  return true;
}
