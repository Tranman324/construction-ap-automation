/**
 * ignore-rules.test.tsx
 * Tests for IgnoreRulesPanel — rule list display, empty state, add-rule form,
 * and inline delete confirmation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { IgnoreRule } from '@/modules/accounting/modules/invoices/types/api';

// ─── Hoisted mutable state ────────────────────────────────────────────────────

const IM = vi.hoisted(() => ({
  ignoreRulesReturn: {
    data: [] as IgnoreRule[],
    isLoading: false,
  },
  addMutate: vi.fn(),
  deleteMutate: vi.fn(),
  addIsPending: false,
  deleteIsPending: false,
  classificationsError: false,
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/modules/accounting/modules/invoices/hooks/queries', () => ({
  useIgnoreRules: () => IM.ignoreRulesReturn,
  useClassifications: () => ({ classifications: [{ name: 'invoice', label: 'Invoice', status: 'active' }], isError: IM.classificationsError, isLoading: false }),

}));

vi.mock('@/modules/accounting/modules/invoices/components/settings/RetentionPoliciesSection', () => ({
  RetentionPoliciesSection: () => null,
}));

vi.mock('@/modules/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    role: 'admin',
    isAdmin: true,
    permissions: ['*'],
  }),
}));

vi.mock('@/modules/accounting/modules/invoices/hooks/mutations', () => ({
  useAddIgnoreRule: () => ({
    mutate: IM.addMutate,
    isPending: IM.addIsPending,
  }),
  useDeleteIgnoreRule: () => ({
    mutate: IM.deleteMutate,
    isPending: IM.deleteIsPending,
  }),

}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { IgnoreRulesPanel } from '@/modules/accounting/modules/invoices/components/settings/IgnoreRulesPanel';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }

  return Wrapper;
}

function renderPanel(open = true, onOpenChange = vi.fn()) {
  return render(
    React.createElement(IgnoreRulesPanel, { open, onOpenChange }),
    { wrapper: makeWrapper() },
  );
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  IM.ignoreRulesReturn = { data: [], isLoading: false };
  IM.addMutate.mockReset();
  IM.deleteMutate.mockReset();
  IM.addIsPending = false;
  IM.deleteIsPending = false;
  IM.classificationsError = false;
});

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('IgnoreRulesPanel', () => {
  // ── Test 1 ─────────────────────────────────────────────────────────────────
  it('renders rule list with type badge and value for each rule', () => {
    IM.ignoreRulesReturn = {
      data: [
        { id: '1', type: 'sender', value: 'test@vendor.example', reason: '' },
        { id: '2', type: 'domain', value: 'vendor.example', reason: 'Spam' },
      ],
      isLoading: false,
    };

    renderPanel();

    expect(screen.getByText('test@vendor.example')).toBeInTheDocument();
    expect(screen.getByText('vendor.example')).toBeInTheDocument();
    // Reason for id 2 appears
    expect(screen.getByText('Spam')).toBeInTheDocument();
    // Type badges
    expect(screen.getByText('sender')).toBeInTheDocument();
    expect(screen.getByText('domain')).toBeInTheDocument();
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  it('shows empty state text when no rules exist', () => {
    IM.ignoreRulesReturn = { data: [], isLoading: false };

    renderPanel();

    expect(screen.getByText(/no ignore rules/i)).toBeInTheDocument();
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  it('submit button disabled when type/value empty; enabled after both filled', async () => {
    const user = userEvent.setup();
    renderPanel();

    // Open the Add Rule form
    await user.click(screen.getByRole('button', { name: /add ignore rule/i }));

    // Submit button present and disabled (no type or value yet)
    const submitBtn = screen.getByRole('button', { name: /^add rule$/i });
    expect(submitBtn).toBeDisabled();

    // Select type: click the combobox trigger
    const typeTrigger = screen.getByRole('combobox');
    await user.click(typeTrigger);

    // Click "Sender" option in the opened listbox
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Sender' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('option', { name: 'Sender' }));

    // Value input now visible — still no value yet
    const valueInput = screen.getByPlaceholderText(/e\.g\. invoices@vendor\.example/i);
    expect(submitBtn).toBeDisabled();

    // Enter a value
    await user.type(valueInput, 'noreply@example.com');
    expect(submitBtn).toBeEnabled();
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  it('calls useAddIgnoreRule with correct payload on submit', async () => {
    const user = userEvent.setup();

    // addMutate calls onSuccess immediately so form resets
    IM.addMutate.mockImplementationOnce(
      (_payload: unknown, opts: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );

    renderPanel();

    await user.click(screen.getByRole('button', { name: /add ignore rule/i }));

    // Select type "Domain"
    const typeTrigger = screen.getByRole('combobox');
    await user.click(typeTrigger);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Domain' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('option', { name: 'Domain' }));

    // Enter value
    const valueInput = screen.getByPlaceholderText(/e\.g\. vendor\.example/i);
    await user.type(valueInput, 'spam.com');

    // Enter reason
    const reasonInput = screen.getByPlaceholderText(/why is this being ignored/i);
    await user.type(reasonInput, 'Unwanted');

    // Submit
    await user.click(screen.getByRole('button', { name: /^add rule$/i }));

    expect(IM.addMutate).toHaveBeenCalledWith(
      { type: 'domain', value: 'spam.com', reason: 'Unwanted' },
      expect.any(Object),
    );
  });

  it('shows an unavailable state instead of local classification labels when the catalog fails', async () => {
    const user = userEvent.setup();
    IM.classificationsError = true;
    renderPanel();

    await user.click(screen.getByRole('button', { name: /add ignore rule/i }));
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Classification' }));

    expect(screen.getByText('Classification options unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Invoice')).not.toBeInTheDocument();
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  it('clicking trash icon shows inline "Remove this rule?" confirmation', async () => {
    const user = userEvent.setup();
    IM.ignoreRulesReturn = {
      data: [{ id: 'rule-abc', type: 'sender', value: 'remove@example.test', reason: '' }],
      isLoading: false,
    };

    renderPanel();

    // Trash button for the rule
    const trashBtn = screen.getByRole('button', {
      name: /delete rule for remove@example\.test/i,
    });
    await user.click(trashBtn);

    expect(screen.getByText(/remove this rule/i)).toBeInTheDocument();
    // Cancel button visible
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    // Confirm button visible
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  it('confirming delete calls useDeleteIgnoreRule with correct id', async () => {
    const user = userEvent.setup();
    IM.ignoreRulesReturn = {
      data: [{ id: 'rule-123', type: 'domain', value: 'spamco.com', reason: '' }],
      isLoading: false,
    };
    IM.deleteMutate.mockImplementationOnce(
      (_payload: unknown, opts: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );

    renderPanel();

    await user.click(
      screen.getByRole('button', { name: /delete rule for spamco\.com/i }),
    );
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    expect(IM.deleteMutate).toHaveBeenCalledWith(
      { id: 'rule-123' },
      expect.any(Object),
    );
  });
});
