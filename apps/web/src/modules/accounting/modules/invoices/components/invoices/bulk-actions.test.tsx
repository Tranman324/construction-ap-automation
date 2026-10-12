/**
 * bulk-actions.test.tsx
 * Tests for BulkActionBar selection display and remaining batch actions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Hoisted mutable state ────────────────────────────────────────────────────

const BM = vi.hoisted(() => ({
  bulkMutate: vi.fn(),
  isPending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/modules/accounting/modules/invoices/hooks/mutations', () => ({
  useBulkAction: () => ({ mutate: BM.bulkMutate, isPending: BM.isPending }),
}));

vi.mock('@/modules/shared/components/ui/toaster', () => ({
  toast: {
    success: BM.toastSuccess,
    error: BM.toastError,
  },
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

// ─── Import after mocks ───────────────────────────────────────────────────────

import { BulkActionBar } from '@/modules/accounting/modules/invoices/components/invoices/BulkActionBar';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }

  return Wrapper;
}

type BarProps = React.ComponentProps<typeof BulkActionBar>;

function renderBar(overrides: Partial<BarProps> = {}) {
  const defaults: BarProps = {
    selectedIds: ['id-1'],
    onClear: vi.fn(),
  };
  return render(
    React.createElement(BulkActionBar, { ...defaults, ...overrides }),
    { wrapper: makeWrapper() },
  );
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  BM.bulkMutate.mockReset();
  BM.toastSuccess.mockReset();
  BM.toastError.mockReset();
  BM.isPending = false;
});

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('BulkActionBar', () => {
  // ── Test 1 ─────────────────────────────────────────────────────────────────
  it('renders nothing when selectedIds is empty', () => {
    const { container } = renderBar({ selectedIds: [] });
    // Component returns null — container should be empty
    expect(container.firstChild).toBeNull();
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  it('shows correct singular count for a single item', () => {
    renderBar({ selectedIds: ['id-1'] });
    expect(screen.getByText('1 invoice selected')).toBeInTheDocument();
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  it('shows correct plural count for multiple items', () => {
    renderBar({ selectedIds: ['id-1', 'id-2', 'id-3'] });
    expect(screen.getByText('3 invoices selected')).toBeInTheDocument();
  });

  it('inline mode exposes the selected-context action set', () => {
    renderBar({
      mode: 'inline-actions',
      showTrash: true,
      submitAction: <button type="button">Submit</button>,
    });

    expect(screen.getByRole('button', { name: /^submit$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^discard$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^trash$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^mark reviewed$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^undo approve$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /shelve/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reject all$/i })).not.toBeInTheDocument();
  });

  it('Discard confirms before calling the bulk discard action', async () => {
    const user = userEvent.setup();
    renderBar({ mode: 'inline-actions', showTrash: true });

    await user.click(screen.getByRole('button', { name: /^discard$/i }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Discard 1 invoice?');
    expect(BM.bulkMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^discard$/i }));

    expect(BM.bulkMutate).toHaveBeenCalledWith(
      { ids: ['id-1'], action: 'discard' },
      expect.any(Object),
    );
  });

  it('Shelve calls the bulk file action', async () => {
    const user = userEvent.setup();
    renderBar({ mode: 'inline-actions' });

    await user.click(screen.getByRole('button', { name: /^shelve$/i }));

    expect(BM.bulkMutate).toHaveBeenCalledWith(
      { ids: ['id-1'], action: 'file' },
      expect.any(Object),
    );
  });

  it('Undo Approve calls the bulk unapprove action', async () => {
    const user = userEvent.setup();
    renderBar({ mode: 'inline-actions' });

    await user.click(screen.getByRole('button', { name: /^undo approve$/i }));

    expect(BM.bulkMutate).toHaveBeenCalledWith(
      { ids: ['id-1'], action: 'unapprove' },
      expect.any(Object),
    );
  });

  it('shows Sonner feedback after a successful bulk action', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    BM.bulkMutate.mockImplementationOnce(
      (_payload: unknown, options?: { onSuccess?: (data: { updated: number }) => void }) => {
        options?.onSuccess?.({ updated: 2 });
      },
    );

    renderBar({ selectedIds: ['id-1', 'id-2'], onClear });

    await user.click(screen.getByRole('button', { name: /^shelve$/i }));

    expect(BM.toastSuccess).toHaveBeenCalledWith(
      'Invoices shelved',
      expect.objectContaining({ description: '2 invoices updated.' }),
    );
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('shows the distinct duplicate copy when a bulk action fails with DUPLICATE_UNRESOLVED', async () => {
    const user = userEvent.setup();
    BM.bulkMutate.mockImplementationOnce(
      (_payload: unknown, options?: { onError?: (err: Error) => void }) => {
        options?.onError?.(Object.assign(new Error('Cannot approve: unresolved duplicate flag.'), { code: 'DUPLICATE_UNRESOLVED' }));
      },
    );
    renderBar({ mode: 'inline-actions' });

    await user.click(screen.getByRole('button', { name: /^shelve$/i }));

    expect(screen.getByText('Resolve the duplicate flag first.')).toBeInTheDocument();
    expect(BM.toastError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ description: 'Resolve the duplicate flag first.' }),
    );
  });

  it('reports DUPLICATE_UNRESOLVED skips instead of a clean success', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    BM.bulkMutate.mockImplementationOnce(
      (_payload: unknown, options?: { onSuccess?: (data: unknown) => void }) => {
        options?.onSuccess?.({
          updated: 1,
          skipped: 1,
          skippedInvoices: [{ id: 'id-2', invoiceNumber: 'INV-2', code: 'DUPLICATE_UNRESOLVED', error: 'dup' }],
        });
      },
    );
    renderBar({ selectedIds: ['id-1', 'id-2'], onClear, mode: 'inline-actions' });

    await user.click(screen.getByRole('button', { name: /^shelve$/i }));

    expect(screen.getByText('Resolve the duplicate flag first. 1 invoice skipped.')).toBeInTheDocument();
    expect(BM.toastSuccess).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('Clear button calls onClear prop', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderBar({ onClear });

    await user.click(screen.getByRole('button', { name: /clear selection/i }));

    expect(onClear).toHaveBeenCalledOnce();
  });
});
