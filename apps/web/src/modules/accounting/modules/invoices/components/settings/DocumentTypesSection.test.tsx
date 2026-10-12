import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ClassificationAssociation,
  ClassificationBatchUpdateResponse,
  ClassificationInfo,
} from "@/modules/accounting/modules/invoices/types/api";

const MOCKS = vi.hoisted(() => ({
  classifications: [] as ClassificationInfo[],
  associations: [] as ClassificationAssociation[],
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  isError: false,
  error: null as Error | null,
}));

vi.mock("sonner", () => ({
  toast: {
    success: MOCKS.toastSuccess,
    error: MOCKS.toastError,
  },
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  DEFAULT_MAPPINGS: [
    { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  ],
  DEFAULT_CLASSIFICATION_ASSOCIATIONS: MOCKS.associations,
  useClassifications: () => ({
    classifications: MOCKS.classifications,
    availableAssociations: MOCKS.associations,
    error: MOCKS.error,
    isError: MOCKS.isError,
    isLoading: false,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useCreateClassification: () => ({ mutate: MOCKS.createMutate, isPending: false }),
  useUpdateClassifications: () => ({ mutate: MOCKS.updateMutate, isPending: false }),
}));

import { DocumentTypesSection } from "@/modules/accounting/modules/invoices/components/settings/DocumentTypesSection";

const baseRows: ClassificationInfo[] = [
  { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  { name: "receipt", label: "Receipt", opensAs: "receipt", action: "extract-match", builtIn: true, status: "active" },
  { name: "custom-doc", label: "Custom Document", opensAs: "other", action: "view-only", builtIn: false, status: "active" },
  { name: "unmapped-custom", label: "Unmapped Custom", opensAs: null, action: "view-only", builtIn: false, status: "active" },
];

const associations: ClassificationAssociation[] = [
  { key: "invoice", label: "Invoice Workflow", description: "Uses approval, coding, and Spectrum submit." },
  { key: "receipt", label: "Receipt Panel", description: "Routes into receipt document review." },
  { key: "other", label: "Generic Panel", description: "Routes into fallback document review." },
];

beforeEach(() => {
  MOCKS.classifications = baseRows.map((row) => ({ ...row }));
  MOCKS.associations = associations.map((association) => ({ ...association }));
  MOCKS.createMutate.mockReset();
  MOCKS.updateMutate.mockReset();
  MOCKS.toastSuccess.mockReset();
  MOCKS.toastError.mockReset();
  MOCKS.isError = false;
  MOCKS.error = null;
});

describe("DocumentTypesSection", () => {
  it("edits a custom destination, marks it dirty, and cancel reverts", async () => {
    const user = userEvent.setup();
    render(<DocumentTypesSection />);

    await chooseDestination(user, "Custom Document", "Receipt Panel");

    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Custom Document opens as" })).toHaveTextContent("Receipt Panel");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("combobox", { name: "Custom Document opens as" })).toHaveTextContent("Generic Panel");
    expect(screen.queryByText("1 unsaved change")).not.toBeInTheDocument();
  });

  it("edits a custom label and destination, then saves both in the batch update payload", async () => {
    const user = userEvent.setup();
    render(<DocumentTypesSection />);

    await user.clear(screen.getByRole("textbox", { name: "custom-doc label" }));
    await user.type(screen.getByRole("textbox", { name: "custom-doc label" }), "Updated Custom Document");
    await chooseDestination(user, "Updated Custom Document", "Receipt Panel");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(MOCKS.updateMutate).toHaveBeenCalledWith(
      { updates: [{ name: "custom-doc", label: "Updated Custom Document", opensAs: "receipt" }] },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );

    const options = MOCKS.updateMutate.mock.calls[0][1];
    act(() => {
      options.onSuccess({
        classifications: [{ ...baseRows[1], label: "Updated Custom Document", opensAs: "receipt" }],
        availableAssociations: associations,
      } satisfies ClassificationBatchUpdateResponse);
    });

    expect(MOCKS.toastSuccess).toHaveBeenCalledWith("Document type mappings saved", { description: "1 change saved." });
  });

  it("saves opensAs overrides for built-in non-invoice rows", async () => {
    const user = userEvent.setup();
    render(<DocumentTypesSection />);

    await chooseDestination(user, "Receipt", "Generic Panel");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(MOCKS.updateMutate).toHaveBeenCalledWith(
      { updates: [{ name: "receipt", opensAs: "other" }] },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("preserves unsaved local edits across same-name classification refetches", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DocumentTypesSection />);

    await user.clear(screen.getByRole("textbox", { name: "custom-doc label" }));
    await user.type(screen.getByRole("textbox", { name: "custom-doc label" }), "Local Draft Label");
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();

    MOCKS.classifications = baseRows.map((row) =>
      row.name === "custom-doc" ? { ...row, label: "Server Refetch Label" } : { ...row },
    );
    rerender(<DocumentTypesSection />);

    expect(screen.getByRole("textbox", { name: "custom-doc label" })).toHaveValue("Local Draft Label");
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
  });

  it("shows an inline fallback warning when classifications fail to load", () => {
    MOCKS.isError = true;
    MOCKS.error = new Error("classification API unavailable");

    render(<DocumentTypesSection />);

    expect(screen.getByText("Showing fallback document types.")).toBeInTheDocument();
    expect(screen.getByText("classification API unavailable")).toBeInTheDocument();
    expect(screen.getByText("Invoice")).toBeInTheDocument();
  });

  it("blocks saving invalid custom labels and allows cancel to clear the error state", async () => {
    const user = userEvent.setup();
    render(<DocumentTypesSection />);

    await user.clear(screen.getByRole("textbox", { name: "custom-doc label" }));

    expect(screen.getByText("Label is required.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Label is required.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
  });

  it("creates a custom type and clears the add form after success", async () => {
    const user = userEvent.setup();
    render(<DocumentTypesSection />);

    await user.click(screen.getByRole("button", { name: "Add Type" }));
    await user.type(screen.getByLabelText("Document type name"), "server-doc");
    await user.type(screen.getByLabelText("Document type label"), "Server Doc");
    await selectNewTypeDestination(user, "Generic Panel");
    await user.click(screen.getByRole("button", { name: "Create Type" }));

    expect(MOCKS.createMutate).toHaveBeenCalledWith(
      { name: "server-doc", label: "Server Doc", opensAs: "other" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );

    const created: ClassificationInfo = {
      name: "server-doc",
      label: "Server Doc",
      opensAs: "other",
      action: "view-only",
      builtIn: false,
      status: "active",
    };
    act(() => {
      MOCKS.createMutate.mock.calls[0][1].onSuccess(created);
    });

    expect(screen.queryByLabelText("Document type name")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Server Doc")).toBeInTheDocument();
    expect(MOCKS.toastSuccess).toHaveBeenCalledWith("Document type added", { description: "Server Doc" });
  });

  it("preserves backend duplicate-name messages from POST failures", async () => {
    const user = userEvent.setup();
    render(<DocumentTypesSection />);

    await user.click(screen.getByRole("button", { name: "Add Type" }));
    await user.type(screen.getByLabelText("Document type name"), "server-conflict");
    await user.type(screen.getByLabelText("Document type label"), "Server Conflict");
    await selectNewTypeDestination(user, "Generic Panel");
    await user.click(screen.getByRole("button", { name: "Create Type" }));

    act(() => {
      MOCKS.createMutate.mock.calls[0][1].onError(Object.assign(new Error("Classification already exists."), { status: 409 }));
    });

    expect(MOCKS.toastError).toHaveBeenCalledWith("Failed to add document type", {
      description: "Classification already exists.",
    });
  });

});

async function chooseDestination(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: `${label} opens as` }));
  expect(screen.getByText("Routes into receipt document review.")).toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: new RegExp(option) }));
}

async function selectNewTypeDestination(user: ReturnType<typeof userEvent.setup>, option: string) {
  await user.click(screen.getByRole("combobox", { name: "New type opens as" }));
  await user.click(screen.getByRole("option", { name: new RegExp(option) }));
}
