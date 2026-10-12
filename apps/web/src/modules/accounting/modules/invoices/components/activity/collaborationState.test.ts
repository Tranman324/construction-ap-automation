import { describe, expect, it } from "vitest";

import { getCollaborationState } from "./collaborationState";

describe("getCollaborationState", () => {
  it.each([
    ["pending", { isTrash: false, readOnly: false, lockedReason: undefined }],
    ["approved", { isTrash: false, readOnly: true, lockedReason: "Activity is locked — document is approved." }],
    ["submitted", { isTrash: false, readOnly: true, lockedReason: "Activity is locked — submitted to Spectrum." }],
    ["discarded", { isTrash: true, readOnly: true, lockedReason: "Activity is locked — document is in Trash." }],
  ] as const)("derives the shared %s lifecycle state", (status, expected) => {
    expect(getCollaborationState({ status, isTrash: false })).toEqual(expected);
  });

  it("keeps inspection-only records read-only without relabeling them as Trash", () => {
    expect(getCollaborationState({ status: "pending", isTrash: false }, { readOnly: true })).toEqual({
      isTrash: false,
      readOnly: true,
      lockedReason: undefined,
    });
  });

  it("honors a global-search Trash marker when workflow status is stale", () => {
    expect(getCollaborationState({ status: "pending", isTrash: false }, { trashOverride: true })).toEqual({
      isTrash: true,
      readOnly: true,
      lockedReason: "Activity is locked — document is in Trash.",
    });
  });
});
