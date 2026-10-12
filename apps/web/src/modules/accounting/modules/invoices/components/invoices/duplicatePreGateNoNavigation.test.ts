import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, relative), "utf8");

/** Imperative navigation is forbidden in every file; a declarative `next/link` is allowed only where a link action renders. */
const IMPERATIVE_NAVIGATION = /router\.push|useRouter|window\.open|next\/navigation/;
const NEXT_LINK = /next\/link/;
const LINK_RENDERER = "../documents/ResolveCardActions.tsx";
const NO_LINK_FILES = ["duplicateCardModel.ts", "duplicateCardCopy.ts", "useDuplicateCardActions.ts", "SpectrumConfirmDialog.tsx"];

describe("duplicate card files never navigate imperatively (CTL-07)", () => {
  it.each([...NO_LINK_FILES, LINK_RENDERER])("%s has no router, window.open or next/navigation", (file) => {
    expect(read(file)).not.toMatch(IMPERATIVE_NAVIGATION);
  });

  it.each(NO_LINK_FILES)("%s does not import next/link: navigation is data (href), rendered only by the card", (file) => {
    expect(read(file)).not.toMatch(NEXT_LINK);
  });

  it("ResolveCardActions renders link actions with next/link", () => {
    expect(read(LINK_RENDERER)).toMatch(/from "next\/link"/);
  });
});

describe("the controller owns no discard mutation (CTL-08)", () => {
  const source = read("useDuplicateCardActions.ts");
  const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)];
  const fromMutations = imports.filter(([, , from]) => from.endsWith("hooks/mutations")).flatMap(([, names]) => names.split(",").map((n) => n.trim()).filter(Boolean));

  it("imports only useDuplicateBypass from hooks/mutations", () => {
    expect(fromMutations).toEqual(["useDuplicateBypass"]);
  });

  it("names no discard, delete or status mutation anywhere", () => {
    expect(source).not.toMatch(/useDiscardInvoice|useDeleteInvoice|useUpdateInvoiceStatus|use\w*Discard\w*/);
  });
});
