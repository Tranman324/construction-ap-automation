import { describe, expect, it } from "vitest";

import {
  findDestinationPathIdsByLabel,
  formatDestinationPath,
  getDestinationFolderChildren,
  getDestinationPathLabel,
  getDestinationPathNodes,
  toSharePointDestination,
} from "@/modules/accounting/modules/invoices/lib/destinationTree";
import type { DestinationFolderNode } from "@/modules/accounting/modules/invoices/types/api";

// Test-only literals: the helpers take tree + rootLabel explicitly, so the
// catalog values below live here, never in production source.
const ROOT_LABEL = "(Job root)";
const TREE: readonly DestinationFolderNode[] = [
  {
    id: "contracts",
    name: "01 Contracts",
    children: [{ id: "subcontracts", name: "Subcontracts", children: [] }],
  },
  {
    id: "closeout",
    name: "04 Closeout",
    children: [{ id: "warranties", name: "Warranties", children: [] }],
  },
  { id: "archive", name: "99 Archive", children: [] },
];

describe("destinationTree", () => {
  it("formats root and nested folder paths with the passed rootLabel", () => {
    expect(formatDestinationPath([], ROOT_LABEL)).toBe(ROOT_LABEL);

    const nodes = getDestinationPathNodes(["contracts", "subcontracts"], TREE);

    expect(nodes).not.toBeNull();
    expect(formatDestinationPath(nodes ?? [], ROOT_LABEL)).toBe("01 Contracts / Subcontracts");
  });

  it("walks the passed tree and returns null for a missing path", () => {
    expect(getDestinationPathNodes(["contracts", "subcontracts"], TREE)).toHaveLength(2);
    expect(getDestinationPathNodes(["missing"], TREE)).toBeNull();
    expect(getDestinationPathLabel(["missing"], TREE, ROOT_LABEL)).toBeNull();
  });

  it("finds path ids from stable labels and treats the root label as an empty path", () => {
    expect(findDestinationPathIdsByLabel("04 Closeout / Warranties", TREE, ROOT_LABEL)).toEqual([
      "closeout",
      "warranties",
    ]);
    expect(findDestinationPathIdsByLabel(ROOT_LABEL, TREE, ROOT_LABEL)).toEqual([]);
  });

  it("normalizes display labels for SharePoint upload payloads", () => {
    expect(toSharePointDestination(ROOT_LABEL, ROOT_LABEL)).toBe("");
    expect(toSharePointDestination("", ROOT_LABEL)).toBe("");
    expect(toSharePointDestination("  ", ROOT_LABEL)).toBe("");
    expect(toSharePointDestination("04 Closeout / Warranties", ROOT_LABEL)).toBe(
      "04 Closeout / Warranties",
    );
  });

  it("returns the whole tree for invalid paths and an empty folder for a leaf", () => {
    expect(getDestinationFolderChildren(["missing"], TREE)).toBe(TREE);
    expect(getDestinationFolderChildren(["archive"], TREE)).toEqual([]);
  });
});
