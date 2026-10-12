import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { createElement, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  formatShortcutTooltip,
  getDocumentShortcutCommandForPlatform,
  getDocumentShortcutLabels,
  getDocumentShortcutPlatform,
  isEditableShortcutTarget,
  runDocumentShortcutAction,
  useDocumentPanelKeyboardShortcuts,
} from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";
import { shouldRenderDocumentPanelRoute } from "@/modules/accounting/modules/invoices/lib/documentRouting";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";

function ShortcutHarness({ run, undo, previous, next, save, toggleFlag, download, selectAll, settings, escape, search, comment, reply, forward, available }: { run?: () => void; undo?: () => void; previous?: () => void; next?: () => void; save?: () => void; toggleFlag?: () => void; download?: () => void; selectAll?: () => void; settings?: () => void; escape?: () => void; search?: () => void; comment?: () => void; reply?: () => void; forward?: () => void; available?: () => boolean }) {
  const primaryActionRef = useRef(null);
  useDocumentPanelKeyboardShortcuts({
    primaryActionRef,
    undoAction: undo ? { run: undo } : null,
    previousAction: previous ? { run: previous } : null,
    nextAction: next ? { run: next } : null,
    saveAction: save ? { run: save } : null,
    toggleFlagAction: toggleFlag ? { run: toggleFlag } : null,
    discardAction: run ? { run, available } : null,
    selectAllAction: selectAll ? { run: selectAll } : null,
    downloadAction: download ? { run: download } : null,
    settingsAction: settings ? { run: settings } : null,
    escapeAction: escape ? { run: escape } : null,
    searchAction: search ? { run: search } : null,
    commentAction: comment ? { run: comment } : null,
    replyAction: reply ? { run: reply } : null,
    forwardAction: forward ? { run: forward } : null,
  });
  return createElement("input", { "aria-label": "field" });
}

function GenericRouteOwnerHarness({ onComment, genericRoute }: { onComment: () => void; genericRoute: boolean }) {
  const primaryActionRef = useRef(null);
  useDocumentPanelKeyboardShortcuts({
    primaryActionRef,
    undoAction: null,
    previousAction: null,
    nextAction: null,
    commentAction: genericRoute ? { label: "Comment", run: onComment } : null,
  });
  return createElement("div", { "data-testid": "generic-route-owner" });
}

