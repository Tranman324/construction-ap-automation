import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = __dirname;
const isTest = (name: string) => /\.test\.tsx?$/.test(name);
const sources = readdirSync(dir).filter((name) => /\.tsx?$/.test(name) && !isTest(name));
const specifiers = (name: string): string[] =>
  [...readFileSync(join(dir, name), "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);

const NEW_FILES = sources.filter((name) => /^resolveCard.*\.tsx?$/i.test(name) || name === "useTwoStepArm.ts");
const DUPLICATE_CODE = [
  "DuplicateResolutionCard", "DuplicateEvidence", "DuplicateBypassNote", "duplicateCardModel", "duplicateCardCopy",
  "useDuplicateCardActions", "SpectrumConfirmDialog", "InvoiceResolveTray", "invoiceResolveModel",
];

describe("resolve card import direction", () => {
  it("CAR-14 scans the new resolve-card files", () => {
    expect(NEW_FILES).toEqual(expect.arrayContaining(["ResolveCard.tsx", "ResolveCardActions.tsx", "ResolveCardEvidence.tsx", "resolveCardModel.ts", "useTwoStepArm.ts"]));
  });

  it("CAR-14 new documents/ files never import from invoices or duplicate code", () => {
    for (const name of NEW_FILES) {
      const bad = specifiers(name).filter((spec) => /components\/invoices|\.\.\/invoices|\/duplicate/.test(spec));
      expect(bad, name).toEqual([]);
    }
  });

  it("CAR-15 no documents/ source imports duplicate or invoice-tray code", () => {
    expect(sources).toContain("DocumentResolveTray.tsx");
    for (const name of sources) {
      const bad = specifiers(name).filter((spec) => DUPLICATE_CODE.includes(spec.split("/").pop() ?? ""));
      expect(bad, name).toEqual([]);
    }
  });
});
