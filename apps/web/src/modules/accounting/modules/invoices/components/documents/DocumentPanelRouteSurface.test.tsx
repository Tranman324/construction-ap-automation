import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Scissors } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentPanelRouteSurface } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelRouteSurface";
import { makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";
import { SEEDED_DESTINATIONS } from "@/modules/accounting/modules/invoices/lib/destinationsFixture";
import type { AuditEntry, ClassificationInfo, CoiOverride } from "@/modules/accounting/modules/invoices/types/api";
import type { ClassificationType, Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

interface MockDropdownProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

interface MockPairingProps {
  linkedInvoiceId: string | null;
  onLinkComplete?: () => void;
}

const permissionMock = vi.hoisted(() => ({ hasPermission: vi.fn(() => true) }));
const routeApi = vi.hoisted(() => ({ post: vi.fn(), del: vi.fn(), get: vi.fn(), patch: vi.fn(), put: vi.fn() }));
const routeToast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/modules/shared/lib/api", () => ({ api: routeApi, isApiError: (error: unknown) => typeof error === "object" && error !== null && "message" in error }));
vi.mock("sonner", () => ({ toast: routeToast }));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: permissionMock.hasPermission,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    role: "admin",
    isAdmin: true,
    permissions: ["*"],
  }),
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({ user: { userId: "current-user", name: "Current User" } }),
}));

// The COI panel is gated on the served compliance config; seed it so the COI
// spec renders its full panel (parity with the shipped config).
vi.mock("@/modules/accounting/modules/invoices/hooks/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/accounting/modules/invoices/hooks/queries")>();
  return {
    ...actual,
  };
});

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown", () => ({
  VendorDropdown: ({ value, onChange }: MockDropdownProps) => (
    <button type="button" onClick={() => onChange("V200")}>Vendor {value ?? "none"}</button>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown", () => ({
  JobDropdown: ({ value, onChange }: MockDropdownProps) => (
    <button type="button" onClick={() => onChange("24-018")}>Job {value ?? "none"}</button>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/LienWaiverPairingPanel", () => ({
  LienWaiverPairingPanel: ({ linkedInvoiceId, onLinkComplete }: MockPairingProps) => (
    <div>
      {linkedInvoiceId ? `Mock paired ${linkedInvoiceId}` : "Mock unpaired waiver"}
      <button type="button" onClick={onLinkComplete}>Mock complete waiver link</button>
    </div>
  ),
}));

interface ClassificationFixtureInput {
  name: string;
  label: string;
  action: ClassificationInfo["action"];
  builtIn: boolean;
}

const invoiceWorkflowClassifications = new Set(["invoice", "pay-application", "purchase-order", "credit-memo"]);
const documentPanelClassifications = new Set([
  "receipt",
  "statement",
  "coi",
  "w9",
  "subcontract",
  "warranty",
  "lien-waiver",
  "other",
]);

function makeClassificationFixture(input: ClassificationFixtureInput): ClassificationInfo {
  const opensAs = invoiceWorkflowClassifications.has(input.name)
    ? "invoice"
    : documentPanelClassifications.has(input.name)
      ? input.name
      : "other";

  return { ...input, opensAs, status: "active" };
}

const classifications: ClassificationInfo[] = [
  makeClassificationFixture({ name: "invoice", label: "Invoice", action: "extract-match", builtIn: true }),
  makeClassificationFixture({ name: "lien-waiver", label: "Lien Waiver", action: "view-only", builtIn: true }),
  makeClassificationFixture({ name: "receipt", label: "Receipt", action: "extract-match", builtIn: true }),
  makeClassificationFixture({ name: "statement", label: "Statement", action: "view-only", builtIn: true }),
  makeClassificationFixture({ name: "coi", label: "COI", action: "view-only", builtIn: true }),
  makeClassificationFixture({ name: "w9", label: "W-9", action: "view-only", builtIn: true }),
  makeClassificationFixture({ name: "subcontract", label: "Subcontract", action: "view-only", builtIn: false }),
  makeClassificationFixture({ name: "warranty", label: "Warranty", action: "view-only", builtIn: false }),
  makeClassificationFixture({ name: "credit-memo", label: "Credit Memo", action: "extract-match", builtIn: true }),
  makeClassificationFixture({ name: "change-order", label: "Change Order", action: "view-only", builtIn: false }),
  makeClassificationFixture({ name: "purchase-order", label: "Purchase Order", action: "extract-match", builtIn: true }),
  makeClassificationFixture({ name: "contract", label: "Contract", action: "view-only", builtIn: false }),
  makeClassificationFixture({ name: "image", label: "Image", action: "view-only", builtIn: false }),
  makeClassificationFixture({ name: "no-attachment", label: "No Attachment", action: "view-only", builtIn: false }),
  makeClassificationFixture({ name: "all-skipped", label: "All Skipped", action: "view-only", builtIn: false }),
  makeClassificationFixture({ name: "skipped", label: "Skipped", action: "view-only", builtIn: false }),
  makeClassificationFixture({ name: "unsupported", label: "Unsupported", action: "view-only", builtIn: false }),
  makeClassificationFixture({ name: "error", label: "Error", action: "view-only", builtIn: false }),
  makeClassificationFixture({ name: "other", label: "Other", action: "view-only", builtIn: true }),
];

