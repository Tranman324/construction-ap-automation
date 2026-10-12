"use client";

import { useEffect, useMemo, useSyncExternalStore, type RefObject } from "react";

export type DocumentShortcutCommand =
  | "primary" | "undo" | "previous" | "next"
  | "save" | "toggleFlag" | "discard" | "selectAll" | "download" | "settings" | "escape"
  | "search" | "comment" | "reply" | "forward";
export type DocumentShortcutPlatform = "apple" | "control";

export interface DocumentPanelShortcutAction {
  label?: string;
  disabled?: boolean;
  available?: () => boolean;
  run?: () => void | Promise<void>;
}

export interface DocumentPanelShortcutLabels {
  primary: string;
  undo: string;
  previous: string;
  next: string;
  primaryAria: string;
  undoAria: string;
  previousAria: string;
  nextAria: string;
  save: string;
  toggleFlag: string;
  discard: string;
  selectAll: string;
  download: string;
  settings: string;
  search: string;
  comment: string;
  reply: string;
  forward: string;
  escape: string;
}

export function getDocumentShortcutPlatform(platform: string, userAgent = ""): DocumentShortcutPlatform {
  const source = `${platform} ${userAgent}`;
  return /Mac|iPhone|iPad|iPod/.test(source) ? "apple" : "control";
}

export function getDocumentShortcutLabels(platform: DocumentShortcutPlatform): DocumentPanelShortcutLabels {
  const modifier = platform === "apple" ? "⌘" : "Ctrl";
  const ariaModifier = platform === "apple" ? "Meta" : "Control";
  return {
    primary: `${modifier} Enter`,
    undo: `${modifier} Z`,
    previous: `${modifier} ←`,
    next: `${modifier} →`,
    primaryAria: `${ariaModifier}+Enter`,
    undoAria: `${ariaModifier}+Z`,
    previousAria: `${ariaModifier}+ArrowLeft`,
    nextAria: `${ariaModifier}+ArrowRight`,
    save: `${modifier} S`,
    toggleFlag: `${modifier} ⇧ F`,
    discard: `${modifier} ⌫`,
    selectAll: `${modifier} ⇧ A`,
    download: platform === "apple" ? "⌘ ⇧ D" : "Ctrl ⇧ S",
    settings: `${modifier} ,`,
    search: "/",
    comment: "C",
    reply: "R",
    forward: "F",
    escape: "Esc",
  };
}

export function formatShortcutTooltip(label: string, shortcut: string): string {
  return `${label} • ${shortcut}`;
}

function subscribeToShortcutPlatform() {
  return () => {};
}

function getBrowserShortcutPlatform(): DocumentShortcutPlatform {
  if (typeof window === "undefined") return "control";
  return getDocumentShortcutPlatform(window.navigator.platform, window.navigator.userAgent);
}

function getServerShortcutPlatform(): DocumentShortcutPlatform {
  return "control";
}

export function useDocumentShortcutLabels(): DocumentPanelShortcutLabels {
  const platform = useSyncExternalStore(
    subscribeToShortcutPlatform,
    getBrowserShortcutPlatform,
    getServerShortcutPlatform,
  );
  return useMemo(() => getDocumentShortcutLabels(platform), [platform]);
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const editable = target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']");
  return Boolean(editable);
}

export function isDocumentShortcutEventBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const blockingSurface = target.closest("[role='dialog'], [role='menu'], [role='listbox'], [data-shortcuts-disabled='true']");
  return Boolean(blockingSurface);
}

function getCurrentPlatform(): DocumentShortcutPlatform {
  if (typeof window === "undefined") return "control";
  return getDocumentShortcutPlatform(window.navigator.platform, window.navigator.userAgent);
}

function hasShortcutModifier(event: KeyboardEvent, platform: DocumentShortcutPlatform): boolean {
  return platform === "apple" ? event.metaKey : event.ctrlKey;
}

const EDITABLE_BLOCKED_COMMANDS = new Set<DocumentShortcutCommand>([
  "undo", "previous", "next", "discard", "search", "comment", "reply", "forward",
]);