describe("documentPanelShortcuts", () => {
  it("formats shortcut labels by platform", () => {
    expect(getDocumentShortcutPlatform("MacIntel")).toBe("apple");
    expect(getDocumentShortcutLabels("apple").primary).toBe("⌘ Enter");
    expect(getDocumentShortcutLabels("control").primary).toBe("Ctrl Enter");
  });

  it("appends shortcut hints to tooltip text", () => {
    expect(formatShortcutTooltip("Approve", "⌘ Enter")).toBe("Approve • ⌘ Enter");
  });

  it("maps modified keys to document commands", () => {
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }), "control")).toBe("primary");
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }), "control")).toBe("undo");
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "ArrowLeft", ctrlKey: true }), "control")).toBe("previous");
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true }), "control")).toBe("next");
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "Enter" }), "control")).toBeNull();
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "Enter", metaKey: true }), "apple")).toBe("primary");
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "s", metaKey: true }), "apple")).toBe("save");
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "f", metaKey: true, shiftKey: true }), "apple")).toBe("toggleFlag");
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true }), "control")).toBe("discard");
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, shiftKey: true }), "control")).toBe("download");
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "/" }), "control")).toBe("search");
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "c" }), "control")).toBe("comment");
    expect(getDocumentShortcutCommandForPlatform(new KeyboardEvent("keydown", { key: "Escape" }), "control")).toBe("escape");
  });

  it("detects editable targets for native undo/navigation preservation", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");

    expect(isEditableShortcutTarget(input)).toBe(true);
    expect(isEditableShortcutTarget(button)).toBe(false);
  });

  it("does not run disabled shortcut actions", () => {
    const run = vi.fn();

    expect(runDocumentShortcutAction({ disabled: true, run })).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(runDocumentShortcutAction({ disabled: false, run })).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(runDocumentShortcutAction({ available: () => false, run })).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(runDocumentShortcutAction({ label: "Save", available: () => false, run })).toBe(false);
    expect(runDocumentShortcutAction({ label: "Discard", available: () => false, run })).toBe(false);
  });

  it("guards discard in editable fields and prevents the handled shortcut", () => {
    const run = vi.fn();
    render(createElement(ShortcutHarness, { run }));
    const field = document.querySelector("input");
    const event = new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true, bubbles: true, cancelable: true });
    field?.dispatchEvent(event);
    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    const bodyEvent = new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(bodyEvent);
    expect(run).toHaveBeenCalledTimes(1);
    expect(bodyEvent.defaultPrevented).toBe(true);
  });

  it("leaves no-op discard shortcuts untouched", () => {
    const run = vi.fn();
    render(createElement(ShortcutHarness, { run, available: () => false }));
    const event = new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("fires the production generic-route owner once", () => {
    const onComment = vi.fn();
    const mappings: ClassificationInfo[] = [
      { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
      { name: "receipt", label: "Receipt", opensAs: "receipt", action: "view-only", builtIn: true, status: "active" },
    ];
    const genericRoute = shouldRenderDocumentPanelRoute("receipt", mappings);
    expect(genericRoute).toBe(true);
    expect(shouldRenderDocumentPanelRoute("invoice", mappings)).toBe(false);
    render(createElement(GenericRouteOwnerHarness, { onComment, genericRoute }));
    const event = new KeyboardEvent("keydown", { key: "c", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(onComment).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps the invoice route wired to the shared generic ownership decision", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/(dashboard)/accounting/invoices/[id]/page.tsx"), "utf8");
    expect(source).toContain("const genericRouteOwnsShortcuts = Boolean(invoice && shouldRenderDocumentPanelRoute(invoice.classification, classificationMappings));");
    expect(source).toContain("downloadAction: genericRouteOwnsShortcuts ? null");
    expect(source).toContain("commentAction: genericRouteOwnsShortcuts ? null");
    expect(source).toContain("replyAction: genericRouteOwnsShortcuts ? null");
    expect(source).toContain("forwardAction: genericRouteOwnsShortcuts ? null");
  });

  it("preserves native undo and document navigation in editable fields", () => {
    const undo = vi.fn();
    const previous = vi.fn();
    const next = vi.fn();
    render(createElement(ShortcutHarness, { undo, previous, next }));
    const field = document.querySelector("input");
    for (const event of [
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "ArrowLeft", ctrlKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, bubbles: true, cancelable: true }),
    ]) field?.dispatchEvent(event);
    expect(undo).not.toHaveBeenCalled();
    expect(previous).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("allows safe new shortcuts from editable fields", () => {
    const save = vi.fn();
    const toggleFlag = vi.fn();
    const download = vi.fn();
    const selectAll = vi.fn();
    const settings = vi.fn();
    const escape = vi.fn();
    render(createElement(ShortcutHarness, { save, toggleFlag, download, selectAll, settings, escape }));
    const field = document.querySelector("input");
    const events = [
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "f", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ];
    for (const event of events) {
      field?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(save).toHaveBeenCalledTimes(1);
    expect(toggleFlag).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
    expect(selectAll).toHaveBeenCalledTimes(1);
    expect(settings).toHaveBeenCalledTimes(1);
    expect(escape).toHaveBeenCalledTimes(1);
  });

  it("keeps text-editing conflicts blocked for search and collaboration letters", () => {
    const search = vi.fn();
    const comment = vi.fn();
    const reply = vi.fn();
    const forward = vi.fn();
    const run = vi.fn();
    render(createElement(ShortcutHarness, { search, comment, reply, forward, run }));
    const field = document.querySelector("input");
    for (const event of [
      new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "c", bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "f", bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true, bubbles: true, cancelable: true }),
    ]) {
      field?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(search).not.toHaveBeenCalled();
    expect(comment).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("preserves editable-field protection for undo and navigation shortcuts", () => {
    const undo = vi.fn();
    const previous = vi.fn();
    const next = vi.fn();
    render(createElement(ShortcutHarness, { undo, previous, next }));
    const field = document.querySelector("input")!;
    for (const event of [
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "ArrowLeft", ctrlKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, bubbles: true, cancelable: true }),
    ]) {
      field.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(undo).not.toHaveBeenCalled();
    expect(previous).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
