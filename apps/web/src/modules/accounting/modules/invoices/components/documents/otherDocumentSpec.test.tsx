import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { registerFilenameTests } from "./documentFilenameField.testUtils";
import { createOtherDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/otherDocumentSpec";
import { makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";
import { SEEDED_DESTINATIONS } from "@/modules/accounting/modules/invoices/lib/destinationsFixture";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock("@/modules/shared/lib/api", () => ({
  api: apiMock,
  isApiError: (error: unknown) => typeof error === "object" && error !== null && "message" in error,
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: toastMock,
}));

const JOB_FOLDER = "23-000/23-1147 - Pemberton Tower TI";

function renderOther(record: Invoice, options: Parameters<typeof createOtherDocumentSpec>[0] = {}) {
  const { queryClient, Wrapper } = makeMutationWrapper();
  queryClient.setQueryData(["document-destinations"], SEEDED_DESTINATIONS);
  return render(<DocumentPanel record={record} spec={createOtherDocumentSpec(options)} />, { wrapper: Wrapper });
}

const classifications: ClassificationInfo[] = [
  { name: "other", label: "Other", opensAs: "other", action: "view-only", builtIn: true, status: "active" },
  { name: "receipt", label: "Receipt", opensAs: "receipt", action: "view-only", builtIn: true, status: "active" },
  { name: "w9", label: "W-9", opensAs: "w9", action: "view-only", builtIn: true, status: "active" },
];

function makeOther(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "other-1",
    classification: "other",
    confidence: 0.52,
    file: "notice.pdf",
    email: { from: "permits@example.com", subject: "Notice of Inspection", receivedAt: "2026-06-14T12:00:00.000Z" },
    status: "pending",
    queuedAt: "2026-06-14T12:00:00.000Z",
    extracted: { vendorName: "Brookfield County Dept. of Buildings", vendorAddress: null, invoiceNumber: null, invoiceDate: null, dueDate: null, amount: null, jobNumber: "23-1147", projectName: "Pemberton Tower TI", description: null, lineItems: [] },
    matching: null,
    overallConfidence: 0.52,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    splitSuggestion: {
      pageCount: 2,
      generatedAt: "2026-06-14T12:00:00.000Z",
      pages: [],
      suggestedGroups: [],
    },
    ...overrides,
  };
}

describe("createOtherDocumentSpec", () => {
  registerFilenameTests(makeOther, (onFileToProject) => createOtherDocumentSpec({ onFileToProject, destinations: SEEDED_DESTINATIONS }));
  it("keeps an edited filename out of Documents-only shelving", async () => {
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const { Wrapper } = makeMutationWrapper();
    const record = makeOther({ filing: { fileName: { value: "Canonical.pdf", provenance: "computed", permittedActions: ["edit"], blockers: [] } } });
    render(<DocumentPanel record={record} spec={createOtherDocumentSpec({ onFileDocument })} />, { wrapper: Wrapper });
    await userEvent.type(screen.getByRole("textbox", { name: "File name" }), " override");
    await userEvent.click(screen.getByRole("button", { name: "File in Documents" }));
    await waitFor(() => expect(onFileDocument).toHaveBeenCalledWith(record));
  });

  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.get.mockImplementation((path: string, params?: Record<string, unknown>) => {
      if (path === "/api/jobs") return Promise.resolve([
        { number: "23-1147", description: "Pemberton Tower TI", address: "Atlanta", status: "active", pm: "PM" },
        { number: "24-018", description: "New Project", address: "Decatur", status: "active", pm: "PM" },
        { number: "24-020", description: "Refreshed Project", address: "Springfield", status: "active", pm: "PM" },
      ]);
      if (path === "/api/jobs/sharepoint/folders") {
        const currentPath = String(params?.path ?? "");
        return Promise.resolve({
          path: currentPath,
          folders: currentPath.endsWith("folder") || currentPath === JOB_FOLDER
            ? [{ id: "financials", name: "02 Financials", hasChildren: null }]
            : [],
          files: [],
        });
      }
      if (path.startsWith("/api/jobs/") && path.endsWith("/folders")) {
        const jobNumber = path.split("/")[3];
        return Promise.resolve({ jobNumber, jobFolder: jobNumber === "23-1147" ? JOB_FOLDER : `${jobNumber}-folder`, folders: [] });
      }
      return Promise.reject(new Error(`Unexpected GET: ${path}`));
    });
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    toastMock.warning.mockReset();
  });

  it("renders the existing job and files the selected served destination through the existing callback", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const onReclassify = vi.fn();
    const onUpdateDocument = vi.fn().mockResolvedValue(undefined);
    renderOther(makeOther(), { classifications, destinations: SEEDED_DESTINATIONS, onFileDocument, onFileToProject, onReclassify, onUpdateDocument });

    expect(screen.getByText("Captured")).toBeInTheDocument();
    expect(screen.getByText("Brookfield County Dept. of Buildings")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "23-1147 — Pemberton Tower TI" })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Save to SharePoint")).toBeInTheDocument();
    expect(screen.queryByText("Clearance Checklist")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File in Documents" })).toBeInTheDocument();

    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/api/jobs/23-1147/folders"));
    await user.click(screen.getByRole("button", { name: "Browse" }));
    await user.click(await screen.findByRole("button", { name: "Open 02 Financials" }));
    await user.click(screen.getByRole("button", { name: "Save to this folder" }));
    expect(screen.queryByRole("button", { name: "File in Documents" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/^Reclassify as/), "receipt");
    expect(onReclassify).toHaveBeenCalledWith("receipt");
    await user.type(screen.getByLabelText(/^Note/), "Route after review");
    await user.click(screen.getByRole("button", { name: "File to SharePoint" }));
    await waitFor(() => expect(onFileToProject).toHaveBeenCalledWith(makeOther(), {
      destination: "02 Financials",
      destinationAbsolute: `${JOB_FOLDER}/02 Financials`,
      note: "Route after review",
      uploadToSharePoint: true,
    }));
    expect(onUpdateDocument).not.toHaveBeenCalled();
  });

  it.each([true, false])("uses served picker context after a manual job change (match=%s)", (matched) => {
    const record = makeOther({ matching: matched ? {
      job: { jobNumber: "31-112", jobDescription: "Maple Commons Retail TI", confidence: 1, method: "exact" },
      vendor: null, subcontract: null, sourceInvoiceTotal: null,
    } : null });
    const spec = createOtherDocumentSpec({ destinations: SEEDED_DESTINATIONS });
    const output = spec.build({ record, form: { ...spec.initForm(record), jobManual: true, jobNumber: "31-112" },
      setForm: vi.fn(), patchForm: vi.fn() });
    const { Wrapper } = makeMutationWrapper();
    render(<>{output.sections.find((section) => section.id === "destination")?.children}</>, { wrapper: Wrapper });
    expect(screen.getByText(`31-112 / ${matched ? "Maple Commons Retail TI" : "Selected project"}`)).toBeInTheDocument();
  });

  it("searches and changes jobs, persists the assignment, and resets the prior destination", async () => {
    const user = userEvent.setup();
    const onUpdateDocument = vi.fn().mockResolvedValue(undefined);
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    renderOther(makeOther({ filedDestination: "02 Financials" }), {
      destinations: SEEDED_DESTINATIONS,
      onFileDocument,
      onUpdateDocument,
    });

    await user.click(screen.getByRole("combobox", { name: "23-1147 — Pemberton Tower TI" }));
    await user.type(screen.getByPlaceholderText("Search jobs…"), "24-018");
    await user.click(await screen.findByText("24-018 — New Project"));

    expect(onUpdateDocument).toHaveBeenCalledWith(makeOther({ filedDestination: "02 Financials" }), { jobNumber: "24-018" });
    expect(screen.getByText("(Job root)")).toBeInTheDocument();
    expect(screen.queryByText("02 Financials")).not.toBeInTheDocument();
    expect(screen.getByText("24-018 / Selected project")).toBeInTheDocument();
  });

  it("restores the served job and destination when a job change is rejected", async () => {
    const user = userEvent.setup();
    const onUpdateDocument = vi.fn().mockRejectedValue(new Error("Job assignment was rejected"));
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    renderOther(makeOther({ filedDestination: "02 Financials" }), {
      destinations: SEEDED_DESTINATIONS,
      onFileDocument,
      onUpdateDocument,
    });

    await user.click(screen.getByRole("combobox", { name: "23-1147 — Pemberton Tower TI" }));
    await user.type(screen.getByPlaceholderText("Search jobs…"), "24-018");
    await user.click(await screen.findByText("24-018 — New Project"));

    expect(await screen.findByText("Filing error — Job assignment was rejected")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "23-1147 — Pemberton Tower TI" })).toBeInTheDocument();
    expect(screen.getByText("02 Financials")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "File in Documents" }));
    await waitFor(() => expect(onFileDocument).toHaveBeenCalledWith(
      makeOther({ filedDestination: "02 Financials" }),
    ));
  });

  it("keeps a failed filing unresolved and surfaces the literal server error", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockRejectedValue(new Error("Server refused this destination"));
    renderOther(makeOther(), {
      destinations: SEEDED_DESTINATIONS,
      onFileDocument,
      onUpdateDocument: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "File in Documents" }));
    expect(await screen.findByText("Filing error — Server refused this destination")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File in Documents" })).toBeEnabled();
  });

  it("keeps SharePoint rejection unresolved without inventing a filed state", async () => {
    const user = userEvent.setup();
    const onFileToProject = vi.fn().mockResolvedValue({ sharePoint: { uploaded: false, error: "Folder access denied" } });
    renderOther(makeOther(), {
      destinations: SEEDED_DESTINATIONS,
      onFileDocument: vi.fn(),
      onFileToProject,
      onUpdateDocument: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Browse" }));
    await user.click(await screen.findByRole("button", { name: "Open 02 Financials" }));
    await user.click(screen.getByRole("button", { name: "Save to this folder" }));
    await user.click(screen.getByRole("button", { name: "File to SharePoint" }));
    expect(await screen.findByText("Filing error — Folder access denied")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeEnabled();
  });

  it("keeps the rendered Documents filing CTA enabled while destinations load", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const jobless = makeOther({
      extracted: { ...makeOther().extracted!, jobNumber: null, projectName: null },
    });
    renderOther(jobless, {
      onFileDocument,
      onUpdateDocument: vi.fn(),
      destinationsLoading: true,
    });

    const action = screen.getByRole("button", { name: "File in Documents" });
    expect(action).toBeEnabled();
    await user.click(action);
    expect(onFileDocument).toHaveBeenCalledWith(jobless);
  });

  it("treats the explicitly selected Projects root as a SharePoint destination", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn();
    const onFileToProject = vi.fn().mockResolvedValue({ sharePoint: { uploaded: true } });
    renderOther(makeOther(), {
      destinations: SEEDED_DESTINATIONS,
      onFileDocument,
      onFileToProject,
      onUpdateDocument: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Browse" }));
    await user.click(await screen.findByRole("button", { name: "Go to Projects root" }));
    await user.click(screen.getByRole("button", { name: "Save to this folder" }));
    await user.click(screen.getByRole("button", { name: "File to SharePoint" }));

    expect(onFileToProject).toHaveBeenCalledWith(makeOther(), expect.objectContaining({
      destinationAbsolute: "",
      uploadToSharePoint: true,
    }));
    expect(onFileDocument).not.toHaveBeenCalled();
  });

  it("locks reclassification while its job update is pending", async () => {
    const user = userEvent.setup();
    let resolveUpdate: (() => void) | undefined;
    const onUpdateDocument = vi.fn(() => new Promise<void>((resolve) => { resolveUpdate = resolve; }));
    renderOther(makeOther(), {
      classifications,
      destinations: SEEDED_DESTINATIONS,
      onFileDocument: vi.fn(),
      onReclassify: vi.fn(),
      onUpdateDocument,
    });

    await user.click(screen.getByRole("combobox", { name: "23-1147 — Pemberton Tower TI" }));
    await user.type(screen.getByPlaceholderText("Search jobs…"), "24-018");
    await user.click(await screen.findByText("24-018 — New Project"));

    await waitFor(() => expect(onUpdateDocument).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/^Reclassify as/)).toBeDisabled();
    await act(async () => { resolveUpdate?.(); });
    await waitFor(() => expect(screen.getByLabelText(/^Reclassify as/)).toBeEnabled());
  });

  it("surfaces a SharePoint warning while keeping the completed Other document filed", async () => {
    const onFileToProject = vi.fn().mockResolvedValue({
      sharePoint: { uploaded: true, warning: "Metadata could not be indexed." },
    });
    const spec = createOtherDocumentSpec({ onFileToProject, destinations: SEEDED_DESTINATIONS });
    let form = {
      ...spec.initForm(makeOther()),
      destination: "02 Financials",
      destinationAbsolute: `${JOB_FOLDER}/02 Financials`,
    };
    const patchForm = (patch: Partial<typeof form>) => {
      form = { ...form, ...patch };
    };
    const output = spec.build({ record: makeOther(), form, setForm: () => undefined, patchForm });

    await output.primaryAction?.onClick();

    expect(form.filed).toBe(true);
    expect(toastMock.warning).toHaveBeenCalledWith(
      "File to Project warning",
      expect.objectContaining({ description: expect.stringContaining("Metadata could not be indexed.") }),
    );
  });

  it("prevents filing when the destination catalog or filing permission callback is unavailable", () => {
    const record = makeOther();
    const noDestination = renderOther(record, {
      destinations: SEEDED_DESTINATIONS,
      destinationsUnavailable: true,
      onFileDocument: vi.fn(),
      onUpdateDocument: vi.fn(),
    });
    expect(screen.getByText("SharePoint destination unavailable — The served destination catalog could not be loaded.")).toBeInTheDocument();
    // Blockers keep their navigation and never become dismissible [fix-2].
    expect(screen.getByRole("button", { name: "Review details" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File in Documents" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Browse" })).toBeDisabled();
    noDestination.unmount();

    renderOther(record, { destinations: SEEDED_DESTINATIONS, onUpdateDocument: vi.fn() });
    expect(screen.getByRole("button", { name: "File in Documents" })).toBeDisabled();
  });

  it("reconciles a clean same-document job refresh while preserving drafts, then resets them for a new document", async () => {
    const user = userEvent.setup();
    const first = makeOther({ notes: "Server note" });
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const options = { destinations: SEEDED_DESTINATIONS, onFileDocument, onUpdateDocument: vi.fn() };
    const view = renderOther(first, options);

    const note = screen.getByLabelText(/^Note/);
    await user.clear(note);
    await user.type(note, "Local draft");
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/api/jobs/23-1147/folders"));
    await user.click(screen.getByRole("button", { name: "Browse" }));
    await user.click(await screen.findByRole("button", { name: "Open 02 Financials" }));
    await user.click(screen.getByRole("button", { name: "Save to this folder" }));
    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeInTheDocument();

    view.rerender(<DocumentPanel record={makeOther({
      notes: "Refreshed server note",
      extracted: { ...first.extracted!, jobNumber: "24-020", projectName: "Refreshed Project" },
    })} spec={createOtherDocumentSpec(options)} />);

    expect(screen.getByRole("combobox", { name: "24-020 — Refreshed Project" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Note/)).toHaveValue("Local draft");
    expect(screen.queryByRole("button", { name: "File to SharePoint" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "File in Documents" }));
    await waitFor(() => expect(onFileDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "other-1" }),
    ));

    view.rerender(<DocumentPanel record={makeOther({ id: "other-2", notes: "Second document" })} spec={createOtherDocumentSpec(options)} />);
    expect(screen.getByLabelText(/^Note/)).toHaveValue("Second document");
  });

  it("does not invent a page count when the server did not provide one", () => {
    renderOther(makeOther({ splitSuggestion: null }), {});
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File in Documents" })).toBeDisabled();
  });
});