export function getDocumentShortcutCommandForPlatform(
  event: KeyboardEvent,
  platform: DocumentShortcutPlatform,
): DocumentShortcutCommand | null {
  if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) return "escape";
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    if (event.key === "/") return "search";
    if (event.key.toLowerCase() === "c") return "comment";
    if (event.key.toLowerCase() === "r") return "reply";
    if (event.key.toLowerCase() === "f") return "forward";
    return null;
  }
  if (!hasShortcutModifier(event, platform) || event.altKey) return null;
  if (!event.shiftKey && event.key.toLowerCase() === "s") return "save";
  if (event.shiftKey && event.key.toLowerCase() === "f") return "toggleFlag";
  if (!event.shiftKey && (event.key === "Backspace" || event.key === "Delete")) return "discard";
  if (event.shiftKey && event.key.toLowerCase() === "a") return "selectAll";
  if (event.shiftKey && (platform === "apple" ? event.key.toLowerCase() === "d" : event.key.toLowerCase() === "s")) return "download";
  if (!event.shiftKey && event.key === ",") return "settings";
  if (event.shiftKey) return null;
  if (event.key === "Enter") return "primary";
  if (event.key.toLowerCase() === "z") return "undo";
  if (event.key === "ArrowLeft") return "previous";
  if (event.key === "ArrowRight") return "next";
  return null;
}

export function getDocumentShortcutCommand(event: KeyboardEvent): DocumentShortcutCommand | null {
  return getDocumentShortcutCommandForPlatform(event, getCurrentPlatform());
}

export function runDocumentShortcutAction(action: DocumentPanelShortcutAction | null | undefined): boolean {
  if (!action?.run || action.disabled || action.available?.() === false) return false;
  void action.run();
  return true;
}

export function useDocumentPanelKeyboardShortcuts({
  primaryActionRef,
  undoAction,
  previousAction,
  nextAction,
  saveAction = null,
  toggleFlagAction = null,
  discardAction = null,
  selectAllAction = null,
  downloadAction = null,
  settingsAction = null,
  escapeAction = null,
  searchAction = null,
  commentAction = null,
  replyAction = null,
  forwardAction = null,
  enabled = true,
}: {
  primaryActionRef: RefObject<DocumentPanelShortcutAction | null>;
  undoAction: DocumentPanelShortcutAction | null;
  previousAction: DocumentPanelShortcutAction | null;
  nextAction: DocumentPanelShortcutAction | null;
  saveAction?: DocumentPanelShortcutAction | null;
  toggleFlagAction?: DocumentPanelShortcutAction | null;
  discardAction?: DocumentPanelShortcutAction | null;
  selectAllAction?: DocumentPanelShortcutAction | null;
  downloadAction?: DocumentPanelShortcutAction | null;
  settingsAction?: DocumentPanelShortcutAction | null;
  escapeAction?: DocumentPanelShortcutAction | null;
  searchAction?: DocumentPanelShortcutAction | null;
  commentAction?: DocumentPanelShortcutAction | null;
  replyAction?: DocumentPanelShortcutAction | null;
  forwardAction?: DocumentPanelShortcutAction | null;
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      const command = getDocumentShortcutCommand(event);
      if (!command) return;
      if (isDocumentShortcutEventBlocked(event.target)) return;

      if (EDITABLE_BLOCKED_COMMANDS.has(command) && isEditableShortcutTarget(event.target)) return;

      const actionMap: Record<DocumentShortcutCommand, DocumentPanelShortcutAction | null | undefined> = {
        primary: primaryActionRef.current, undo: undoAction, previous: previousAction, next: nextAction,
        save: saveAction, toggleFlag: toggleFlagAction, discard: discardAction, selectAll: selectAllAction,
        download: downloadAction, settings: settingsAction, escape: escapeAction, search: searchAction,
        comment: commentAction, reply: replyAction, forward: forwardAction,
      };
      const action = actionMap[command];

      if (!runDocumentShortcutAction(action)) return;
      event.preventDefault();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commentAction, discardAction, downloadAction, enabled, escapeAction, forwardAction, nextAction, previousAction, primaryActionRef, replyAction, saveAction, searchAction, selectAllAction, settingsAction, toggleFlagAction, undoAction]);
}
