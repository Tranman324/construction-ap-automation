// Runs in the default jsdom environment: the shared setup file touches `window` unconditionally, so a node pragma cannot load it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const cwd = join(__dirname, "..", "..");
const INV = "src/modules/accounting/modules/invoices/components";
const MODEL_ALIAS = "@/modules/accounting/modules/invoices/components/documents/resolveCardModel";
const GUARDED = new Set(["no-restricted-syntax", "no-restricted-imports"]);
const TIMEOUT = 60_000;

const eslint = new ESLint({ cwd });

/** Counts only the guardrail rules, by rule id, so unrelated Next/TS findings in the snippet do not matter. */
async function guardrailRules(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(cwd, file) });
  return result.messages.flatMap((message) => (message.ruleId && GUARDED.has(message.ruleId) ? [message.ruleId] : []));
}

const card = (attrs: string) => `export const a = <ResolveCard model={m} ${attrs}/>;\n`;
const carousel = (testId: string) => `export const a = <ResolveCarousel cards={[]} testId="${testId}" />;\n`;
const INVOICE_TRAY = `${INV}/invoices/InvoiceResolveTray.tsx`;
const DOCUMENT_TRAY = `${INV}/documents/DocumentResolveTray.tsx`;
const CAROUSEL_TEST = `${INV}/documents/ResolveCarousel.test.tsx`;
const FOO = `${INV}/invoices/Foo.tsx`;
const CAROUSEL_IMPORT = 'import { ResolveCarousel } from "../documents/ResolveCarousel";\n';

