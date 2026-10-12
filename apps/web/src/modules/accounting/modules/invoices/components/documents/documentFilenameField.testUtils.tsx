import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocumentPanel } from "./DocumentPanel";
import { makeMutationWrapper } from "../../hooks/mutations.testUtils";
import { SEEDED_DESTINATIONS } from "../../lib/destinationsFixture";
import type { Invoice } from "../../types/invoice";
import type { DocumentFilingMeta, DocumentFormState, DocumentSpecDefinition } from "../../types/documentSpec";

export function registerFilenameTests<T extends DocumentFormState & { filename: string; filing: boolean }>(
  makeRecord: () => Invoice,
  createSpec: (upload: (record: Invoice, meta?: DocumentFilingMeta) => Promise<void>) => DocumentSpecDefinition<Invoice, T>,
) {
  function fixture(): Invoice {
    const record = makeRecord();
    return { ...record, file: "source.docx", filing: { ...record.filing,
      fileName: { value: "Canonical.docx", provenance: "computed", permittedActions: ["edit"], blockers: [] } } };
  }
  function mount(record = fixture(), upload = vi.fn().mockRejectedValue(new Error("Synthetic retryable failure"))) {
    const original = createSpec(upload);
    const spec: DocumentSpecDefinition<Invoice, T> = { ...original, initForm: (value) => ({ ...original.initForm(value), destinationAbsolute: "" }) };
    const { Wrapper, queryClient } = makeMutationWrapper();
    queryClient.setQueryData(["document-destinations"], SEEDED_DESTINATIONS);
    const view = render(<DocumentPanel record={record} spec={spec} />, { wrapper: Wrapper });
    const action = () => screen.getByRole("button", { name: original.build({
      record, form: spec.initForm(record), patchForm: () => undefined, setForm: () => undefined,
    }).primaryAction!.label });
    return { ...view, upload, action, spec };
  }
  describe("F4 filename contract", () => {
    it("retains a real picker selection through a candidate-only refresh", async () => {
      const record = fixture();
      const upload = vi.fn().mockResolvedValue(undefined);
      const spec = createSpec(upload);
      const { Wrapper, queryClient } = makeMutationWrapper();
      queryClient.setQueryData(["document-destinations"], SEEDED_DESTINATIONS);
      const { rerender } = render(<DocumentPanel record={record} spec={spec} />, { wrapper: Wrapper });
      await userEvent.click(screen.getByRole("button", { name: /Browse/ }));
      await userEvent.click(screen.getByRole("button", { name: "Go to Projects root" }));
      await userEvent.click(screen.getByRole("button", { name: "Save to this folder" }));
      const refreshed = { ...record, filing: { ...record.filing!, fileName: { ...record.filing!.fileName, value: "Refreshed.docx" } } };
      rerender(<DocumentPanel record={refreshed} spec={spec} />);
      expect(screen.getByRole("textbox", { name: "File name" })).toHaveValue("Refreshed.docx");
      await userEvent.click(screen.getByRole("button", { name: "File to SharePoint" }));
      await waitFor(() => expect(upload).toHaveBeenCalledWith(refreshed,
        expect.objectContaining({ destinationAbsolute: "", uploadToSharePoint: true })));
    });
    it("renders the editable candidate, sends an extension-preserving override and Reset omits it", async () => {
      const { upload, action } = mount();
      const field = screen.getByRole("textbox", { name: "File name" });
      expect(field).toHaveValue("Canonical.docx");
      expect(field).toBeEnabled();
      expect(field).toHaveAttribute("maxlength", "128");
      fireEvent.change(field, { target: { value: "Custom.pdf" } });
      fireEvent.click(action());
      await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.anything(),
        expect.objectContaining({ filename: "Custom.docx", destinationAbsolute: "", uploadToSharePoint: true })));
      await waitFor(() => expect(field).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      expect(field).toHaveValue("Canonical.docx");
      fireEvent.click(action());
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
      expect(upload.mock.calls[1][1]).not.toHaveProperty("filename");
    });
    it.each(["Canonical.docx", "Canonical", ""])("omits a non-override %j", async (value) => {
      const { upload, action } = mount();
      fireEvent.change(screen.getByRole("textbox", { name: "File name" }), { target: { value } });
      fireEvent.click(action());
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
      expect(upload.mock.calls[0][1]).not.toHaveProperty("filename");
    });
    it("locks the field and Reset for the complete pending upload", async () => {
      let reject!: (reason: Error) => void;
      const upload = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
      const { action } = mount(fixture(), upload);
      const field = screen.getByRole("textbox", { name: "File name" });
      fireEvent.change(field, { target: { value: "Custom" } });
      fireEvent.click(action());
      expect(field).toBeDisabled();
      expect(field).toHaveAttribute("readonly");
      expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
      await act(async () => reject(new Error("Synthetic upload failure")));
      expect(field).toBeEnabled();
    });
    it.each(["filed", "permission"] as const)("locks for %s", (reason) => {
      const record = fixture();
      if (reason === "filed") record.spFileUrl = "https://example.invalid/synthetic.docx";
      else record.filing!.fileName.permittedActions = [];
      mount(record);
      expect(screen.getByRole("textbox", { name: "File name" })).toBeDisabled();
      expect(screen.getByRole("textbox", { name: "File name" })).toHaveAttribute("readonly");
    });
    it("refreshes a clean candidate, preserves a draft, and resets to the latest suggestion", () => {
      const record = fixture();
      const { rerender, spec } = mount(record);
      const refreshed = { ...record, filing: { ...record.filing!, fileName: { ...record.filing!.fileName, value: "Refreshed.docx" } } };
      rerender(<DocumentPanel record={refreshed} spec={spec} />);
      const field = screen.getByRole("textbox", { name: "File name" });
      expect(field).toHaveValue("Refreshed.docx");
      fireEvent.change(field, { target: { value: "My draft" } });
      const newest = { ...refreshed, filing: { ...refreshed.filing, fileName: { ...refreshed.filing.fileName, value: "Newest.docx" } } };
      rerender(<DocumentPanel record={newest} spec={spec} />);
      expect(field).toHaveValue("My draft");
      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      expect(field).toHaveValue("Newest.docx");
    });
  });
}
