import { fixupConfigRules } from "@eslint/compat";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const INVOICE_TRAY = "src/modules/accounting/modules/invoices/components/invoices/InvoiceResolveTray.tsx";
const DOCUMENT_TRAY = "src/modules/accounting/modules/invoices/components/documents/DocumentResolveTray.tsx";

// The carousel's own unit test must import it and call createElement(ResolveCarousel, …) to drive it. Only those two
// forms are opened there; JSX, namespace JSX, dynamic import, export * and aliasing stay closed, as do ResolveCard rules.
const CAROUSEL_TEST = "src/modules/accounting/modules/invoices/components/documents/ResolveCarousel.test.tsx";

// ResolveCard is closed for className/style: JSX by name or as a namespace member (<X.ResolveCard>), and createElement calls.
const CARD_JSX = ":matches(JSXOpeningElement[name.name='ResolveCard'], JSXOpeningElement[name.property.name='ResolveCard'])";
const CARD_CALL = ":matches(CallExpression[arguments.0.name='ResolveCard'], CallExpression[arguments.0.property.name='ResolveCard'])";
const RESOLVE_CARD_PROPS = {
  selector: `${CARD_JSX} > JSXAttribute[name.name=/^(className|style)$/], ${CARD_CALL} > ObjectExpression > Property[key.name=/^(className|style)$/]`,
  message: "ResolveCard is closed: it accepts no className or style. Express the change in the ResolveCardModel or the --rc-* tokens.",
};
const RESOLVE_CARD_SPREAD = {
  selector: `${CARD_JSX} > JSXSpreadAttribute, ${CARD_CALL} > ObjectExpression > SpreadElement`,
  message: "Do not spread props onto ResolveCard (it could smuggle className/style). Pass model and onAction explicitly.",
};
// Lint matches names, so a renamed binding would escape the rules above; keep the guarded components under their own names.
const GUARDED_NAME = "/^(ResolveCard|ResolveCarousel)$/";
const RESOLVE_ALIAS = {
  selector: [
    `ImportSpecifier[imported.name=${GUARDED_NAME}][local.name!=${GUARDED_NAME}]`,
    `ExportSpecifier[local.name=${GUARDED_NAME}][exported.name!=${GUARDED_NAME}]`,
    `VariableDeclarator[init.name=${GUARDED_NAME}]`,
    `VariableDeclarator > ObjectPattern > Property[key.name=${GUARDED_NAME}][value.name!=${GUARDED_NAME}]`,
  ].join(", "),
  message: "Do not rename ResolveCard or ResolveCarousel (alias import, alias re-export, variable or destructuring): the lint guardrails match these names.",
};
const CAROUSEL_MESSAGE = "ResolveCarousel (and LegacyResolveCard JSX content) may only be rendered by InvoiceResolveTray.tsx and DocumentResolveTray.tsx. Build a ResolveCardModel instead.";
const CAROUSEL_RENDER = [
  "JSXOpeningElement[name.name='ResolveCarousel']",
  "JSXOpeningElement[name.property.name='ResolveCarousel']",
  "ImportExpression[source.value=/ResolveCarousel$/]",
];
const CAROUSEL_CALL = [
  "CallExpression > Identifier.arguments[name='ResolveCarousel']",
  "CallExpression > MemberExpression.arguments[property.name='ResolveCarousel']",
];
const LEGACY_CAROUSEL = { selector: [...CAROUSEL_RENDER, ...CAROUSEL_CALL].join(", "), message: CAROUSEL_MESSAGE };
// The carousel test has no import restriction for ResolveCarousel, so `export *` is closed there by selector.
const CAROUSEL_TEST_CLOSED = { selector: [...CAROUSEL_RENDER, "ExportAllDeclaration[source.value=/ResolveCarousel$/]"].join(", "), message: CAROUSEL_MESSAGE };
const LEGACY_CARD_IMPORT = {
  group: ["**/resolveCardModel"],
  importNames: ["LegacyResolveCard"],
  message: "LegacyResolveCard is deprecated and allowed only in the two legacy tray files.",
};
// Any binding of ResolveCarousel (named, aliased, namespace or re-export) needs this import, so the allowlist holds by module.
const LEGACY_CAROUSEL_IMPORT = {
  group: ["**/ResolveCarousel"],
  importNames: ["ResolveCarousel"],
  message: "ResolveCarousel may only be imported by InvoiceResolveTray.tsx and DocumentResolveTray.tsx. Build a ResolveCardModel instead.",
};

const eslintConfig = defineConfig([
  ...fixupConfigRules(nextVitals),
  ...fixupConfigRules(nextTs),
  {
    files: ["mock-server/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [INVOICE_TRAY, DOCUMENT_TRAY, CAROUSEL_TEST],
    rules: {
      "no-restricted-syntax": ["error", RESOLVE_CARD_PROPS, RESOLVE_CARD_SPREAD, RESOLVE_ALIAS, LEGACY_CAROUSEL],
      "no-restricted-imports": ["error", { patterns: [LEGACY_CARD_IMPORT, LEGACY_CAROUSEL_IMPORT] }],
    },
  },
  {
    // The two allowlisted legacy call sites: still closed for className/style on ResolveCard.
    files: [INVOICE_TRAY, DOCUMENT_TRAY],
    rules: {
      "no-restricted-syntax": ["error", RESOLVE_CARD_PROPS, RESOLVE_CARD_SPREAD, RESOLVE_ALIAS],
    },
  },
  {
    // The carousel's own test: import + createElement(ResolveCarousel) only (see CAROUSEL_TEST).
    files: [CAROUSEL_TEST],
    rules: {
      "no-restricted-syntax": ["error", RESOLVE_CARD_PROPS, RESOLVE_CARD_SPREAD, RESOLVE_ALIAS, CAROUSEL_TEST_CLOSED],
      "no-restricted-imports": ["error", { patterns: [LEGACY_CARD_IMPORT] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Keep lint scoped to the frontend workspace surface.
    ".apm/worktrees/**",
    "docs/design/**",
    "docs/specs/platform/handoff/**",
    "docs/specs/platform/reference/**",
  ]),
]);

export default eslintConfig;