describe("resolve card lint guardrails", () => {
  it("LNT-01 flags className on ResolveCard", async () => {
    expect(await guardrailRules(card('className="x" '), `${INV}/invoices/Foo.tsx`)).toEqual(["no-restricted-syntax"]);
  }, TIMEOUT);

  it("LNT-02 flags style on ResolveCard", async () => {
    expect(await guardrailRules(card("style={{ color: 'red' }} "), `${INV}/invoices/Foo.tsx`)).toEqual(["no-restricted-syntax"]);
  }, TIMEOUT);

  it("LNT-03 flags a spread on ResolveCard", async () => {
    expect(await guardrailRules("export const a = <ResolveCard {...p} />;\n", `${INV}/invoices/Foo.tsx`)).toEqual(["no-restricted-syntax"]);
  }, TIMEOUT);

  it("LNT-04 keeps className closed inside the allowlisted tray file", async () => {
    expect(await guardrailRules(card('className="x" '), INVOICE_TRAY)).toEqual(["no-restricted-syntax"]);
  }, TIMEOUT);

  it("LNT-05 accepts model and onAction", async () => {
    expect(await guardrailRules(card("onAction={f} "), `${INV}/invoices/Foo.tsx`)).toEqual([]);
  }, TIMEOUT);

  it("LNT-06 flags ResolveCarousel outside the allowlist", async () => {
    expect(await guardrailRules(carousel("invoice-resolve-tray"), `${INV}/invoices/Foo.tsx`)).toEqual(["no-restricted-syntax"]);
  }, TIMEOUT);

  it("LNT-07 allows ResolveCarousel in InvoiceResolveTray.tsx", async () => {
    expect(await guardrailRules(carousel("invoice-resolve-tray"), INVOICE_TRAY)).toEqual([]);
  }, TIMEOUT);

  it("LNT-08 allows ResolveCarousel in DocumentResolveTray.tsx", async () => {
    expect(await guardrailRules(carousel("document-resolve-tray"), DOCUMENT_TRAY)).toEqual([]);
  }, TIMEOUT);

  it("LNT-09 flags ResolveCarousel in another documents/ file", async () => {
    expect(await guardrailRules(carousel("document-resolve-tray"), `${INV}/documents/Other.tsx`)).toEqual(["no-restricted-syntax"]);
  }, TIMEOUT);

  it("LNT-10 flags LegacyResolveCard imported through the alias", async () => {
    const code = `import type { LegacyResolveCard } from "${MODEL_ALIAS}";\nexport type T = LegacyResolveCard;\n`;
    expect(await guardrailRules(code, `${INV}/invoices/Foo.tsx`)).toEqual(["no-restricted-imports"]);
  }, TIMEOUT);

  it("LNT-11 flags LegacyResolveCard imported by relative path", async () => {
    const code = 'import type { LegacyResolveCard } from "./resolveCardModel";\nexport type T = LegacyResolveCard;\n';
    expect(await guardrailRules(code, `${INV}/documents/Foo.tsx`)).toEqual(["no-restricted-imports"]);
  }, TIMEOUT);

  it("LNT-12 allows LegacyResolveCard in DocumentResolveTray.tsx", async () => {
    const code = 'import type { LegacyResolveCard } from "./resolveCardModel";\nexport type T = LegacyResolveCard;\n';
    expect(await guardrailRules(code, DOCUMENT_TRAY)).toEqual([]);
  }, TIMEOUT);

  it("LNT-13 allows the union type from the same module", async () => {
    const code = `import type { ResolveCarouselCard } from "${MODEL_ALIAS}";\nexport type T = ResolveCarouselCard;\n`;
    expect(await guardrailRules(code, `${INV}/invoices/Foo.tsx`)).toEqual([]);
  }, TIMEOUT);

  it("LNT-14 the config names exactly the two allowlisted trays plus the carousel's own test, and every block precedes globalIgnores", () => {
    const config = readFileSync(join(cwd, "eslint.config.mjs"), "utf8");
    const paths = [...config.matchAll(/"(src\/[^"]+\.tsx)"/g)].map((match) => match[1]);
    expect(paths).toEqual([INVOICE_TRAY, DOCUMENT_TRAY, CAROUSEL_TEST]);
    const ignoreBlock = config.indexOf("ignores: [INVOICE_TRAY, DOCUMENT_TRAY, CAROUSEL_TEST]");
    const allowBlock = config.indexOf("files: [INVOICE_TRAY, DOCUMENT_TRAY]");
    const ignoresCall = config.indexOf("globalIgnores([");
    expect(ignoreBlock).toBeGreaterThan(-1);
    expect(allowBlock).toBeGreaterThan(ignoreBlock);
    expect(ignoresCall).toBeGreaterThan(allowBlock);
  });

  describe("evasions of the name-based selectors (Adv-M3)", () => {
    it("LNT-15 flags an aliased ResolveCarousel import (import rule and alias rule)", async () => {
      const code = 'import { ResolveCarousel as Tray } from "../documents/ResolveCarousel";\nexport const a = <Tray cards={[]} testId="invoice-resolve-tray" />;\n';
      expect(await guardrailRules(code, FOO)).toEqual(["no-restricted-imports", "no-restricted-syntax"]);
    }, TIMEOUT);

    it("LNT-16 flags namespace JSX <X.ResolveCarousel> and its namespace import", async () => {
      const code = 'import * as Trays from "../documents/ResolveCarousel";\nexport const a = <Trays.ResolveCarousel cards={[]} testId="invoice-resolve-tray" />;\n';
      expect(await guardrailRules(code, FOO)).toEqual(["no-restricted-imports", "no-restricted-syntax"]);
    }, TIMEOUT);

    it("LNT-17 flags React.createElement(ResolveCarousel, …)", async () => {
      const code = `import React from "react";\n${CAROUSEL_IMPORT}export const a = React.createElement(ResolveCarousel, { cards: [], testId: "invoice-resolve-tray" });\n`;
      expect(await guardrailRules(code, FOO)).toEqual(["no-restricted-imports", "no-restricted-syntax"]);
    }, TIMEOUT);

    it("LNT-18 flags a dynamic import and a re-export of ResolveCarousel", async () => {
      expect(await guardrailRules('export const load = () => import("../documents/ResolveCarousel");\n', FOO)).toEqual(["no-restricted-syntax"]);
      expect(await guardrailRules('export { ResolveCarousel } from "../documents/ResolveCarousel";\n', FOO)).toEqual(["no-restricted-imports"]);
    }, TIMEOUT);

    it("LNT-19 flags className and a spread passed to ResolveCard through createElement", async () => {
      const head = 'import { createElement } from "react";\nimport { ResolveCard } from "../documents/ResolveCard";\n';
      expect(await guardrailRules(`${head}export const a = createElement(ResolveCard, { model: m, className: "x" });\n`, FOO)).toEqual(["no-restricted-syntax"]);
      expect(await guardrailRules(`${head}export const a = createElement(ResolveCard, { model: m, ...p });\n`, FOO)).toEqual(["no-restricted-syntax"]);
    }, TIMEOUT);

    it("LNT-20 flags style on namespace JSX <X.ResolveCard>", async () => {
      const code = 'import * as Card from "../documents/ResolveCard";\nexport const a = <Card.ResolveCard model={m} style={{ color: "red" }} />;\n';
      expect(await guardrailRules(code, FOO)).toEqual(["no-restricted-syntax"]);
    }, TIMEOUT);

    it("LNT-21 flags renaming ResolveCard by alias import or by variable", async () => {
      expect(await guardrailRules('import { ResolveCard as Closed } from "../documents/ResolveCard";\nexport const a = <Closed model={m} className="x" />;\n', FOO)).toEqual(["no-restricted-syntax"]);
      expect(await guardrailRules('import { ResolveCard } from "../documents/ResolveCard";\nconst Closed = ResolveCard;\nexport const a = <Closed model={m} className="x" />;\n', FOO)).toEqual(["no-restricted-syntax"]);
    }, TIMEOUT);

    it("LNT-22 lets the carousel's own test render it, but keeps ResolveCard closed there", async () => {
      const code = `import { createElement } from "react";\n${CAROUSEL_IMPORT.replace("../documents/", "./")}export const a = createElement(ResolveCarousel, { cards: [], testId: "invoice-resolve-tray" });\n`;
      expect(await guardrailRules(code, CAROUSEL_TEST)).toEqual([]);
      expect(await guardrailRules('import { ResolveCard } from "./ResolveCard";\nexport const a = <ResolveCard model={m} className="x" />;\n', CAROUSEL_TEST)).toEqual(["no-restricted-syntax"]);
    }, TIMEOUT);

    it("LNT-24 flags re-exporting ResolveCard under another name", async () => {
      expect(await guardrailRules('export { ResolveCard as Closed } from "../documents/ResolveCard";\n', FOO)).toEqual(["no-restricted-syntax"]);
      expect(await guardrailRules('import { ResolveCard } from "../documents/ResolveCard";\nexport { ResolveCard as Closed };\n', FOO)).toEqual(["no-restricted-syntax"]);
    }, TIMEOUT);

    it("LNT-25 flags export * from ResolveCarousel outside the allowlist, including the carousel test", async () => {
      const code = 'export * from "../documents/ResolveCarousel";\n';
      expect(await guardrailRules(code, FOO)).toEqual(["no-restricted-imports"]);
      expect(await guardrailRules('export * from "./ResolveCarousel";\n', CAROUSEL_TEST)).toEqual(["no-restricted-syntax"]);
    }, TIMEOUT);

    it("LNT-26 flags a destructuring alias of ResolveCard or ResolveCarousel", async () => {
      expect(await guardrailRules('import * as ns from "../documents/ResolveCard";\nconst { ResolveCard: Closed } = ns;\nexport const a = <Closed model={m} className="x" />;\n', FOO)).toEqual(["no-restricted-syntax"]);
      expect(await guardrailRules('const { ResolveCarousel: Tray } = registry;\nexport const a = Tray;\n', FOO)).toEqual(["no-restricted-syntax"]);
      expect(await guardrailRules('import * as ns from "../documents/ResolveCard";\nconst { ResolveCard } = ns;\nexport const a = <ResolveCard model={m} />;\n', FOO)).toEqual([]);
    }, TIMEOUT);

    it("LNT-27 the carousel test may import it and call createElement, but not render it as JSX", async () => {
      expect(await guardrailRules('import { ResolveCarousel } from "./ResolveCarousel";\nexport const a = <ResolveCarousel cards={[]} testId="invoice-resolve-tray" />;\n', CAROUSEL_TEST)).toEqual(["no-restricted-syntax"]);
      expect(await guardrailRules('export const load = () => import("./ResolveCarousel");\n', CAROUSEL_TEST)).toEqual(["no-restricted-syntax"]);
    }, TIMEOUT);

    it("LNT-23 known gap: indirection through a data structure is not visible to lint (tsc rejects className on ResolveCard)", async () => {
      const code = 'import { ResolveCard } from "../documents/ResolveCard";\nconst parts = [ResolveCard];\nconst [Closed] = parts;\nexport const a = <Closed model={m} className="x" />;\n';
      expect(await guardrailRules(code, FOO)).toEqual([]);
    }, TIMEOUT);
  });
});
