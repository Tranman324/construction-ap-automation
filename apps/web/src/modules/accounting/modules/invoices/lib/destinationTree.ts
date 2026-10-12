import type { DestinationFolderNode } from "@/modules/accounting/modules/invoices/types/api";

// Pure helpers for the served SharePoint destination catalog. These carry NO
// hardcoded folder tree and NO root-label literal: the caller passes the served
// `tree` and `rootLabel` (from useDocumentDestinations) explicitly.

export function formatDestinationPath(
  nodes: readonly DestinationFolderNode[],
  rootLabel: string,
): string {
  if (nodes.length === 0) return rootLabel;
  return nodes.map((node) => node.name).join(" / ");
}

export function toSharePointDestination(
  label: string | null | undefined,
  rootLabel: string | null | undefined,
): string {
  const destination = label?.trim() ?? "";
  if (!destination) return "";
  if (rootLabel && destination === rootLabel) return "";
  return destination;
}

export function getDestinationPathNodes(
  pathIds: readonly string[],
  tree: readonly DestinationFolderNode[],
): DestinationFolderNode[] | null {
  const nodes: DestinationFolderNode[] = [];
  let siblings = tree;

  for (const id of pathIds) {
    const node = siblings.find((candidate) => candidate.id === id);
    if (!node) return null;
    nodes.push(node);
    siblings = node.children ?? [];
  }

  return nodes;
}

export function getDestinationFolderChildren(
  pathIds: readonly string[],
  tree: readonly DestinationFolderNode[],
): readonly DestinationFolderNode[] {
  const nodes = getDestinationPathNodes(pathIds, tree);
  if (!nodes) return tree;
  const current = nodes.at(-1);
  return current ? current.children ?? [] : tree;
}

export function getDestinationPathLabel(
  pathIds: readonly string[],
  tree: readonly DestinationFolderNode[],
  rootLabel: string,
): string | null {
  const nodes = getDestinationPathNodes(pathIds, tree);
  return nodes ? formatDestinationPath(nodes, rootLabel) : null;
}

export function findDestinationPathIdsByLabel(
  label: string,
  tree: readonly DestinationFolderNode[],
  rootLabel: string,
): string[] | null {
  if (!label || label === rootLabel) return [];

  function search(
    nodes: readonly DestinationFolderNode[],
    prefix: readonly DestinationFolderNode[],
    ids: readonly string[],
  ): string[] | null {
    for (const node of nodes) {
      const nextPrefix = [...prefix, node];
      const nextIds = [...ids, node.id];
      if (formatDestinationPath(nextPrefix, rootLabel) === label) return nextIds;
      const childMatch = search(node.children ?? [], nextPrefix, nextIds);
      if (childMatch) return childMatch;
    }
    return null;
  }

  return search(tree, [], []);
}