const receiptMappedClassifications: ClassificationInfo[] = classifications.map((classification) => (
  classification.name === "contract"
    ? { ...classification, label: "Custom Receipt Packet", opensAs: "receipt", builtIn: false }
    : classification
));

const auditEntries: AuditEntry[] = [{
  id: "audit-1",
  action: "mark-reviewed",
  actor: "dana@example.com",
  changes: {},
  createdAt: "2026-06-01T12:00:00.000Z",
}];

function makeRecord(classification: ClassificationType = "receipt"): Invoice {
  return {
    id: "doc-1",
    classification,
    confidence: 0.71,
    file: "doc-1.pdf",
    email: {
      from: "vendor@example.com",
      subject: "Routing document",
      receivedAt: "2026-06-01T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-01T12:00:00.000Z",
    extracted: null,
    matching: null,
    overallConfidence: 0.71,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    compliance: classification === "coi" ? {
      verdict: "non-compliant", evaluatedAt: "2026-07-30T00:00:00.000Z", configVersion: "v1", configVersionId: "v1",
      checks: [{ id: "certificate-holder", label: "Certificate holder", rawStatus: "fail", effectiveStatus: "fail", provenance: "computed", detail: "Server requires review.", required: true }],
      coverageFailures: [], coverageExceptions: [], expiration: { value: { state: "unknown", expirationDate: null, daysRemaining: null }, provenance: "extracted", permittedActions: [], blockers: [] }, vendorCode: { value: null, provenance: "extracted", permittedActions: [], blockers: [] }, blockers: [{ code: "COI_BLOCKED", message: "Server requires review." }], uploadReady: false,
    } : undefined,
  };
}

describe("DocumentPanelRouteSurface", () => {
  beforeEach(() => {
    permissionMock.hasPermission.mockReset();
    permissionMock.hasPermission.mockReturnValue(true);
    routeApi.post.mockReset();
    routeApi.get.mockReset();
    routeApi.get.mockImplementation((path: string) => {
      if (path === "/api/document-destinations") return Promise.resolve(SEEDED_DESTINATIONS);
      if (path === "/api/phase-codes") return Promise.resolve({ phase_codes: [] });
      if (path === "/api/cost-types") return Promise.resolve({ costTypes: [] });
      if (path === "/api/gl-accounts") return Promise.resolve([]);
      if (path === "/api/documents/doc-1/activity") return Promise.resolve({ entries: [], pagination: { limit: 50, offset: 0, total: 0, hasMore: false } });
      if (path === "/api/users") return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected GET in route-surface test: ${path}`));
    });
    routeApi.post.mockImplementation((path: string) => path === "/api/documents/doc-1/activity/view"
      ? Promise.resolve({ priorActivityViewedAt: null, unreadReplies: 0, unreadComments: 0 })
      : Promise.resolve({}));
    routeToast.error.mockReset();
  });

  it("checks the exact COI override permission at the route boundary", () => {
    const { Wrapper } = makeMutationWrapper();
    const allowed = render(<DocumentPanelRouteSurface record={makeRecord("coi")} classifications={classifications} />, { wrapper: Wrapper });
    expect(permissionMock.hasPermission).toHaveBeenCalledWith("accounting.invoices.coi_override");
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBeGreaterThan(0);
    allowed.unmount();
    permissionMock.hasPermission.mockReturnValue(false);
    const view = render(<DocumentPanelRouteSurface record={makeRecord("coi")} classifications={classifications} />, { wrapper: Wrapper });
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("suppresses direct mutation affordances for a read-only record", () => {
    const { Wrapper } = makeMutationWrapper();
    render(
      <DocumentPanelRouteSurface
        record={makeRecord("coi")}
        classifications={classifications}
        readOnly
      />,
      { wrapper: Wrapper },
    );

    expect(screen.queryByRole("button", { name: /flag/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it.each([
    ["approved", "Activity is locked — document is approved."],
    ["submitted", "Activity is locked — submitted to Spectrum."],
    ["discarded", "Activity is locked — document is in Trash."],
] as const)("makes collaboration view-only for a %s document", async (status, lockedReason) => {
    const { Wrapper } = makeMutationWrapper();
    render(
      <DocumentPanelRouteSurface
        record={{ ...makeRecord("receipt"), status }}
        classifications={classifications}
        auditEntries={[]}
        canComment
        canEmail
        serverBackedActivity
      />,
      { wrapper: Wrapper },
    );

    screen.getByRole("tab", { name: "Activity" }).click();
    expect(screen.getByText(lockedReason)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Comment" })).not.toBeInTheDocument();
    await waitFor(() => expect(routeApi.get).toHaveBeenCalledWith("/api/documents/doc-1/activity", { limit: 50, offset: 0 }));
    await waitFor(() => expect(routeApi.post).toHaveBeenCalledWith("/api/documents/doc-1/activity/view", {}));
  });

  it("forwards a completed lien-waiver link through the route surface", async () => {
    const user = userEvent.setup();
    const onLienWaiverLinkComplete = vi.fn();
    const { Wrapper } = makeMutationWrapper();
    render(
      <DocumentPanelRouteSurface
        record={makeRecord("lien-waiver")}
        classifications={classifications}
        onLienWaiverLinkComplete={onLienWaiverLinkComplete}
      />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByRole("button", { name: "Mock complete waiver link" }));

    expect(onLienWaiverLinkComplete).toHaveBeenCalledWith(expect.objectContaining({ id: "doc-1" }));
  });

  it("keeps route detail cache unchanged and surfaces the literal 403 from the persisted callback", async () => {
    const user = userEvent.setup();
    const { queryClient, Wrapper } = makeMutationWrapper();
    const record = makeRecord("coi");
    const existing: CoiOverride[] = [{
      id: "persisted",
      documentId: record.id,
      checkId: "certificate-holder",
      originalStatus: "warn",
      reason: null,
      configVersionId: "v1",
      approvedBy: "leader@example.com",
      approvedAt: "2026-07-30T00:00:00.000Z",
      revokedBy: null,
      revokedAt: null,
    }];
    queryClient.setQueryData(["invoice", record.id], { ...record, coiOverrides: existing });
    routeApi.post.mockRejectedValueOnce({ status: 403, message: "COI override permission is required" });
    render(<DocumentPanelRouteSurface record={{ ...record, coiOverrides: existing }} classifications={classifications} />, { wrapper: Wrapper });
    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]);
    await user.type(screen.getByLabelText("Override reason"), "Approved after review");
    await user.click(screen.getByRole("button", { name: "Confirm override" }));
    await waitFor(() => expect(routeToast.error).toHaveBeenCalledWith("COI override permission is required"));
    expect(routeApi.post).toHaveBeenCalledWith(
      "/api/invoices/doc-1/coi-overrides",
      { checkId: "certificate-holder", reason: "Approved after review" },
    );
    expect(queryClient.getQueryData<{ coiOverrides: unknown[] }>(["invoice", record.id])?.coiOverrides).toEqual(existing);
  });

  it("wires route navigation and generic document actions into the shared panel", async () => {
    const user = userEvent.setup();
    const record = {
      ...makeRecord("error"),
      extracted: {
        vendorName: "Permit office", vendorAddress: null, invoiceNumber: null,
        invoiceDate: null, dueDate: null, amount: null, jobNumber: "24-017",
        projectName: "North Tower", description: null, lineItems: [],
      },
    };
    const onDiscard = vi.fn();
    const onFile = vi.fn();
    const onUpdateDocument = vi.fn();
    const onSkip = vi.fn();
    const onSplit = vi.fn();

    render(
      <DocumentPanelRouteSurface
        record={record}
        classifications={classifications}
        auditEntries={auditEntries}
        onDiscard={onDiscard}
        onFile={onFile}
        onUpdateDocument={onUpdateDocument}
        extraSecondaryActions={[
          { id: "split-document", label: "Split Document", icon: Scissors, onClick: onSplit },
        ]}
        navigation={{ canSkip: true, onSkip }}
      />,
      { wrapper: makeMutationWrapper().Wrapper },
    );

    expect(screen.getAllByText("Routing document").length).toBeGreaterThan(0);
    expect(screen.getByText("Captured")).toBeInTheDocument();
    expect(screen.getByText("Classify")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "File in Documents" })).toBeEnabled());
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Job 24-017" }));
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Split Document" }));
    await user.click(screen.getByRole("button", { name: "File in Documents" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await user.click(screen.getByRole("button", { name: "Confirm Discard" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(onDiscard).toHaveBeenCalledWith(record);
    expect(onUpdateDocument).toHaveBeenCalledWith(record, { jobNumber: "24-018" });
    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onFile).toHaveBeenCalledWith(record));
  });

  it("keeps Documents filing available while a project filing is pending for Other documents", async () => {
    const user = userEvent.setup();
    const record = {
      ...makeRecord("other"),
      extracted: {
        vendorName: "Permit office", vendorAddress: null, invoiceNumber: null,
        invoiceDate: null, dueDate: null, amount: null, jobNumber: "24-017",
        projectName: "North Tower", description: null, lineItems: [],
      },
    };
    const onFile = vi.fn();
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const props = {
      record,
      classifications,
      onFile,
      onFileToProject,
      onUpdateDocument: vi.fn(),
    };
    const view = render(
      <DocumentPanelRouteSurface {...props} fileToProjectPending />,
      { wrapper: makeMutationWrapper().Wrapper },
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "File in Documents" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "File in Documents" }));

    await waitFor(() => expect(onFile).toHaveBeenCalledWith(record));
    expect(onFileToProject).not.toHaveBeenCalled();
    view.unmount();
  });

  it("routes lien-waiver bundle guidance through the supplied split action callback", async () => {
    const user = userEvent.setup();
    const onSplit = vi.fn();
    const splitDocumentAction = { id: "split-document", label: "Split Document", icon: Scissors, onClick: onSplit };

    render(
      <DocumentPanelRouteSurface
        record={{ ...makeRecord("lien-waiver"), waiverAutoLinkSkipReason: "multi-waiver-bundle" }}
        classifications={classifications}
        splitDocumentAction={splitDocumentAction}
      />,
      { wrapper: makeMutationWrapper().Wrapper },
    );

    expect(screen.getByText("This PDF looks like a bundle of multiple waivers (>2 pages), so auto-link was skipped. Split it first, then link each waiver.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Split Document" }));
    expect(onSplit).toHaveBeenCalledTimes(1);
  });

  it("routes header reclassification through the provided handler and can hide invoices", async () => {
    const user = userEvent.setup();
    const onReclassify = vi.fn();

    render(
      <DocumentPanelRouteSurface
        record={makeRecord()}
        classifications={classifications}
        allowInvoiceClassification={false}
        onReclassify={onReclassify}
      />,
      { wrapper: makeMutationWrapper().Wrapper },
    );

    await user.click(screen.getByRole("combobox", { name: "Reclassify document" }));

    expect(screen.queryByRole("option", { name: "Invoice" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "W-9" }));

    expect(onReclassify).toHaveBeenCalledWith("w9");
  });

  it("restores the File to Job Cost action label when a filing undo refetches the same receipt as unfiled", () => {
    const onFile = vi.fn();
    const shelvedRecord = {
      ...makeRecord("receipt"),
      filed: true,
      filedAt: "2026-07-03T12:00:00.000Z",
      status: "reviewed" as const,
    };
    const undoRestoredRecord = {
      ...makeRecord("receipt"),
      filed: false,
      filedAt: null,
      status: "reviewed" as const,
    };
    const { rerender } = render(
      <DocumentPanelRouteSurface
        record={shelvedRecord}
        classifications={classifications}
        onFile={onFile}
      />,
      { wrapper: makeMutationWrapper().Wrapper },
    );

    expect(screen.getByRole("button", { name: "Filed to Job Cost" })).toBeDisabled();

    rerender(
      <DocumentPanelRouteSurface
        record={undoRestoredRecord}
        classifications={classifications}
        onFile={onFile}
      />,
    );

    expect(screen.getByRole("button", { name: "File to Job Cost" })).toBeInTheDocument();
  });

  it("maps document classifications to their intended panel specs", () => {
    const { rerender } = render(
      <DocumentPanelRouteSurface
        record={makeRecord("receipt")}
        classifications={classifications}
      />,
      { wrapper: makeMutationWrapper().Wrapper },
    );

    expect(screen.getByRole("button", { name: "File to Job Cost" })).toBeInTheDocument();
    expect(within(screen.getByTestId("document-resolve-tray")).getByText(/No card match/)).toBeInTheDocument();
    expect(screen.queryByText("Card Match")).not.toBeInTheDocument();
    expect(screen.queryByText("Classify")).not.toBeInTheDocument();

    rerender(<DocumentPanelRouteSurface record={makeRecord("statement")} classifications={classifications} />);
    expect(screen.getByRole("button", { name: "Shelve" })).toBeInTheDocument();
    expect(screen.getByText("Statement Lines")).toBeInTheDocument();

    rerender(<DocumentPanelRouteSurface record={makeRecord("coi")} classifications={classifications} />);
    expect(screen.getByRole("button", { name: "Upload to Spectrum" })).toBeInTheDocument();
    expect(screen.getAllByText("Compliance").length).toBeGreaterThan(0);

    rerender(<DocumentPanelRouteSurface record={makeRecord("w9")} classifications={classifications} />);
    expect(screen.getByRole("button", { name: "Create Vendor & Upload" })).toBeInTheDocument();
    expect(screen.getByText("Vendor Identity")).toBeInTheDocument();

    rerender(<DocumentPanelRouteSurface record={makeRecord("subcontract")} classifications={classifications} />);
    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeInTheDocument();
    expect(screen.getAllByText("Subcontract").length).toBeGreaterThan(0);
    expect(screen.queryByText("Captured Job Match")).not.toBeInTheDocument();

    rerender(<DocumentPanelRouteSurface record={makeRecord("warranty")} classifications={classifications} />);
    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeInTheDocument();
    expect(screen.getByText("Coverage")).toBeInTheDocument();
    expect(screen.queryByText("Captured Job Match")).not.toBeInTheDocument();

    rerender(<DocumentPanelRouteSurface record={makeRecord("lien-waiver")} classifications={classifications} />);
    expect(screen.getByText("Waiver Details")).toBeInTheDocument();
    expect(screen.getByText("Mock unpaired waiver")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File to Documents" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Document sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();
    expect(screen.queryByText("Classify")).not.toBeInTheDocument();

    rerender(<DocumentPanelRouteSurface record={makeRecord("other")} classifications={classifications} />);
    expect(screen.getByText("Captured")).toBeInTheDocument();
    expect(screen.getByText("Classify")).toBeInTheDocument();
    expect(screen.getAllByText("Note").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "File in Documents" })).toBeInTheDocument();
  });

  it("renders the shared audit feed in the COI Activity tab", () => {
    render(
      <DocumentPanelRouteSurface
        record={makeRecord("coi")}
        classifications={classifications}
        auditEntries={auditEntries}
      />,
      { wrapper: makeMutationWrapper().Wrapper },
    );

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByText("mark reviewed")).toBeVisible();
    expect(screen.getByText("dana@example.com")).toBeVisible();
    expect(screen.getByText("Upload status:")).not.toBeVisible();
  });

  it("mounts the shared collaboration entry points on every supported document panel", async () => {
    const user = userEvent.setup();
    const surfaces: ClassificationType[] = [
      "receipt",
      "statement",
      "coi",
      "w9",
      "subcontract",
      "warranty",
      "lien-waiver",
      "other",
    ];

    for (const surface of surfaces) {
      const record = makeRecord(surface);
      const view = render(
        <DocumentPanelRouteSurface
          record={{ ...record, email: { ...record.email, messageId: "source-message" } }}
          classifications={classifications}
          auditEntries={auditEntries}
          canComment
          canEmail
        />,
        { wrapper: makeMutationWrapper().Wrapper },
      );

      const activityTab = screen.getByRole("tab", { name: "Activity" });
      expect(activityTab).toBeInTheDocument();
      await user.click(activityTab);
      expect(screen.getByText("mark reviewed")).toBeVisible();

      await user.click(screen.getByRole("button", { name: "Actions" }));
      expect(screen.getByRole("menuitem", { name: "Add Comment" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Reply" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Forward" })).toBeInTheDocument();

      view.unmount();
    }
  });

  it("routes a served null opensAs mapping through the generic Other panel", () => {
    const nullMappings = classifications.map((classification) => (
      classification.name === "contract" ? { ...classification, opensAs: null } : classification
    ));
    render(
      <DocumentPanelRouteSurface
        record={makeRecord("contract")}
        classifications={nullMappings}
      />,
      { wrapper: makeMutationWrapper().Wrapper },
    );

    expect(screen.getByText("Captured")).toBeInTheDocument();
    expect(screen.getByText("Classify")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File in Documents" })).toBeInTheDocument();
  });

  it("renders a configured actions dropdown for every document panel surface", async () => {
    const user = userEvent.setup();
    const surfaces: ClassificationType[] = [
      "receipt",
      "statement",
      "coi",
      "w9",
      "subcontract",
      "warranty",
      "lien-waiver",
      "other",
    ];

    for (const surface of surfaces) {
      const view = render(
        <DocumentPanelRouteSurface
          record={makeRecord(surface)}
          classifications={classifications}
          onFile={vi.fn()}
          onFileToProject={vi.fn()}
          extraSecondaryActions={[
            { id: "create-rule", label: "Create Rule", onClick: vi.fn() },
            { id: "split-document", label: "Split Document", onClick: vi.fn() },
            ...(surface === "coi"
              ? [{ id: "sync-spectrum", label: "Sync Spectrum", onClick: vi.fn() }]
              : []),
          ]}
        />,
        { wrapper: makeMutationWrapper().Wrapper },
      );

      await user.click(screen.getByRole("button", { name: "Actions" }));

      expect(screen.getByRole("menuitem", { name: "Create Rule" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Split Document" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "File to Project" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Mark Reconciled" })).not.toBeInTheDocument();
      if (surface === "statement") {
        expect(screen.getByRole("menuitem", { name: "Reconcile Invoices" })).toBeInTheDocument();
      } else if (surface === "subcontract" || surface === "warranty" || surface === "other") {
        expect(screen.queryByRole("menuitem", { name: "Shelve" })).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole("menuitem", { name: "Shelve" })).toBeInTheDocument();
      }
      if (surface === "coi") {
        expect(screen.getByRole("menuitem", { name: "Sync Spectrum" })).toBeInTheDocument();
      }

      view.unmount();
    }
  }, 10_000);

  it("chooses a dedicated panel from opensAs for custom classification mappings", () => {
    render(
      <DocumentPanelRouteSurface
        record={makeRecord("contract")}
        classifications={receiptMappedClassifications}
      />,
      { wrapper: makeMutationWrapper().Wrapper },
    );

    expect(screen.getByRole("button", { name: "File to Job Cost" })).toBeInTheDocument();
    expect(within(screen.getByTestId("document-resolve-tray")).getByText(/No card match/)).toBeInTheDocument();
    expect(screen.queryByText("Card Match")).not.toBeInTheDocument();
    expect(screen.queryByText("Classify")).not.toBeInTheDocument();
  });

  it("routes unmapped non-invoice classifications to the generic other spec", () => {
    const fallbackTypes: ClassificationType[] = [
      "change-order",
      "contract",
      "image",
      "no-attachment",
      "all-skipped",
      "skipped",
      "unsupported",
      "error",
    ];
    const { rerender } = render(
      <DocumentPanelRouteSurface
        record={makeRecord(fallbackTypes[0])}
        classifications={classifications}
      />,
      { wrapper: makeMutationWrapper().Wrapper },
    );

    for (const classification of fallbackTypes) {
      rerender(<DocumentPanelRouteSurface record={makeRecord(classification)} classifications={classifications} />);
      expect(screen.getByText("Captured")).toBeInTheDocument();
      expect(screen.getByText("Classify")).toBeInTheDocument();
      expect(screen.getByText("Note", { selector: "h3" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "File in Documents" })).toBeInTheDocument();
    }
  });
});
