import { act, renderHook } from "@testing-library/react";
import { FileText } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDocSpec } from "@/modules/accounting/modules/invoices/hooks/useDocSpec";
import type {
  DocumentFormState,
  DocumentSpecDefinition,
} from "@/modules/accounting/modules/invoices/types/documentSpec";

interface TestRecord {
  id: string;
  title: string;
}

interface TestFormState extends DocumentFormState {
  acknowledged: boolean;
}

interface SwitchingFormState extends DocumentFormState {
  acknowledged?: boolean;
  lines?: string[];
}

interface HookProps {
  activeSpec: DocumentSpecDefinition<TestRecord, SwitchingFormState>;
  recordKey: string;
}

const clickAction = vi.fn();
const flushAction = vi.fn();

const spec: DocumentSpecDefinition<TestRecord, TestFormState> = {
  id: "test-spec",
  label: "Test Spec",
  initForm: () => ({ acknowledged: false }),
  flushPendingChanges: ({ form }) => flushAction(form.acknowledged),
  build: ({ record, form }) => ({
    header: {
      kindLabel: "Document",
      title: record.title,
      statusLabel: form.acknowledged ? "Ready" : "Needs review",
      statusTone: form.acknowledged ? "ok" : "warn",
    },
    sections: [
      {
        id: "summary",
        title: "Summary",
        icon: FileText,
        children: record.title,
      },
    ],
    primaryAction: {
      id: "review",
      label: "Review",
      disabled: !form.acknowledged,
      onClick: clickAction,
    },
  }),
};

const acknowledgementSpec: DocumentSpecDefinition<TestRecord, SwitchingFormState> = {
  id: "acknowledgement-spec",
  label: "Acknowledgement Spec",
  initForm: () => ({ acknowledged: false }),
  build: ({ record, form }) => ({
    header: {
      kindLabel: "Document",
      title: record.title,
      statusLabel: form.acknowledged ? "Acknowledged" : "Needs review",
    },
    sections: [],
  }),
};

const lineSpec: DocumentSpecDefinition<TestRecord, SwitchingFormState> = {
  id: "line-spec",
  label: "Line Spec",
  initForm: () => ({ lines: ["first line"] }),
  build: ({ record, form }) => {
    if (!form.lines) throw new Error("Line spec rendered with stale form state.");
    return {
      header: {
        kindLabel: "Statement",
        title: record.title,
        statusLabel: `${form.lines.length} line`,
      },
      sections: [],
    };
  },
};

describe("useDocSpec", () => {
  beforeEach(() => {
    clickAction.mockReset();
    flushAction.mockReset();
  });

  it("initializes, patches, and resets form-backed spec output", () => {
    const { result } = renderHook(() =>
      useDocSpec({
        spec,
        record: { id: "doc-1", title: "Certificate.pdf" },
        recordKey: "doc-1",
      }),
    );

    expect(result.current.output.header.statusLabel).toBe("Needs review");
    expect(result.current.primaryAction?.disabled).toBe(true);

    act(() => result.current.patchForm({ acknowledged: true }));

    expect(result.current.form.acknowledged).toBe(true);
    expect(result.current.output.header.statusLabel).toBe("Ready");
    expect(result.current.primaryAction?.disabled).toBe(false);

    act(() => result.current.resetForm());

    expect(result.current.form.acknowledged).toBe(false);
  });

  it("flushes pending changes from the current form snapshot", async () => {
    const { result } = renderHook(() =>
      useDocSpec({
        spec,
        record: { id: "doc-1", title: "Certificate.pdf" },
        recordKey: "doc-1",
      }),
    );

    act(() => result.current.patchForm({ acknowledged: true }));
    await act(async () => {
      await result.current.flushPendingChanges();
    });

    expect(flushAction).toHaveBeenCalledWith(true);
  });

  it("uses a fresh form before building a changed spec", () => {
    const { result, rerender } = renderHook(({ activeSpec, recordKey }: HookProps) =>
      useDocSpec({
        spec: activeSpec,
        record: { id: recordKey, title: "Document.pdf" },
        recordKey,
      }), {
        initialProps: { activeSpec: acknowledgementSpec, recordKey: "doc-1" },
      },
    );

    act(() => result.current.patchForm({ acknowledged: true }));
    expect(result.current.output.header.statusLabel).toBe("Acknowledged");

    expect(() => rerender({ activeSpec: lineSpec, recordKey: "doc-2" })).not.toThrow();
    expect(result.current.output.header.statusLabel).toBe("1 line");
  });

  it("preserves a same-document draft across a server refresh", () => {
    const refreshableSpec: DocumentSpecDefinition<TestRecord, TestFormState> = {
      ...spec,
      initForm: (record) => ({ acknowledged: record.title === "Acknowledged" }),
    };
    const { result, rerender } = renderHook(({ record, recordKey }: { record: TestRecord; recordKey: string }) =>
      useDocSpec({ spec: refreshableSpec, record, recordKey, recordId: "doc-1" }), {
        initialProps: { record: { id: "doc-1", title: "Original" }, recordKey: "doc-1|other|original" },
      });

    act(() => result.current.patchForm({ acknowledged: true }));
    rerender({ record: { id: "doc-1", title: "Server refresh" }, recordKey: "doc-1|other|refreshed" });

    expect(result.current.form.acknowledged).toBe(true);
    expect(result.current.output.header.title).toBe("Server refresh");
  });

  it("resets the form when the document identity changes", () => {
    const refreshableSpec: DocumentSpecDefinition<TestRecord, TestFormState> = {
      ...spec,
      initForm: (record) => ({ acknowledged: record.title === "Acknowledged" }),
    };
    const { result, rerender } = renderHook(({ record, recordKey }: { record: TestRecord; recordKey: string }) =>
      useDocSpec({ spec: refreshableSpec, record, recordKey }), {
        initialProps: { record: { id: "doc-1", title: "Original" }, recordKey: "doc-1|other" },
      });

    act(() => result.current.patchForm({ acknowledged: true }));
    rerender({ record: { id: "doc-2", title: "Original" }, recordKey: "doc-2|other" });

    expect(result.current.form.acknowledged).toBe(false);
  });
});
