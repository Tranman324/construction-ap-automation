/**
 * approve-flow.test.tsx
 * Tests for InvoiceActionBar — approve / reject / discard logic.
 * Strategy: render the component with mocked mutations and a mock formRef;
 * assert on calls and DOM state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import costTypeGlContract from '../../../../../../../../../test-fixtures/invoices/cost-type-gl-contract.json';

// ─── Hoisted mutable state (accessible inside vi.mock factories) ──────────────

const M = vi.hoisted(() => {
  // Default: a ready, unblocked verdict whose codingDefaults match the fixture
  // (subcontract → GL 5450 / cost S / phase 15400 / routing D). Individual tests
  // reassign M.approvalResult to model unavailable or blocked verdicts.
  const makeReadyVerdict = () => ({
    data: {
      path: '1',
      requiredFields: [] as string[],
      blockers: [] as string[],
      blockerDetails: [] as Array<Record<string, string>>,
      unbilledBalance: 500,
      asOf: '2026-07-18T00:00:00.000Z',
      codingDefaults: {
        glAccount: '5450',
        costType: 'S',
        phaseCode: '15400',
        routingCode: 'D',
        glDate: null as string | null,
      },
      suggestedRoutingCode: null as string | null,
      suggestedRoutingPm: null as string | null,
    } as unknown,
    isLoading: false,
    isError: false,
    // Mirrors the real React Query result: `isFetching` is true while a
    // re-fetch (e.g. verdict invalidation after a waiver mutation) is in flight.
    isFetching: false,
  });
  return {
    approveMutate: vi.fn(),
    discardMutate: vi.fn(),
    fileMutate: vi.fn(),
    unapproveMutate: vi.fn(),
    updateMutate: vi.fn(),
    isApproving: false,
    isDiscarding: false,
    isFiling: false,
    isUnapproving: false,
    routerPush: vi.fn(),
    makeReadyVerdict,
    approvalResult: makeReadyVerdict() as { data: unknown; isLoading: boolean; isError: boolean; isFetching?: boolean },
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/modules/accounting/modules/invoices/hooks/mutations', () => ({
  useUpdateInvoice: () => ({ mutate: M.updateMutate, isPending: false }),
  useApproveInvoice: () => ({ mutate: M.approveMutate, isPending: M.isApproving }),
  useDiscardInvoice: () => ({ mutate: M.discardMutate, isPending: M.isDiscarding }),
  useFileDocument: () => ({ mutate: M.fileMutate, isPending: M.isFiling }),
  useUnapproveInvoice: () => ({ mutate: M.unapproveMutate, isPending: M.isUnapproving }),
}));

vi.mock('@/modules/accounting/modules/invoices/hooks/queries', () => ({
  DEFAULT_MAPPINGS: [
    { name: 'invoice', label: 'Invoice', opensAs: 'invoice', action: 'extract-match', builtIn: true, status: 'active' },
    { name: 'receipt', label: 'Receipt', opensAs: 'receipt', action: 'extract-match', builtIn: true, status: 'active' },
    { name: 'pay-application', label: 'Pay Application', opensAs: 'invoice', action: 'extract-match', builtIn: true, status: 'active' },
    { name: 'purchase-order', label: 'Purchase Order', opensAs: 'invoice', action: 'extract-match', builtIn: true, status: 'active' },
    { name: 'credit-memo', label: 'Credit Memo / Adjustment', opensAs: 'invoice', action: 'extract-match', builtIn: true, status: 'active' },
    { name: 'lien-waiver', label: 'Lien Waiver', opensAs: 'lien-waiver', action: 'view-only', builtIn: true, status: 'active' },
  ],
  useValidateApproval: () => M.approvalResult,
  useSubcontracts: () => ({ data: [] }),
  useVendorSearch: () => ({ data: [], isLoading: false }),
  useJobSearch: () => ({ data: [], isLoading: false }),
  useJobByNumber: () => ({ data: null }),
}));

vi.mock('@/modules/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    role: 'admin',
    isAdmin: true,
    permissions: ['*'],
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: M.routerPush }),
}));

// ─── Imports (after mocks are registered) ────────────────────────────────────

import { InvoiceActionBarWithTray as InvoiceActionBar } from './closedPeriodTray.testUtils';
import type { InvoiceDetailFormHandle } from '@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailForm';
import type { Invoice } from '@/modules/accounting/modules/invoices/types/invoice';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }

  return Wrapper;
}

function makeFormRef(
  hasEdits: boolean,
  triggerSave: InvoiceDetailFormHandle['triggerSave'],
): React.RefObject<InvoiceDetailFormHandle | null> {
  return {
    current: {
      hasEdits,
      triggerSave,
      getApprovalPreview: () => ({
        invoiceNumber: 'INV-001',
        amount: 100,
        invoiceDate: '2026-03-01',
        vendorCode: 'V001',
        jobNumber: '',
        subcontractNumber: '25-517.08',
      }),
    },
  } as React.RefObject<InvoiceDetailFormHandle | null>;
}

function makeInvoiceFixture(): Invoice {
  const invoice: Invoice = {
    id: 'test-id',
    classification: 'invoice',
    confidence: 0.9,
    overallConfidence: 0.9,
    file: 'test.pdf',
    email: { from: 'vendor@example.com', subject: 'Invoice', receivedAt: '2026-03-01T00:00:00Z' },
    status: 'pending',
    queuedAt: '2026-03-01T00:00:00Z',
    extracted: {
      vendorName: 'Acme',
      vendorAddress: null,
      invoiceNumber: 'INV-001',
      invoiceDate: '2026-03-01',
      dueDate: null,
      amount: 100,
      jobNumber: '25-517',
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: {
      vendor: { vendorCode: 'V001', vendorName: 'Acme', confidence: 1, method: 'test' },
      job: { jobNumber: '', confidence: 1, method: 'test' },
      subcontract: { subcontractNumber: '25-517.08', confidence: 1, method: 'test' },
      sourceInvoiceTotal: 100,
    },
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
  return Object.assign(invoice, { gl_account: '5450' });
}

type BarProps = React.ComponentProps<typeof InvoiceActionBar>;

function makeBarProps(overrides: Partial<BarProps> = {}): BarProps {
  const defaults: BarProps = {
    invoiceId: 'test-id',
    invoice: makeInvoiceFixture(),
    classification: 'invoice',
    formRef: makeFormRef(false, vi.fn()),
    hasUnsavedChanges: false,
  };
  return { ...defaults, ...overrides };
}

function renderBar(overrides: Partial<BarProps> = {}) {
  return render(
    React.createElement(InvoiceActionBar, makeBarProps(overrides)),
    { wrapper: makeWrapper() },
  );
}

async function startDelayedApprove(invoice: Invoice) {
  let resolveSave!: () => void;
  const onBeforeApprove = vi.fn(() => new Promise<void>((resolve) => {
    resolveSave = resolve;
  }));
  const initialProps = makeBarProps({
    invoiceId: invoice.id,
    invoice,
    hasPendingApprovalSave: true,
    onBeforeApprove,
  });
  const view = render(
    React.createElement(InvoiceActionBar, initialProps),
    { wrapper: makeWrapper() },
  );
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: /save & approve/i }));
  expect(M.approveMutate).not.toHaveBeenCalled();

  return { ...view, initialProps, resolveSave };
}

async function startDelayedFormSaveBeforeApprove(invoice: Invoice) {
  let resolveFormSave!: () => void;
  const triggerSave = vi.fn((onSuccess?: () => void) => {
    resolveFormSave = () => onSuccess?.();
  });
  const onBeforeApprove = vi.fn(async () => undefined);
  const initialProps = makeBarProps({
    invoiceId: invoice.id,
    invoice,
    formRef: makeFormRef(true, triggerSave as InvoiceDetailFormHandle['triggerSave']),
    hasUnsavedChanges: true,
    hasPendingApprovalSave: true,
    onBeforeApprove,
  });
  const view = render(
    React.createElement(InvoiceActionBar, initialProps),
    { wrapper: makeWrapper() },
  );
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: /save & approve/i }));
  expect(triggerSave).toHaveBeenCalledTimes(1);
  expect(onBeforeApprove).not.toHaveBeenCalled();
  expect(M.approveMutate).not.toHaveBeenCalled();

  return { ...view, initialProps, onBeforeApprove, resolveFormSave };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  M.approveMutate.mockReset();
  M.discardMutate.mockReset();
  M.fileMutate.mockReset();
  M.unapproveMutate.mockReset();
  M.updateMutate.mockReset();
  M.routerPush.mockReset();
  M.approvalResult = M.makeReadyVerdict();
  M.isApproving = false;
  M.isDiscarding = false;
  M.isFiling = false;
  M.isUnapproving = false;
});

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('InvoiceActionBar — approve flow', () => {
  // ── Cause 1: approve gate = SERVER verdict ONLY ──────────────────────────────
  // The client waiver signal (`waiverGateBlocked`, sourced from page.tsx's
  // `missingWaiverAttention`) must NOT gate Approve. A ready verdict with an
  // EMPTY blockers list enables Approve even while the client still believes a
  // waiver is missing — the served `blockers` are the single source of truth
  // (D1). Sabotage check: re-introduce `waiverGateBlocked` into the approve
  // disabled/enabled expression and this test goes red.
  it('enables approve from the served verdict even when the client waiver gate is blocked', () => {
    const onPrimaryActionChange = vi.fn();
    // Ready verdict, blockers: [] (default) — but the client waiver gate is ON.
    renderBar({ waiverGateBlocked: true, onPrimaryActionChange });

    expect(screen.getByRole('button', { name: /^approve$/i })).toBeEnabled();
    expect(onPrimaryActionChange.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      label: 'Approve',
      disabled: false,
    }));
  });

  // ── Cause 2: pending state while the verdict re-fetches ──────────────────────
  // While a verdict re-fetch is in flight (isFetching — e.g. a waiver mutation
  // just invalidated the verdict), Approve renders as pending ("Checking…") but
  // accepts one click as the queued intent. It must NOT gate on the STALE
  // blockers that `placeholderData` keeps visible during the fetch.
  it('shows a pending "Checking…" approve button while the verdict is re-fetching', () => {
    M.approvalResult = { ...M.makeReadyVerdict(), isFetching: true };
    const onPrimaryActionChange = vi.fn();
    renderBar({ onPrimaryActionChange });

    expect(screen.getByRole('button', { name: /checking/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(onPrimaryActionChange.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      label: 'Checking…',
      disabled: false,
    }));
  });

  it('queues one approve until a fresh refetched verdict succeeds', async () => {
    const onPrimaryActionChange = vi.fn();
    M.approvalResult = { ...M.makeReadyVerdict(), isFetching: true };
    const initialProps = makeBarProps({ onPrimaryActionChange });
    const { rerender } = render(
      React.createElement(InvoiceActionBar, initialProps),
      { wrapper: makeWrapper() },
    );

    const queuedAction = onPrimaryActionChange.mock.calls.at(-1)?.[0] as { run: () => void };
    act(() => { queuedAction.run(); });

    expect(screen.queryByText(/still checking approval requirements/i)).not.toBeInTheDocument();
    expect(M.approveMutate).not.toHaveBeenCalled();

    M.approvalResult = M.makeReadyVerdict();
    rerender(React.createElement(InvoiceActionBar, initialProps));

    await waitFor(() => expect(M.approveMutate).toHaveBeenCalledTimes(1));
  });

  it('queues a stale blocked verdict once and ignores ready-query churn after dispatch', async () => {
    const user = userEvent.setup();
    const stale = M.makeReadyVerdict();
    M.approvalResult = {
      ...stale,
      data: {
        ...(stale.data as Record<string, unknown>),
        blockers: ['Lien Waiver is required.'],
      },
      isFetching: true,
    };
    const initialProps = makeBarProps();
    const { rerender } = render(
      React.createElement(InvoiceActionBar, initialProps),
      { wrapper: makeWrapper() },
    );

    const checkingButton = screen.getByRole('button', { name: /checking/i });
    expect(checkingButton).toBeEnabled();
    await user.click(checkingButton);
    await user.click(checkingButton);

    M.approvalResult = M.makeReadyVerdict();
    rerender(React.createElement(InvoiceActionBar, initialProps));
    await waitFor(() => expect(M.approveMutate).toHaveBeenCalledTimes(1));

    rerender(React.createElement(InvoiceActionBar, initialProps));
    expect(M.approveMutate).toHaveBeenCalledTimes(1);
  });

  it('saves once before queuing an approve during verdict refetch', async () => {
    const user = userEvent.setup();
    const triggerSave = vi.fn((onSuccess?: () => void) => {
      onSuccess?.();
    });
    M.approvalResult = { ...M.makeReadyVerdict(), isFetching: true };
    const initialProps = makeBarProps({
      hasUnsavedChanges: true,
      formRef: makeFormRef(true, triggerSave as InvoiceDetailFormHandle['triggerSave']),
    });
    const { rerender } = render(
      React.createElement(InvoiceActionBar, initialProps),
      { wrapper: makeWrapper() },
    );

    await user.click(screen.getByRole('button', { name: /checking/i }));

    expect(triggerSave).toHaveBeenCalledTimes(1);
    expect(M.approveMutate).not.toHaveBeenCalled();

    M.approvalResult = M.makeReadyVerdict();
    rerender(React.createElement(InvoiceActionBar, initialProps));

    await waitFor(() => expect(M.approveMutate).toHaveBeenCalledTimes(1));
    expect(triggerSave).toHaveBeenCalledTimes(1);
  });

  it('deduplicates re-entrant save-and-approve intents while the form save is pending', async () => {
    let resolveSave!: () => void;
    let resolveBeforeApprove!: () => void;
    const triggerSave = vi.fn((onSuccess?: () => void) => {
      resolveSave = () => onSuccess?.();
    });
    const onBeforeApprove = vi.fn(() => new Promise<void>((resolve) => {
      resolveBeforeApprove = resolve;
    }));
    const onPrimaryActionChange = vi.fn();
    renderBar({
      hasUnsavedChanges: true,
      hasPendingApprovalSave: true,
      formRef: makeFormRef(true, triggerSave as InvoiceDetailFormHandle['triggerSave']),
      onBeforeApprove,
      onPrimaryActionChange,
    });

    const action = onPrimaryActionChange.mock.calls.at(-1)?.[0] as { run: () => void };
    act(() => {
      action.run();
      action.run();
    });

    expect(triggerSave).toHaveBeenCalledTimes(1);
    expect(onBeforeApprove).not.toHaveBeenCalled();

    act(() => { resolveSave(); });
    await waitFor(() => expect(onBeforeApprove).toHaveBeenCalledTimes(1));
    expect(M.approveMutate).not.toHaveBeenCalled();

    act(() => { resolveBeforeApprove(); });
    await waitFor(() => expect(M.approveMutate).toHaveBeenCalledTimes(1));
  });

  it('allows a later save-and-approve retry after a terminal save error', async () => {
    const onPrimaryActionChange = vi.fn();
    const triggerSave = vi.fn(
      (onSuccess?: () => void, onError?: (error: Error) => void) => {
        if (triggerSave.mock.calls.length === 1) {
          onError?.(new Error('PATCH failed'));
          return;
        }
        onSuccess?.();
      },
    );
    renderBar({
      hasUnsavedChanges: true,
      formRef: makeFormRef(true, triggerSave as InvoiceDetailFormHandle['triggerSave']),
      onPrimaryActionChange,
    });

    act(() => { (onPrimaryActionChange.mock.calls.at(-1)?.[0] as { run: () => void }).run(); });
    await waitFor(() => expect(screen.getByText(/patch failed/i)).toBeInTheDocument());

    act(() => { (onPrimaryActionChange.mock.calls.at(-1)?.[0] as { run: () => void }).run(); });
    await waitFor(() => expect(triggerSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(M.approveMutate).toHaveBeenCalledTimes(1));
  });

  it('uses the unavailable verdict message when a queued refetch settles with an error', () => {
    const onPrimaryActionChange = vi.fn();
    M.approvalResult = { ...M.makeReadyVerdict(), isFetching: true };
    const initialProps = makeBarProps({ onPrimaryActionChange });
    const { rerender } = render(
      React.createElement(InvoiceActionBar, initialProps),
      { wrapper: makeWrapper() },
    );

    const queuedAction = onPrimaryActionChange.mock.calls.at(-1)?.[0] as { run: () => void };
    act(() => { queuedAction.run(); });

    M.approvalResult = { data: undefined, isLoading: false, isError: true, isFetching: false };
    rerender(React.createElement(InvoiceActionBar, initialProps));

    expect(M.approveMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/approval requirements are unavailable\. refresh and try again/i)).toBeInTheDocument();
  });

  it('drops a queued approval when the active invoice changes before verdict settlement', () => {
    const onPrimaryActionChange = vi.fn();
    const invoiceA = { ...makeInvoiceFixture(), id: 'invoice-a' };
    const invoiceB = { ...makeInvoiceFixture(), id: 'invoice-b' };
    M.approvalResult = { ...M.makeReadyVerdict(), isFetching: true };
    const initialProps = makeBarProps({
      invoiceId: invoiceA.id,
      invoice: invoiceA,
      onPrimaryActionChange,
    });
    const { rerender } = render(
      React.createElement(InvoiceActionBar, initialProps),
      { wrapper: makeWrapper() },
    );

    const queuedAction = onPrimaryActionChange.mock.calls.at(-1)?.[0] as { run: () => void };
    act(() => { queuedAction.run(); });
    expect(screen.queryByText(/still checking approval requirements/i)).not.toBeInTheDocument();

    rerender(React.createElement(InvoiceActionBar, {
      ...initialProps,
      invoiceId: invoiceB.id,
      invoice: invoiceB,
    }));
    M.approvalResult = M.makeReadyVerdict();
    rerender(React.createElement(InvoiceActionBar, {
      ...initialProps,
      invoiceId: invoiceB.id,
      invoice: invoiceB,
    }));

    expect(M.approveMutate).not.toHaveBeenCalled();
  });

  it('drops a queued approval on unmount before verdict settlement', () => {
    const onPrimaryActionChange = vi.fn();
    M.approvalResult = { ...M.makeReadyVerdict(), isFetching: true };
    const { unmount } = renderBar({ onPrimaryActionChange });

    const queuedAction = onPrimaryActionChange.mock.calls.at(-1)?.[0] as { run: () => void };
    act(() => { queuedAction.run(); });
    expect(screen.queryByText(/still checking approval requirements/i)).not.toBeInTheDocument();

    unmount();
    M.approvalResult = M.makeReadyVerdict();

    expect(M.approveMutate).not.toHaveBeenCalled();
  });

  it('disables approved-invoice Spectrum submission while the waiver gate is blocked', () => {
    renderBar({
      invoiceStatus: 'approved',
      waiverGateBlocked: true,
      spectrumSubmitControl: {
        label: 'Submit to Spectrum',
        pending: false,
        disabled: false,
        onSubmit: vi.fn(),
      },
    });

    expect(screen.getByRole('button', { name: 'Submit to Spectrum' })).toBeDisabled();
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  it('approving with hasEdits=false calls useApproveInvoice directly, no PATCH', async () => {
    const user = userEvent.setup();
    const triggerSave = vi.fn();
    renderBar({ formRef: makeFormRef(false, triggerSave) });

    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(M.approveMutate).toHaveBeenCalledWith(
      { id: 'test-id', payload: expect.objectContaining({ glAccount: '5450', routingCode: 'D' }) },
      expect.any(Object),
    );
    expect(M.updateMutate).not.toHaveBeenCalled();
    expect(triggerSave).not.toHaveBeenCalled();
  });

  it('saves pending allocation changes before approving', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const onBeforeApprove = vi.fn(async () => {
      order.push('allocation-save');
    });
    M.approveMutate.mockImplementationOnce(() => {
      order.push('approve');
    });

    renderBar({
      hasPendingApprovalSave: true,
      onBeforeApprove,
    });

    await user.click(screen.getByRole('button', { name: /save & approve/i }));

    await waitFor(() => expect(M.approveMutate).toHaveBeenCalled());
    expect(onBeforeApprove).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['allocation-save', 'approve']);
  });

  it('approves with the latest derivation-owned GL after a refetch during the awaited save', async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const onBeforeApprove = vi.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    const initialProps = makeBarProps({
      hasPendingApprovalSave: true,
      onBeforeApprove,
      approvalOverrides: {
        costType: 'E',
        glAccount: '5500',
      },
    });
    const { rerender } = render(
      React.createElement(InvoiceActionBar, initialProps),
      { wrapper: makeWrapper() },
    );

    await user.click(screen.getByRole('button', { name: /save & approve/i }));
    expect(M.approveMutate).not.toHaveBeenCalled();

    const refetched = M.makeReadyVerdict();
    M.approvalResult = {
      ...refetched,
      data: {
        ...(refetched.data as Record<string, unknown>),
        codingDefaults: {
          ...(refetched.data as { codingDefaults: Record<string, unknown> }).codingDefaults,
          costType: 'E',
          glAccount: '5600',
        },
      },
    };
    rerender(React.createElement(InvoiceActionBar, {
      ...initialProps,
      approvalOverrides: {
        costType: 'E',
        glAccount: '5600',
      },
    }));

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(M.approveMutate).toHaveBeenCalledWith(
      {
        id: 'test-id',
        payload: expect.objectContaining({
          costType: 'E',
          glAccount: '5600',
        }),
      },
      expect.any(Object),
    );
  });

  it('approves with a manual GL chosen during the awaited save despite a later refetch', async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const onBeforeApprove = vi.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    const initialProps = makeBarProps({
      hasPendingApprovalSave: true,
      onBeforeApprove,
      approvalOverrides: {
        costType: 'E',
        glAccount: '5500',
      },
    });
    const { rerender } = render(
      React.createElement(InvoiceActionBar, initialProps),
      { wrapper: makeWrapper() },
    );

    await user.click(screen.getByRole('button', { name: /save & approve/i }));
    expect(M.approveMutate).not.toHaveBeenCalled();

    const refetched = M.makeReadyVerdict();
    M.approvalResult = {
      ...refetched,
      data: {
        ...(refetched.data as Record<string, unknown>),
        codingDefaults: {
          ...(refetched.data as { codingDefaults: Record<string, unknown> }).codingDefaults,
          costType: 'E',
          glAccount: '5600',
        },
      },
    };
    rerender(React.createElement(InvoiceActionBar, {
      ...initialProps,
      approvalOverrides: {
        costType: 'E',
        glAccount: '5300',
      },
    }));

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(M.approveMutate).toHaveBeenCalledWith(
      {
        id: 'test-id',
        payload: expect.objectContaining({
          costType: 'E',
          glAccount: '5300',
        }),
      },
      expect.any(Object),
    );
  });

  it('abandons an awaited approve when the component renders a different invoice', async () => {
    const invoiceA = { ...makeInvoiceFixture(), id: 'invoice-a' };
    const invoiceB = { ...makeInvoiceFixture(), id: 'invoice-b' };
    const { initialProps, rerender, resolveSave } = await startDelayedApprove(invoiceA);

    rerender(React.createElement(InvoiceActionBar, {
      ...initialProps,
      invoiceId: invoiceB.id,
      invoice: invoiceB,
    }));

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(M.approveMutate).not.toHaveBeenCalled();
  });

  it('abandons an awaited approve after an A to B to A identity round trip', async () => {
    const invoiceA = { ...makeInvoiceFixture(), id: 'invoice-a' };
    const invoiceB = { ...makeInvoiceFixture(), id: 'invoice-b' };
    const { initialProps, rerender, resolveSave } = await startDelayedApprove(invoiceA);

    rerender(React.createElement(InvoiceActionBar, {
      ...initialProps,
      invoiceId: invoiceB.id,
      invoice: invoiceB,
    }));
    rerender(React.createElement(InvoiceActionBar, initialProps));

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(M.approveMutate).not.toHaveBeenCalled();
  });

  it('abandons an awaited approve after the component unmounts', async () => {
    const invoiceA = { ...makeInvoiceFixture(), id: 'invoice-a' };
    const { unmount, resolveSave } = await startDelayedApprove(invoiceA);

    unmount();
    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(M.approveMutate).not.toHaveBeenCalled();
  });

  it('does not start an allocation save after the pending form save crosses to another invoice', async () => {
    const invoiceA = { ...makeInvoiceFixture(), id: 'invoice-a' };
    const invoiceB = { ...makeInvoiceFixture(), id: 'invoice-b' };
    const {
      initialProps,
      onBeforeApprove,
      rerender,
      resolveFormSave,
    } = await startDelayedFormSaveBeforeApprove(invoiceA);

    rerender(React.createElement(InvoiceActionBar, {
      ...initialProps,
      invoiceId: invoiceB.id,
      invoice: invoiceB,
    }));

    await act(async () => {
      resolveFormSave();
      await Promise.resolve();
    });

    expect(onBeforeApprove).not.toHaveBeenCalled();
    expect(M.approveMutate).not.toHaveBeenCalled();
  });

  it('does not start an allocation save after the pending form save crosses A to B to A', async () => {
    const invoiceA = { ...makeInvoiceFixture(), id: 'invoice-a' };
    const invoiceB = { ...makeInvoiceFixture(), id: 'invoice-b' };
    const {
      initialProps,
      onBeforeApprove,
      rerender,
      resolveFormSave,
    } = await startDelayedFormSaveBeforeApprove(invoiceA);

    rerender(React.createElement(InvoiceActionBar, {
      ...initialProps,
      invoiceId: invoiceB.id,
      invoice: invoiceB,
    }));
    rerender(React.createElement(InvoiceActionBar, initialProps));

    await act(async () => {
      resolveFormSave();
      await Promise.resolve();
    });

    expect(onBeforeApprove).not.toHaveBeenCalled();
    expect(M.approveMutate).not.toHaveBeenCalled();
  });

  it('does not start an allocation save after the pending form save outlives the component', async () => {
    const invoiceA = { ...makeInvoiceFixture(), id: 'invoice-a' };
    const {
      onBeforeApprove,
      resolveFormSave,
      unmount,
    } = await startDelayedFormSaveBeforeApprove(invoiceA);

    unmount();
    await act(async () => {
      resolveFormSave();
      await Promise.resolve();
    });

    expect(onBeforeApprove).not.toHaveBeenCalled();
    expect(M.approveMutate).not.toHaveBeenCalled();
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  it('approving with hasEdits=true calls triggerSave first, then approve on success', async () => {
    const user = userEvent.setup();
    // triggerSave immediately invokes onSuccess callback
    const triggerSave = vi.fn((onSuccess?: () => void) => {
      onSuccess?.();
    });
    renderBar({
      formRef: makeFormRef(true, triggerSave as InvoiceDetailFormHandle['triggerSave']),
      hasUnsavedChanges: true,
    });

    await user.click(screen.getByRole('button', { name: /save & approve/i }));

    expect(triggerSave).toHaveBeenCalled();
    // The approve path suppresses the global mutation toast (F1a): a save
    // failure here surfaces as the inline approve-error message, so the toast
    // would only double it. Other save paths (autosave, manual Save, skip) do
    // NOT pass this flag and keep the toast.
    expect(triggerSave).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { suppressErrorToast: true },
    );
    expect(M.approveMutate).toHaveBeenCalledWith(
      { id: 'test-id', payload: expect.objectContaining({ glAccount: '5450', routingCode: 'D' }) },
      expect.any(Object),
    );
  });

  // ── Test 2b ────────────────────────────────────────────────────────────────
  it('TEST: path 1 populates phase/cost/gl/routing from the served coding defaults', async () => {
    const user = userEvent.setup();
    const triggerSave = vi.fn();
    const formRef = {
      current: {
        hasEdits: false,
        triggerSave,
        getApprovalPreview: () => ({
          invoiceNumber: 'INV-001',
          amount: 100,
          invoiceDate: '2026-03-01',
          vendorCode: 'V001',
          jobNumber: '25-517',
          subcontractNumber: '25-517.08',
        }),
      },
    } as unknown as React.RefObject<InvoiceDetailFormHandle | null>;

    renderBar({ formRef });

    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(M.approveMutate).toHaveBeenCalledWith(
      {
        id: 'test-id',
        payload: expect.objectContaining({
          phaseCode: '15400',
          costType: 'S',
          glAccount: '5450',
          routingCode: 'D',
          glDate: '2026-03-01',
        }),
      },
      expect.any(Object),
    );
    expect(triggerSave).not.toHaveBeenCalled();
  });

  it('never rides a routing suggestion into the approve payload (only row / codingDefaults)', async () => {
    const user = userEvent.setup();
    const ready = M.makeReadyVerdict();
    const readyData = ready.data as { codingDefaults: Record<string, unknown> };
    // A verdict carrying a routing SUGGESTION but NO row routing and NO
    // codingDefaults routing. The suggestion must NEVER auto-apply at approve.
    M.approvalResult = {
      ...ready,
      data: {
        ...(ready.data as Record<string, unknown>),
        suggestedRoutingCode: 'JS',
        codingDefaults: { ...readyData.codingDefaults, routingCode: null },
      },
    };
    const formRef = {
      current: {
        hasEdits: false,
        triggerSave: vi.fn(),
        getApprovalPreview: () => ({
          invoiceNumber: 'INV-001',
          amount: 100,
          invoiceDate: '2026-03-01',
          vendorCode: 'V001',
          jobNumber: '25-517',
          subcontractNumber: '25-517.08',
        }),
      },
    } as unknown as React.RefObject<InvoiceDetailFormHandle | null>;

    // No approvalOverrides; the fixture carries no routing_code.
    renderBar({ formRef });

    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(M.approveMutate).toHaveBeenCalledTimes(1);
    const payload = (M.approveMutate.mock.calls[0][0] as { payload: { routingCode?: string } }).payload;
    // routingCode resolves from live override -> row -> codingDefaults ONLY; a
    // suggestion is not on the row and not in codingDefaults, so it never rides in.
    expect(payload.routingCode).toBeUndefined();
  });

  // ── Test 2c ────────────────────────────────────────────────────────────────
  it('TEST: path 2 uses live override routing code and allows approve', async () => {
    const user = userEvent.setup();
    const triggerSave = vi.fn();
    const formRef = {
      current: {
        hasEdits: false,
        triggerSave,
        getApprovalPreview: () => ({
          invoiceNumber: 'INV-001',
          amount: 9954.8,
          invoiceDate: '2026-03-01',
          vendorCode: 'V001',
          jobNumber: '25-517',
          subcontractNumber: '25-517.08',
        }),
      },
    } as unknown as React.RefObject<InvoiceDetailFormHandle | null>;

    renderBar({
      formRef,
      approvalOverrides: {
        routingCode: 'JS',
        phaseCode: '15400',
        costType: 'S',
        glAccount: '5450',
      },
    });

    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(M.approveMutate).toHaveBeenCalledWith(
      {
        id: 'test-id',
        payload: expect.objectContaining({
          routingCode: 'JS',
          phaseCode: '15400',
          costType: 'S',
          glAccount: '5450',
          glDate: '2026-03-01',
        }),
      },
      expect.any(Object),
    );
    expect(screen.queryByText(/missing required fields for approval/i)).not.toBeInTheDocument();
    expect(triggerSave).not.toHaveBeenCalled();
  });

  it('preserves user-entered approval values over subcontract defaults', async () => {
    const user = userEvent.setup();
    const invoice = Object.assign(makeInvoiceFixture(), {
      routing_code: 'AP',
      phase_code: '09100',
      cost_type: 'L',
      gl_account: '5500',
      gl_date: '2026-02-28',
    });
    const formRef = {
      current: {
        hasEdits: false,
        triggerSave: vi.fn(),
        getApprovalPreview: () => ({
          invoiceNumber: 'INV-001',
          amount: 100,
          invoiceDate: '2026-03-15',
          vendorCode: 'V001',
          jobNumber: '25-517',
          subcontractNumber: '25-517.08',
        }),
      },
    } as unknown as React.RefObject<InvoiceDetailFormHandle | null>;

    renderBar({
      invoice,
      formRef,
      approvalOverrides: {
        routingCode: 'JS',
        phaseCode: '09600',
        costType: 'M',
        glAccount: '5300',
      },
    });

    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(M.approveMutate).toHaveBeenCalledWith(
      {
        id: 'test-id',
        payload: expect.objectContaining({
          routingCode: 'JS',
          phaseCode: '09600',
          costType: 'M',
          glAccount: '5300',
          glDate: '2026-03-15',
        }),
      },
      expect.any(Object),
    );
  });

  it('preserves persisted approval values when live overrides are empty', async () => {
    const user = userEvent.setup();
    const invoice = Object.assign(makeInvoiceFixture(), {
      routing_code: 'AP',
      phase_code: '09100',
      cost_type: 'L',
      gl_account: '5500',
      gl_date: '2026-02-28',
    });
    const formRef = {
      current: {
        hasEdits: false,
        triggerSave: vi.fn(),
        getApprovalPreview: () => ({
          invoiceNumber: 'INV-001',
          amount: 100,
          invoiceDate: '',
          vendorCode: 'V001',
          jobNumber: '25-517',
          subcontractNumber: '25-517.08',
        }),
      },
    } as unknown as React.RefObject<InvoiceDetailFormHandle | null>;

    renderBar({
      invoice,
      formRef,
      approvalOverrides: {
        routingCode: '',
        phaseCode: '',
        costType: '',
        glAccount: '',
      },
    });

    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(M.approveMutate).toHaveBeenCalledWith(
      {
        id: 'test-id',
        payload: expect.objectContaining({
          routingCode: 'AP',
          phaseCode: '09100',
          costType: 'L',
          glAccount: '5500',
          glDate: '2026-02-28',
        }),
      },
      expect.any(Object),
    );
  });

  // ── Verdict unavailable: disable + no client fallback ────────────────────────
  it('disables approve and refuses to compute a fallback when the verdict is unavailable', () => {
    M.approvalResult = { data: undefined, isLoading: false, isError: true };
    const onPrimaryActionChange = vi.fn();
    renderBar({ onPrimaryActionChange });

    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();
    const last = onPrimaryActionChange.mock.calls.at(-1)?.[0] as { disabled: boolean; run: () => void };
    expect(last).toEqual(expect.objectContaining({ disabled: true }));

    // Invoking the primary action still refuses — no client-computed payload.
    act(() => { last.run(); });
    expect(M.approveMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/approval requirements are unavailable/i)).toBeInTheDocument();
  });

  // ── Served blockers gate approve (D1), rendered as discrete list items ───────
  it('blocks approve and surfaces the served blockers as separate list items (D1)', () => {
    const ready = M.makeReadyVerdict();
    M.approvalResult = {
      ...ready,
      data: {
        ...(ready.data as Record<string, unknown>),
        blockers: ['GL Date is required.', 'Phase Code is required.'],
      },
    };
    const onPrimaryActionChange = vi.fn();
    renderBar({ onPrimaryActionChange });

    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();
    const last = onPrimaryActionChange.mock.calls.at(-1)?.[0] as { run: () => void };
    act(() => { last.run(); });
    expect(M.approveMutate).not.toHaveBeenCalled();

    // Each blocker is its OWN list item — never concatenated into one run-on string.
    expect(screen.getByText('Cannot approve:')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'GL Date is required.',
      'Phase Code is required.',
    ]);
    expect(screen.queryByText('GL Date is required. Phase Code is required.')).not.toBeInTheDocument();
  });

  it('shows closed-period recovery from structured preview metadata and preserves other blockers', async () => {
    const user = userEvent.setup();
    const ready = M.makeReadyVerdict();
    M.approvalResult = {
      ...ready,
      data: {
        ...(ready.data as Record<string, unknown>),
        blockers: ['A different blocker.'],
        blockerDetails: [{
          code: 'CLOSED_PERIOD_DATE',
          invoiceDateMonth: 'July 2026',
          currentMonth: 'August 2026',
          suggestedInvoiceDate: '2026-08-01',
        }],
      },
    };

    const onPrimaryActionChange = vi.fn();
    renderBar({
      approvalOverrides: { routingCode: 'JS', phaseCode: '15400', costType: 'E', glAccount: '5500' },
      onPrimaryActionChange,
    });

    expect(screen.getByText('Invoice date falls in July 2026 — a closed period. Only August 2026 is open.')).toBeInTheDocument();
    expect(within(screen.getByTestId('invoice-resolve-tray')).getByRole('button', { name: 'Use 2026-08-01' })).toBeEnabled();
    expect(within(screen.getByTestId('approval-footer')).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('resolve-tray-count')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Use 2026-08-01' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();

    const action = onPrimaryActionChange.mock.calls.at(-1)?.[0] as { run: () => void };
    act(() => { action.run(); });
    expect(screen.getByText('A different blocker.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next issue' }));
    await user.click(screen.getByRole('button', { name: 'Use 2026-08-01' }));
    expect(M.updateMutate).toHaveBeenCalledWith(
      { id: 'test-id', payload: { invoiceDate: '2026-08-01' } },
      expect.any(Object),
    );
    expect(M.approveMutate).not.toHaveBeenCalled();
  });

  it('does not show recovery when approval is pending, failed, or has a non-W7 detail', () => {
    const ready = M.makeReadyVerdict();
    const w7Ready = {
      ...ready,
      data: {
        ...(ready.data as Record<string, unknown>),
        blockerDetails: [{ code: 'CLOSED_PERIOD_DATE', invoiceDateMonth: 'July 2026', currentMonth: 'August 2026', suggestedInvoiceDate: '2026-08-01' }],
      },
    };
    M.approvalResult = {
      ...ready,
      data: {
        ...(ready.data as Record<string, unknown>),
        blockerDetails: [{ code: 'OTHER_BLOCKER', invoiceDateMonth: 'July 2026', currentMonth: 'August 2026', suggestedInvoiceDate: '2026-08-01' }],
      },
    };
    const { rerender } = renderBar();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    M.approvalResult = { ...ready, data: undefined, isError: true };
    rerender(React.createElement(InvoiceActionBar, makeBarProps()));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    M.approvalResult = { ...w7Ready, isFetching: true };
    rerender(React.createElement(InvoiceActionBar, makeBarProps()));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides error-derived recovery when current validation becomes pending or failed', async () => {
    const user = userEvent.setup();
    const ready = M.makeReadyVerdict();
    const closedPeriodError = {
      message: 'Closed period',
      status: 422,
      code: 'CLOSED_PERIOD_DATE',
      invoiceDateMonth: 'July 2026',
      currentMonth: 'August 2026',
      suggestedInvoiceDate: '2026-08-01',
    } as unknown as Error;
    M.approveMutate.mockImplementationOnce((
      _variables: unknown,
      options: { onError?: (err: Error) => void },
    ) => options.onError?.(closedPeriodError));
    const { rerender } = renderBar();

    await user.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    M.approvalResult = { ...ready, isFetching: true };
    rerender(React.createElement(InvoiceActionBar, makeBarProps()));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    M.approvalResult = { data: undefined, isLoading: false, isError: true, isFetching: false };
    rerender(React.createElement(InvoiceActionBar, makeBarProps()));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('saves a rejected closed-period date without queuing or inferring approval', async () => {
    const user = userEvent.setup();
    M.approveMutate.mockImplementationOnce((
      _variables: unknown,
      options: { onError?: (err: Error) => void },
    ) => options.onError?.({
      message: 'Closed period',
      status: 422,
      code: 'CLOSED_PERIOD_DATE',
      invoiceDateMonth: 'July 2026',
      currentMonth: 'August 2026',
      suggestedInvoiceDate: '2026-08-01',
    } as unknown as Error));
    const triggerSave = vi.fn();
    const onBeforeApprove = vi.fn(async () => undefined);
    const onApproveSuccess = vi.fn();
    const onActionSuccess = vi.fn();
    const initialProps = makeBarProps({
      onBeforeApprove,
      onApproveSuccess,
      onActionSuccess,
    });
    const { rerender } = render(
      React.createElement(InvoiceActionBar, initialProps),
      { wrapper: makeWrapper() },
    );

    await user.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(M.approveMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Use 2026-08-01' })).toBeEnabled();
    expect(within(screen.getByTestId('invoice-resolve-tray')).getByRole('button', { name: 'Use 2026-08-01' })).toBeEnabled();
    expect(within(screen.getByTestId('approval-footer')).queryByRole('alert')).not.toBeInTheDocument();

    rerender(React.createElement(InvoiceActionBar, makeBarProps({
      formRef: makeFormRef(true, triggerSave as InvoiceDetailFormHandle['triggerSave']),
      hasUnsavedChanges: true,
      hasPendingApprovalSave: true,
      onBeforeApprove,
      onApproveSuccess,
      onActionSuccess,
    })));

    await user.click(screen.getByRole('button', { name: 'Use 2026-08-01' }));
    expect(M.updateMutate).toHaveBeenCalledTimes(1);
    expect(M.updateMutate.mock.calls[0][0]).toEqual({
      id: 'test-id',
      payload: { invoiceDate: '2026-08-01' },
    });
    expect(M.approveMutate).toHaveBeenCalledTimes(1);
    expect(triggerSave).not.toHaveBeenCalled();
    expect(onBeforeApprove).not.toHaveBeenCalled();
    expect(onApproveSuccess).not.toHaveBeenCalled();
    expect(onActionSuccess).not.toHaveBeenCalled();
    expect(M.routerPush).not.toHaveBeenCalled();
  });

  it('isolates recovery state when navigating to another invoice', async () => {
    const ready = M.makeReadyVerdict();
    M.approvalResult = {
      ...ready,
      data: {
        ...(ready.data as Record<string, unknown>),
        blockerDetails: [{ code: 'CLOSED_PERIOD_DATE', glDateMonth: 'July 2026', currentMonth: 'August 2026', suggestedGlDate: '2026-08-01' }],
      },
    };
    const invoiceA = { ...makeInvoiceFixture(), id: 'invoice-a' };
    const invoiceB = { ...makeInvoiceFixture(), id: 'invoice-b' };
    const { rerender } = renderBar({ invoiceId: invoiceA.id, invoice: invoiceA });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    M.approvalResult = M.makeReadyVerdict();
    rerender(React.createElement(InvoiceActionBar, makeBarProps({ invoiceId: invoiceB.id, invoice: invoiceB })));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(M.approveMutate).not.toHaveBeenCalled();
  });

  it('keeps attempt evidence ahead of preview in one row, then clears it after the date save', async () => {
    M.approveMutate.mockImplementationOnce((_variables: unknown, options: { onError: (err: Error) => void }) => options.onError({
      message: 'Closed period', status: 422, code: 'CLOSED_PERIOD_DATE',
      invoiceDateMonth: 'June 2026', currentMonth: 'August 2026', suggestedInvoiceDate: '2026-08-01',
    } as unknown as Error));
    const { rerender } = renderBar();
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    const ready = M.makeReadyVerdict();
    M.approvalResult = { ...ready, data: { ...(ready.data as Record<string, unknown>),
      blockerDetails: [{ code: 'CLOSED_PERIOD_DATE', invoiceDateMonth: 'July 2026', currentMonth: 'September 2026', suggestedInvoiceDate: '2026-09-01' }],
    } };
    rerender(React.createElement(InvoiceActionBar, makeBarProps()));
    expect(screen.getByTestId('resolve-tray-count')).toHaveTextContent('1');
    expect(screen.queryByRole('button', { name: 'Use 2026-09-01' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use 2026-08-01' }));
    M.approvalResult = M.makeReadyVerdict();
    act(() => M.updateMutate.mock.calls[0][1].onSuccess());
    rerender(React.createElement(InvoiceActionBar, makeBarProps()));
    expect(screen.queryByTestId('invoice-resolve-tray')).not.toBeInTheDocument();
    expect(M.approveMutate).toHaveBeenCalledTimes(1);
  });

  it.each(['onSuccess', 'onError'] as const)('ignores late recovery %s after A → B → A', async (callback) => {
    const ready = M.makeReadyVerdict();
    M.approvalResult = { ...ready, data: { ...(ready.data as Record<string, unknown>),
      blockerDetails: [{ code: 'CLOSED_PERIOD_DATE', invoiceDateMonth: 'July 2026', currentMonth: 'August 2026', suggestedInvoiceDate: '2026-08-01' }],
    } };
    const a = makeBarProps();
    const b = makeBarProps({ invoiceId: 'B', invoice: { ...makeInvoiceFixture(), id: 'B' } });
    const { rerender } = render(React.createElement(InvoiceActionBar, a), { wrapper: makeWrapper() });
    await userEvent.click(screen.getByRole('button', { name: 'Use 2026-08-01' }));
    const old = M.updateMutate.mock.calls[0][1];
    rerender(React.createElement(InvoiceActionBar, b));
    rerender(React.createElement(InvoiceActionBar, a));
    await userEvent.click(screen.getByRole('button', { name: 'Use 2026-08-01' }));
    act(() => old[callback](new Error('old failure')));
    expect(screen.queryByText('old failure')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use 2026-08-01' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();
    expect(M.updateMutate).toHaveBeenCalledTimes(2);
    expect(M.approveMutate).not.toHaveBeenCalled();
  });

  it('clears failed-attempt recovery after a later successful approval without requiring navigation', async () => {
    M.approveMutate.mockImplementationOnce((_variables: unknown, options: { onError: (err: Error) => void }) => options.onError({
      message: 'Closed period', status: 422, code: 'CLOSED_PERIOD_DATE',
      invoiceDateMonth: 'June 2026', currentMonth: 'August 2026', suggestedInvoiceDate: '2026-08-01',
    } as unknown as Error));
    renderBar({ onActionSuccess: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(screen.getByRole('button', { name: 'Use 2026-08-01' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    act(() => M.approveMutate.mock.calls[1][1].onSuccess({ invoice: makeInvoiceFixture() }));
    expect(screen.queryByTestId('invoice-resolve-tray')).not.toBeInTheDocument();
    expect(M.routerPush).not.toHaveBeenCalled();
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  it('approving with hasEdits=true — PATCH failure blocks approve and shows error', async () => {
    const user = userEvent.setup();
    // triggerSave immediately invokes onError callback
    const triggerSave = vi.fn(
      (_onSuccess?: () => void, onError?: (err: Error) => void) => {
        onError?.(new Error('PATCH failed'));
      },
    );
    renderBar({
      formRef: makeFormRef(true, triggerSave as InvoiceDetailFormHandle['triggerSave']),
      hasUnsavedChanges: true,
    });

    await user.click(screen.getByRole('button', { name: /save & approve/i }));

    expect(triggerSave).toHaveBeenCalled();
    expect(M.approveMutate).not.toHaveBeenCalled();
    // F1d: the REAL server message surfaces instead of being swallowed behind the
    // generic "Failed to save corrections" string.
    expect(screen.getByText(/PATCH failed/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed to save corrections/i)).not.toBeInTheDocument();
  });

  // ── F4 ─────────────────────────────────────────────────────────────────────
  // Spectrum rejects job-coded lines whose distribution GL disagrees with the
  // cost type, so the backend blocks the pair at approve (COST_TYPE_GL_MISMATCH).
  // The client does NOT re-derive that verdict — it surfaces the server's
  // message verbatim through the standard approve error path.
  it('surfaces the backend cost-type/GL mismatch verbatim on approve', async () => {
    const user = userEvent.setup();
    const mismatch = {
      status: 400,
      code: costTypeGlContract.mismatch.code,
      message: costTypeGlContract.mismatch.example.message,
    } as unknown as Error;
    M.approveMutate.mockImplementation(
      (_vars: unknown, options: { onError?: (err: Error) => void }) => {
        options.onError?.(mismatch);
      },
    );
    renderBar({ hasUnsavedChanges: false });

    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(
      screen.getByText(/cost type E requires GL account 5500 in Spectrum/i),
    ).toBeInTheDocument();
    // Not swallowed behind a generic string.
    expect(screen.queryByText(/^Approval failed\.$/)).not.toBeInTheDocument();
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  it('approve button shows "Save & Approve" when hasUnsavedChanges=true', () => {
    renderBar({ hasUnsavedChanges: true });
    expect(
      screen.getByRole('button', { name: /save & approve/i }),
    ).toBeInTheDocument();
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  it('approve button shows "Approve" when hasUnsavedChanges=false', () => {
    renderBar({ hasUnsavedChanges: false });
    expect(
      screen.getByRole('button', { name: /^approve$/i }),
    ).toBeInTheDocument();
  });

  it('registers approve as the primary keyboard action', async () => {
    const onPrimaryActionChange = vi.fn();

    renderBar({ onPrimaryActionChange });

    await waitFor(() => expect(onPrimaryActionChange).toHaveBeenCalled());
    expect(onPrimaryActionChange.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      label: 'Approve',
      disabled: false,
    }));
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  it('document-lane item shows Shelve button', () => {
    renderBar({ classification: 'lien-waiver' });

    expect(
      screen.getByRole('button', { name: /shelve/i }),
    ).toBeInTheDocument();
  });

  it.each(['pay-application', 'purchase-order', 'credit-memo'])(
    '%s uses the invoice workflow action surface',
    (classification) => {
      renderBar({ classification });

      expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /file to documents/i })).not.toBeInTheDocument();
    },
  );

  // ── Test 7 ─────────────────────────────────────────────────────────────────
  it('discard button is visible in the action bar', () => {
    renderBar({ classification: 'invoice' });
    expect(
      screen.getByRole('button', { name: /^discard$/i }),
    ).toBeInTheDocument();
  });

  it('uses discard-specific navigation after a successful discard', async () => {
    const user = userEvent.setup();
    const onActionSuccess = vi.fn();
    const onDiscardNav = vi.fn();
    M.discardMutate.mockImplementationOnce((
      _variables: unknown,
      callbacks: { onSuccess: (data: object) => void },
    ) => callbacks.onSuccess({}));

    renderBar({ onActionSuccess, onDiscardNav });

    await user.click(screen.getByRole('button', { name: /^discard$/i }));
    await user.click(screen.getByRole('button', { name: /confirm discard/i }));

    expect(onDiscardNav).toHaveBeenCalledTimes(1);
    expect(onActionSuccess).not.toHaveBeenCalled();
  });

  it('orders invoice footer actions as discard, skip, undo, and approve', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    const onUndo = vi.fn();
    renderBar({
      onSkip,
      undoControl: {
        disabled: false,
        pending: false,
        tooltip: 'Undo: Discard',
        onUndo,
      },
    });

    const labels = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(labels).toEqual(['Discard', 'Skip', 'Undo', 'Approve']);

    await user.click(screen.getByRole('button', { name: /^undo$/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('orders approved invoice footer actions as discard, skip, undo approve, and submit to Spectrum', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    const approveUndo = vi.fn();
    const submitToSpectrum = vi.fn();

    renderBar({
      invoiceStatus: 'approved',
      onSkip,
      undoControl: {
        label: 'Undo Approve',
        disabled: false,
        pending: false,
        tooltip: 'Revert to pending.',
        onUndo: approveUndo,
      },
      spectrumSubmitControl: {
        label: 'Submit to Spectrum',
        pending: false,
        disabled: false,
        onSubmit: submitToSpectrum,
      },
    });

    const labels = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(labels).toEqual(['Discard', 'Skip', 'Undo Approve', 'Submit to Spectrum']);
    expect(screen.queryByRole('button', { name: /^undo$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo Approve' }));
    expect(approveUndo).toHaveBeenCalledTimes(1);
    expect(M.unapproveMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Submit to Spectrum' }));
    expect(submitToSpectrum).toHaveBeenCalledTimes(1);
  });

  it('does not show unrelated generic undo on approved invoices', () => {
    renderBar({
      invoiceStatus: 'approved',
      undoControl: {
        disabled: false,
        pending: false,
        tooltip: 'Undo: Discard',
        onUndo: vi.fn(),
      },
    });

    expect(screen.queryByRole('button', { name: /^undo$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo Approve' })).not.toBeInTheDocument();
  });

  // ── Test 8 ─────────────────────────────────────────────────────────────────
  it('action buttons disabled while any mutation isPending', () => {
    M.isApproving = true;
    renderBar({ classification: 'invoice' });

    expect(
      screen.getByRole('button', { name: /approv/i }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /^discard$/i })).toBeDisabled();
  });

  // ── Legacy test kept for coverage while component no longer has reject ─────
  it('does not render reject action in current design', async () => {
    const user = userEvent.setup();
    renderBar();
    expect(
      screen.queryByRole('button', { name: /^reject$/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^approve$/i }));
  });
});

// ── B3 duplicate workflow (spec §6, §7) ─────────────────────────────────────
describe('InvoiceActionBar — duplicate flag', () => {
  it('shows the distinct duplicate copy for a served DUPLICATE_UNRESOLVED blocker', () => {
    const ready = M.makeReadyVerdict();
    M.approvalResult = {
      ...ready,
      data: {
        ...(ready.data as Record<string, unknown>),
        blockers: ['Cannot approve: unresolved duplicate flag — flagged as a duplicate of orig-1.'],
        blockerDetails: [{ code: 'DUPLICATE_UNRESOLVED' }],
      },
    };
    const onPrimaryActionChange = vi.fn();
    renderBar({ onPrimaryActionChange });

    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();
    const last = onPrimaryActionChange.mock.calls.at(-1)?.[0] as { run: () => void };
    act(() => { last.run(); });
    expect(M.approveMutate).not.toHaveBeenCalled();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Resolve the duplicate flag first.']);
  });

  it('shows the distinct duplicate copy when single approve is refused with DUPLICATE_UNRESOLVED', async () => {
    M.approveMutate.mockImplementation((_vars: unknown, options?: { onError?: (err: unknown) => void }) => {
      options?.onError?.({ status: 400, code: 'DUPLICATE_UNRESOLVED', message: 'Cannot approve: unresolved duplicate flag.' });
    });
    renderBar();

    await userEvent.setup().click(screen.getByRole('button', { name: /^approve$/i }));

    expect(await screen.findByText('Resolve the duplicate flag first.')).toBeInTheDocument();
    expect(screen.queryByText('Cannot approve: unresolved duplicate flag.')).not.toBeInTheDocument();
  });

  // Cmd-⌫ (page discardShortcutAction) clicks this [data-invoice-discard] button,
  // so the flagged context must ride on the action bar's own discard call.
  it.each([
    [true, { id: 'test-id', duplicateContext: true }],
    [false, { id: 'test-id' }],
  ] as const)('shortcut discard with duplicateFlagged=%s sends %o', async (duplicateFlagged, expected) => {
    renderBar({ duplicateFlagged });
    const button = document.querySelector<HTMLButtonElement>('[data-invoice-discard]');
    expect(button).not.toBeNull();

    act(() => { button?.click(); });
    act(() => { button?.click(); });

    expect(M.discardMutate).toHaveBeenCalledTimes(1);
    expect(M.discardMutate).toHaveBeenCalledWith(expected, expect.any(Object));
  });
});
