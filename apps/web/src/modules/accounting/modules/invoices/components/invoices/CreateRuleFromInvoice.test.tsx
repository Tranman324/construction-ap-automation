import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const HOOKS = vi.hoisted(() => ({
  useRules: vi.fn(() => ({
    data: {
      rules: [{ id: "existing-rule", name: "Existing rule", order: 7 }],
      total: 1,
    },
  })),
  saveResult: undefined as unknown,
  deferredOnSaved: undefined as ((result: unknown) => void) | undefined,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/useRules", () => ({
  useRules: HOOKS.useRules,
}));

vi.mock("@/modules/accounting/modules/invoices/components/settings/RuleBuilderModal", () => ({
  RuleBuilderModal: ({
    open,
    sourceInvoice,
    existingRules,
    onSaved,
  }: {
    open: boolean;
    sourceInvoice?: { id: string };
    existingRules: Array<{ id: string }>;
    onSaved?: (result: unknown) => void;
  }) => (
    open ? (
      <div data-testid="rule-builder">
        Builder for {sourceInvoice?.id}; rules: {existingRules.map((rule) => rule.id).join(",")}
        <button type="button" onClick={() => { HOOKS.deferredOnSaved = onSaved; }}>Start rule request</button>
        <button type="button" onClick={() => (HOOKS.deferredOnSaved ?? onSaved)?.(HOOKS.saveResult)}>Complete rule</button>
      </div>
    ) : null
  ),
}));

import { DocumentActionsDropdown } from "@/modules/accounting/modules/invoices/components/documents/DocumentActionsDropdown";
import {
  CreateRuleFromInvoice,
  useCreateRuleFromInvoiceAction,
} from "@/modules/accounting/modules/invoices/components/invoices/CreateRuleFromInvoice";

const invoice: Invoice = {
  id: "inv-1",
  classification: "invoice",
  confidence: 0.96,
  file: "invoice.pdf",
  email: { from: "ap@acme.test", subject: "ACME invoice", receivedAt: "2026-01-01T00:00:00.000Z" },
  status: "pending",
  queuedAt: "2026-01-01T00:00:00.000Z",
  extracted: {
    vendorName: "ACME Concrete",
    vendorAddress: null,
    invoiceNumber: "1048",
    invoiceDate: null,
    dueDate: null,
    amount: 2840.12,
    jobNumber: "24-101",
    projectName: null,
    description: null,
    lineItems: [],
  },
  matching: null,
  overallConfidence: 0.96,
  splitFrom: null,
  duplicateOf: null,
  reason: null,
  error: null,
  reclassifiedFrom: null,
  reclassifiedAt: null,
};

function RuleActionHarness({
  enabled = true,
  currentInvoice = invoice,
  onAppliedTerminalRule,
}: {
  enabled?: boolean;
  currentInvoice?: Invoice | null;
  onAppliedTerminalRule?: () => void;
}) {
  const { action, modal } = useCreateRuleFromInvoiceAction({
    invoice: currentInvoice,
    previewInvoices: [invoice],
    enabled,
    onAppliedTerminalRule,
  });

  return (
    <>
      <DocumentActionsDropdown actions={action ? [action] : []} />
      {modal}
    </>
  );
}

beforeEach(() => {
  HOOKS.useRules.mockClear();
  HOOKS.saveResult = undefined;
  HOOKS.deferredOnSaved = undefined;
});

