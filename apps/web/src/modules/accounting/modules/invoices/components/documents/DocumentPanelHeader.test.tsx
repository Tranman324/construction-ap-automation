import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Scissors } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { DocumentActionsDropdown } from "@/modules/accounting/modules/invoices/components/documents/DocumentActionsDropdown";
import { DocumentClassificationControl } from "@/modules/accounting/modules/invoices/components/documents/DocumentClassificationControl";
import { DocumentPanelHeader } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelHeader";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const classifications: ClassificationInfo[] = [
  { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  { name: "receipt", label: "Receipt", opensAs: "receipt", action: "view-only", builtIn: true, status: "active" },
  { name: "w9", label: "W-9", opensAs: "w9", action: "view-only", builtIn: true, status: "active" },
];
const documentPanelTypes = [
  "receipt",
  "statement",
  "coi",
  "w9",
  "subcontract",
  "warranty",
  "lien-waiver",
  "other",
];

function makeRecord(): Invoice {
  return {
    id: "doc-1",
    classification: "receipt",
    confidence: 0.75,
    file: "receipt.pdf",
    email: {
      from: "vendor@example.com",
      subject: "Receipt",
      receivedAt: "2026-06-01T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-01T12:00:00.000Z",
    extracted: null,
    matching: null,
    overallConfidence: 0.75,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) return sourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

describe("DocumentPanelHeader", () => {
  it("renders a Close action that returns to the prior view", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();

    render(<DocumentPanelHeader title="Receipt" onBack={onBack} />);

    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("title", expect.stringContaining("Close • Esc"));

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders navigation with an n/N counter", () => {
    render(
      <DocumentPanelHeader
        title="Acme Statement"
        filename="statement-0626.pdf"
        onBack={vi.fn()}
        navigation={{
          current: 2,
          total: 5,
          onPrevious: vi.fn(),
          onNext: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText("Acme Statement")).toBeInTheDocument();
    expect(screen.getByText("statement-0626.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Document 2 of 5")).toHaveTextContent("2 / 5");
  });

  it("fires previous and next callbacks", async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn();
    const onNext = vi.fn();

    render(
      <DocumentPanelHeader
        title="Receipt"
        onBack={vi.fn()}
        navigation={{
          current: 3,
          total: 4,
          onPrevious,
          onNext,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Previous document" }));
    await user.click(screen.getByRole("button", { name: "Next document" }));

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disables previous and next controls at list edges", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();

    render(
      <DocumentPanelHeader
        title="First receipt"
        onBack={vi.fn()}
        navigation={{
          current: 1,
          total: 1,
          onPrevious,
          onNext,
          previousDisabled: true,
          nextDisabled: true,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous document" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next document" })).toBeDisabled();
  });

  it("renders supplied classification and actions slots", () => {
    render(
      <DocumentPanelHeader
        title="Receipt"
        onBack={vi.fn()}
        classificationSlot={(
          <DocumentClassificationControl
            record={makeRecord()}
            classifications={classifications}
            onReclassify={vi.fn()}
          />
        )}
        actionsSlot={(
          <DocumentActionsDropdown
            actions={[
              { id: "split-document", label: "Split Document", icon: Scissors, onClick: vi.fn() },
            ]}
          />
        )}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Reclassify document" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
  });

  it.each(documentPanelTypes)("renders the shared header shell for %s documents", (documentType) => {
    render(
      <DocumentPanelHeader
        title={`${documentType} document`}
        filename={`${documentType}.pdf`}
        onBack={vi.fn()}
        navigation={{
          current: 1,
          total: documentPanelTypes.length,
          onPrevious: vi.fn(),
          onNext: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByText(`${documentType} document`)).toBeInTheDocument();
    expect(screen.getByText(`${documentType}.pdf`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous document" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next document" })).toBeInTheDocument();
  });

  it("is adopted by the route headers without leaving bespoke prev/next JSX there", () => {
    const componentImportPaths = [
      "@/modules/accounting/modules/invoices/components/documents/DocumentPanelHeader",
      "./DocumentPanelHeader",
    ];
    const productionReferences = sourceFiles(join(process.cwd(), "src"))
      .filter((file) => basename(file) !== "DocumentPanelHeader.tsx")
      .filter((file) => !basename(file).includes(".test."))
      .filter((file) => {
        const contents = readFileSync(file, "utf8");
        return componentImportPaths.some((importPath) => contents.includes(importPath));
      });
    const routeFiles = [
      join(process.cwd(), "src/app/(dashboard)/accounting/invoices/[id]/page.tsx"),
      join(process.cwd(), "src/app/(dashboard)/accounting/documents/[id]/page.tsx"),
    ];

    expect(productionReferences.map((file) => relative(process.cwd(), file)).sort()).toEqual([
      "src/app/(dashboard)/accounting/documents/[id]/page.tsx",
      "src/app/(dashboard)/accounting/invoices/[id]/page.tsx",
    ]);
    for (const routeFile of routeFiles) {
      const contents = readFileSync(routeFile, "utf8");
      expect(contents).toContain("DocumentPanelHeader");
      expect(contents).not.toContain("ChevronLeft");
      expect(contents).not.toMatch(/>\s*Prev\s*</);
      expect(contents).not.toMatch(/>\s*Next\s*</);
    }
  });
});