describe("CreateRuleFromInvoice", () => {
  it("opens the invoice-context rule builder", async () => {
    const user = userEvent.setup();
    render(<CreateRuleFromInvoice invoice={{ ...invoice, file: "invoice.txt" }} />);

    await user.click(screen.getByRole("button", { name: "Create Rule" }));

    expect(screen.getByTestId("rule-builder")).toHaveTextContent("Builder for inv-1");
    expect(screen.getByTestId("rule-builder")).toHaveTextContent("rules: existing-rule");
    expect(HOOKS.useRules).toHaveBeenCalledWith({ enabled: true });
  });

  it("does not expose split actions from the rule control", () => {
    render(<CreateRuleFromInvoice invoice={invoice} />);

    expect(screen.getByRole("button", { name: "Create Rule" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /This should be split/ })).not.toBeInTheDocument();
  });

  it("opens the invoice-context rule builder from a document actions menu item", async () => {
    const user = userEvent.setup();
    render(<RuleActionHarness />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Create Rule" }));

    expect(screen.getByTestId("rule-builder")).toHaveTextContent("Builder for inv-1");
  });

  it("omits the menu item when the route permission gate disables the action", () => {
    render(<RuleActionHarness enabled={false} />);

    expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
    expect(HOOKS.useRules).toHaveBeenCalledWith({ enabled: false });
  });

  it("does not enable the rules query without an invoice", () => {
    render(<RuleActionHarness currentInvoice={null} />);

    expect(HOOKS.useRules).toHaveBeenCalledWith({ enabled: false });
  });

  it.each(["discarded", "approved", "filed"])("advances after a %s source outcome", async (status) => {
    const user = userEvent.setup();
    const onAppliedTerminalRule = vi.fn();
    HOOKS.saveResult = {
      rule: { actions: [{ type: "auto_discard" }] },
      applied: { matchedInvoices: 1, actionsApplied: 1 },
      sourceOutcome: { id: "inv-1", matched: true, status },
    };

    render(<RuleActionHarness onAppliedTerminalRule={onAppliedTerminalRule} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Create Rule" }));
    await user.click(screen.getByRole("button", { name: "Complete rule" }));

    expect(onAppliedTerminalRule).toHaveBeenCalledOnce();
  });

  it("does not advance after a nonterminal applied rule", async () => {
    const user = userEvent.setup();
    const onAppliedTerminalRule = vi.fn();
    HOOKS.saveResult = {
      rule: { actions: [{ type: "set_vendor", value: "ACME01" }] },
      applied: { matchedInvoices: 1, actionsApplied: 1 },
      sourceOutcome: { id: "inv-1", matched: true, status: "pending" },
    };

    render(<RuleActionHarness onAppliedTerminalRule={onAppliedTerminalRule} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Create Rule" }));
    await user.click(screen.getByRole("button", { name: "Complete rule" }));

    expect(onAppliedTerminalRule).not.toHaveBeenCalled();
  });

  it("does not advance when the source document did not match", async () => {
    const user = userEvent.setup();
    const onAppliedTerminalRule = vi.fn();
    HOOKS.saveResult = {
      rule: { actions: [{ type: "auto_discard" }] },
      applied: { matchedInvoices: 5, actionsApplied: 5 },
      sourceOutcome: { id: "inv-1", matched: false, status: "pending" },
    };

    render(<RuleActionHarness onAppliedTerminalRule={onAppliedTerminalRule} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Create Rule" }));
    await user.click(screen.getByRole("button", { name: "Complete rule" }));

    expect(onAppliedTerminalRule).not.toHaveBeenCalled();
  });

  it.each([
    ["a mismatched source ID", { id: "inv-other", matched: true, status: "discarded" }],
    ["a non-boolean matched value", { id: "inv-1", matched: "true", status: "discarded" }],
    ["a matched source with a null status", { id: "inv-1", matched: true, status: null }],
    ["a missing terminal status", { id: "inv-1", matched: true }],
  ])("does not advance for %s", async (_description, sourceOutcome) => {
    const user = userEvent.setup();
    const onAppliedTerminalRule = vi.fn();
    HOOKS.saveResult = {
      rule: { actions: [{ type: "auto_discard" }] },
      applied: { matchedInvoices: 1, actionsApplied: 5 },
      sourceOutcome,
    };

    render(<RuleActionHarness onAppliedTerminalRule={onAppliedTerminalRule} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Create Rule" }));
    await user.click(screen.getByRole("button", { name: "Complete rule" }));

    expect(onAppliedTerminalRule).not.toHaveBeenCalled();
  });

  it("does not advance when the active invoice changed during the request", async () => {
    const user = userEvent.setup();
    const onAppliedTerminalRule = vi.fn();
    HOOKS.saveResult = {
      rule: { actions: [{ type: "auto_discard" }] },
      applied: { matchedInvoices: 1, actionsApplied: 1 },
      sourceOutcome: { id: "inv-1", matched: true, status: "discarded" },
    };

    const { rerender } = render(
      <RuleActionHarness onAppliedTerminalRule={onAppliedTerminalRule} currentInvoice={{ ...invoice, id: "inv-1" }} />,
    );
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Create Rule" }));
    await user.click(screen.getByRole("button", { name: "Start rule request" }));

    rerender(
      <RuleActionHarness onAppliedTerminalRule={onAppliedTerminalRule} currentInvoice={{ ...invoice, id: "inv-2" }} />,
    );

    await user.click(screen.getByRole("button", { name: "Complete rule" }));
    expect(onAppliedTerminalRule).not.toHaveBeenCalled();
  });
});
