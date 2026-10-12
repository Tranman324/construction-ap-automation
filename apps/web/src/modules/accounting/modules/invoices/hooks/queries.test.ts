import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ─── Mock api ─────────────────────────────────────────────────────────────────

vi.mock('@/modules/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  isApiError: (error: unknown) => (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'message' in error
  ),
}));

// Import after mock declaration so the mock is in place
import { api } from '@/modules/shared/lib/api';
import {
  DEFAULT_CLASSIFICATION_ASSOCIATIONS,
  DEFAULT_MAPPINGS,
  useInvoices,
  useStats,
  useTrash,
  useInvoice,
  useInvoiceNeighbors,
  useVendorSearch,
  useSubcontracts,
  useClassifications,
  useInvoiceActions,
  useInvoiceOrphanWaivers,
  useLienWaiverOrphanInvoices,
  useWaiverRecipient,
  useGlAccounts,
  useGlAccountByCode,
  usePhaseCodes,
  usePhaseOptions,
  useJobFolders,
  useActivity,
  useForwardDefaults,
} from '@/modules/accounting/modules/invoices/hooks/queries';
import { collaborationQueryKey } from '@/modules/accounting/modules/invoices/hooks/collaborationRoutes';

// ─── Wrapper factory ──────────────────────────────────────────────────────────

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  return Wrapper;
}

function makeRetryingWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 3, retryDelay: 1 } },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  return Wrapper;
}

function makeInspectableWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  return { queryClient, Wrapper };
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.useRealTimers();
});

describe('collaboration route-family queries', () => {
  it.each([
    ['invoice', '/api/invoices'],
    ['document', '/api/documents'],
  ] as const)('uses the %s activity endpoint and cache family', async (routeFamily, apiBase) => {
    const response = { entries: [], pagination: { limit: 50, offset: 0, hasMore: false } };
    vi.mocked(api.get).mockResolvedValue(response);
    const { queryClient, Wrapper } = makeInspectableWrapper();

    const { result } = renderHook(() => useActivity('doc-1', { routeFamily }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(`${apiBase}/doc-1/activity`, { limit: 50, offset: 0 });
    expect(queryClient.getQueryData(collaborationQueryKey(routeFamily, 'doc-1', 0))).toEqual(response);
    expect(queryClient.getQueryData(collaborationQueryKey(routeFamily === 'invoice' ? 'document' : 'invoice', 'doc-1', 0))).toBeUndefined();
  });

  it.each([
    ['invoice', '/api/invoices'],
    ['document', '/api/documents'],
  ] as const)('uses the %s forward-defaults endpoint and cache family', async (routeFamily, apiBase) => {
    const response = { defaultRecipients: [] };
    vi.mocked(api.get).mockResolvedValue(response);
    const { queryClient, Wrapper } = makeInspectableWrapper();

    const { result } = renderHook(() => useForwardDefaults('doc-1', { routeFamily }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(`${apiBase}/doc-1/forward-defaults`);
    expect(queryClient.getQueryData(['forward-defaults', routeFamily, 'doc-1'])).toEqual(response);
    expect(queryClient.getQueryData(['forward-defaults', routeFamily === 'invoice' ? 'document' : 'invoice', 'doc-1'])).toBeUndefined();
  });
});

describe('useJobFolders freshness', () => {
  it('refetches a six-minute-old folder resolution on mount', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['jobFolders', '26-SVC412'], { jobFolder: 'old', folders: [] }, { updatedAt: Date.now() - 6 * 60_000 });
    vi.mocked(api.get).mockResolvedValue({ jobFolder: 'current', folders: [] });
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useJobFolders('26-SVC412'), { wrapper });
    await waitFor(() => expect(result.current.data?.jobFolder).toBe('current'));
    expect(api.get).toHaveBeenCalledWith('/api/jobs/26-SVC412/folders');
  });

  it('does not turn resolution failures into fresh fallback data or retry them', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Folder lookup failed'));
    const { result } = renderHook(() => useJobFolders('26-SVC412'), { wrapper: makeRetryingWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.dataUpdatedAt).toBe(0);
    expect(result.current.isStale).toBe(true);
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

describe('useWaiverRecipient', () => {
  it('loads recipient resolution only when explicitly requested', async () => {
    const resolution = {
      recipientType: 'parsed',
      directEmail: null,
      candidates: [{ email: 'ap@vendor.test', source: 'body' }],
      cachedVendorEmail: null,
      emailFrom: 'quickbooks@notification.intuit.com',
      reason: 'Billing platform (QuickBooks)',
      directoryContacts: [],
    };
    vi.mocked(api.get).mockResolvedValue(resolution);

    const { result } = renderHook(() => useWaiverRecipient('invoice-1'), { wrapper: makeWrapper() });
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();

    let refetched: Awaited<ReturnType<typeof result.current.refetch>> | undefined;
    await act(async () => { refetched = await result.current.refetch(); });
    expect(refetched?.data).toEqual(resolution);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/invoices/invoice-1/waiver-recipient');
  });
});

describe('scoped manual waiver pairing queries', () => {
  it('uses the invoice-scoped orphan-waiver endpoint with only server-defined params', async () => {
    vi.mocked(api.get).mockResolvedValue({ target: {}, paired: null, waivers: [], total: 0, page: 1, limit: 10 });
    const { result } = renderHook(() => useInvoiceOrphanWaivers('invoice-1', { page: 2, q: 'Acme' }), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/invoices/invoice-1/orphan-waivers', { page: 2, q: 'Acme' });
  });

  it('uses the lien-waiver-scoped orphan-invoice endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ target: {}, paired: null, invoices: [], total: 0, page: 1, limit: 10 });
    const { result } = renderHook(() => useLienWaiverOrphanInvoices('waiver-1'), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/lien-waivers/waiver-1/orphan-invoices', {});
  });
});

// ─── useStats ─────────────────────────────────────────────────────────────────

describe('useInvoices', () => {
  it('sends the flagged=true param to the list endpoint when the Flagged pill is active', async () => {
    vi.mocked(api.get).mockResolvedValue({ invoices: [], total: 0, page: 1, limit: 25, pages: 0 });

    const { result } = renderHook(
      () => useInvoices({ status: undefined, flagged: true, panel: 'invoice', filed: false }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/invoices',
      expect.objectContaining({ flagged: true, panel: 'invoice', filed: false }),
    );
  });

  it('does not send a flagged param for an ordinary status view', async () => {
    vi.mocked(api.get).mockResolvedValue({ invoices: [], total: 0, page: 1, limit: 25, pages: 0 });

    const { result } = renderHook(
      () => useInvoices({ status: 'pending', filed: false }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [, params] = vi.mocked(api.get).mock.calls[0] as [string, Record<string, unknown>];
    expect(params.flagged).toBeUndefined();
  });
});

describe('useStats', () => {
  it('returns data from api.get', async () => {
    const stats = {
      total: 5, pending: 2, approved: 1, modified: 0,
      rejected: 1, discarded: 0, submitted: 1,
    };
    vi.mocked(api.get).mockResolvedValue(stats);

    const { result } = renderHook(() => useStats({ filed: false, panel: 'coi' }), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(stats));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/invoices/stats', { filed: false, panel: 'coi' });
  });
});

describe('useTrash', () => {
  it('sends panel scope to the trash endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ invoices: [], total: 0, limit: 25, offset: 0 });

    const { result } = renderHook(
      () => useTrash({ limit: 25, offset: 0, panel: 'other' }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/invoices/trash', {
      limit: 25,
      offset: 0,
      panel: 'other',
    });
  });
});

// ─── useInvoice ───────────────────────────────────────────────────────────────

describe('useInvoice', () => {
  it('is disabled and does not call api.get when id is empty string', () => {
    renderHook(() => useInvoice(''), { wrapper: makeWrapper() });
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('is enabled and calls api.get with path containing the id', async () => {
    vi.mocked(api.get).mockResolvedValue({ id: 'abc' });

    const { result } = renderHook(() => useInvoice('abc'), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('abc'),
      undefined,
    );
    expect(result.current.dataUpdatedAt).toBeGreaterThan(0);
  });

  it('requests deleted records only when explicitly asked', async () => {
    vi.mocked(api.get).mockResolvedValue({ id: 'deleted' });

    const { result } = renderHook(() => useInvoice('deleted', { includeDeleted: true }), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/invoices/deleted', { includeDeleted: true });
  });

  it('keeps the active-record cache key separate from the deleted variant', async () => {
    vi.mocked(api.get).mockResolvedValue({ id: 'same-id' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);

    const active = renderHook(() => useInvoice('same-id'), { wrapper });
    const deleted = renderHook(() => useInvoice('same-id', { includeDeleted: true }), { wrapper });
    await waitFor(() => expect(active.result.current.isSuccess && deleted.result.current.isSuccess).toBe(true));

    expect(client.getQueryData(['invoice', 'same-id'])).toEqual({ id: 'same-id' });
    expect(client.getQueryData(['invoice', 'same-id', 'includeDeleted'])).toEqual({ id: 'same-id' });
  });
});

// ─── useInvoiceActions ───────────────────────────────────────────────────────

describe('useInvoiceNeighbors', () => {
  it('requests keyset neighbors with the queue filters and drops pagination', async () => {
    vi.mocked(api.get).mockResolvedValue({ prev: 'doc-0', next: 'doc-2' });

    const { result } = renderHook(
      () => useInvoiceNeighbors('doc-1', {
        status: 'pending',
        search: 'acme',
        panel: 'invoice',
        classification: 'invoice',
        filed: false,
        flagged: true,
        splitFrom: 'doc-parent',
        sort: 'vendor',
        sortDir: 'asc',
        // Pagination must NOT be forwarded — the neighbors schema 400s on it.
        limit: 500,
        page: 3,
      }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.data).toEqual({ prev: 'doc-0', next: 'doc-2' }));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/invoices/doc-1/neighbors', {
      status: 'pending',
      search: 'acme',
      classification: 'invoice',
      panel: 'invoice',
      filed: false,
      flagged: true,
      splitFrom: 'doc-parent',
      sort: 'vendor',
      sortDir: 'asc',
    });
    const [, params] = vi.mocked(api.get).mock.calls[0] as [string, Record<string, unknown>];
    expect(params).not.toHaveProperty('limit');
    expect(params).not.toHaveProperty('page');
  });

  it('does not request neighbors when disabled', () => {
    renderHook(() => useInvoiceNeighbors('doc-1', {}, { enabled: false }), { wrapper: makeWrapper() });
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('does not request neighbors without an id', () => {
    renderHook(() => useInvoiceNeighbors('', {}), { wrapper: makeWrapper() });
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});

describe('useInvoiceActions', () => {
  it('is disabled and does not call api.get when id is empty string', () => {
    renderHook(() => useInvoiceActions(''), { wrapper: makeWrapper() });
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('loads invoice actions from the backend contract endpoint', async () => {
    const response = { actions: [] };
    vi.mocked(api.get).mockResolvedValue(response);

    const { result } = renderHook(() => useInvoiceActions('doc-1'), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/invoices/doc-1/actions');
  });

  it('does not retry noisy 404 action-history responses', async () => {
    vi.mocked(api.get).mockRejectedValue({ message: 'Not found', status: 404 });

    const { result } = renderHook(() => useInvoiceActions('missing-doc'), {
      wrapper: makeRetryingWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
  });
});

// ─── useVendorSearch ──────────────────────────────────────────────────────────

describe('useVendorSearch', () => {
  it('calls vendors endpoint with search undefined when term is empty', async () => {
    vi.mocked(api.get).mockResolvedValue([]);

    renderHook(() => useVendorSearch(''), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/vendors', {
        search: undefined,
        limit: 100,
      });
    });
  });

  it('debounce: initial empty search call happens, then updates after 300ms', async () => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockResolvedValue([]);

    const { rerender } = renderHook(
      ({ term }: { term: string }) => useVendorSearch(term),
      { initialProps: { term: '' }, wrapper: makeWrapper() },
    );

    // Change term to trigger debounce
    rerender({ term: 'west' });

    // Initial render for empty term performs one vendors request
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(1, '/api/vendors', {
      search: undefined,
      limit: 100,
    });

    // 299ms: timer has not fired, debouncedTerm still '', no second call yet
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);

    // +1ms (300ms total): timer fires, debouncedTerm → 'west', query enabled
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(2, '/api/vendors', {
      search: 'west',
      limit: 100,
    });

    vi.useRealTimers();
  });
});

// ─── Catalog dropdown pagination (GL search + phase full page) ────────────────

describe('usePhaseCodes', () => {
  it('requests the full phase catalog in one page (limit=200)', async () => {
    vi.mocked(api.get).mockResolvedValue({ phase_codes: [], cost_types: [] });
    renderHook(() => usePhaseCodes(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/phase-codes', { limit: 200 });
    });
  });
});

describe('usePhaseOptions (allocation panel — must stay per-subcontract, not the catalog)', () => {
  it('requests the invoice-scoped phase-options endpoint with NO catalog limit', async () => {
    vi.mocked(api.get).mockResolvedValue({ phase_codes: [] });
    renderHook(() => usePhaseOptions('inv-1'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/invoices/inv-1/phase-options');
    });
  });

  // ── Rekey on subcontract/job change (QA 4.15) ──────────────────────────────
  // A subcontract (or job) correction keeps the SAME invoice id, so the old
  // single-key hook served the previous subcontract's cached phases for up to
  // the 5-minute staleTime. Keying on the invoice row's subcontract + job makes
  // the change a cache miss → automatic refetch.
  it('refetches when the invoice subcontract changes on the same invoice id', async () => {
    vi.mocked(api.get).mockResolvedValue({ phase_codes: [] });
    const { rerender } = renderHook(
      ({ sub }: { sub: string }) => usePhaseOptions('inv-1', true, sub, '31-130'),
      { initialProps: { sub: '26-416.07' }, wrapper: makeWrapper() },
    );
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1));

    // Corrected 26-416.07 → 26-434.05 (same invoice id): a second fetch is issued.
    rerender({ sub: '26-434.05' });
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(2, '/api/invoices/inv-1/phase-options');
  });

  it('refetches when the invoice job match changes on the same invoice id', async () => {
    vi.mocked(api.get).mockResolvedValue({ phase_codes: [] });
    const { rerender } = renderHook(
      ({ job }: { job: string }) => usePhaseOptions('inv-1', true, '26-416.07', job),
      { initialProps: { job: '31-130' }, wrapper: makeWrapper() },
    );
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1));

    rerender({ job: '26-434' });
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2));
  });

  it('reuses the cache when invoice id, subcontract and job are unchanged (no redundant refetch)', async () => {
    vi.mocked(api.get).mockResolvedValue({ phase_codes: [] });
    const { rerender } = renderHook(
      ({ sub }: { sub: string }) => usePhaseOptions('inv-1', true, sub, '31-130'),
      { initialProps: { sub: '26-416.07' }, wrapper: makeWrapper() },
    );
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1));

    rerender({ sub: '26-416.07' }); // unchanged → staleTime keeps the cached result
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
  });
});

describe('useGlAccounts (server-search typeahead)', () => {
  it('requests the first page with no search when the term is empty (limit=200)', async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    renderHook(() => useGlAccounts(''), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/gl-accounts', {
        search: undefined,
        limit: 200,
      });
    });
  });

  it('debounce: issues ?search=<typed> only after 300ms', async () => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockResolvedValue([]);

    const { rerender } = renderHook(
      ({ term }: { term: string }) => useGlAccounts(term),
      { initialProps: { term: '' }, wrapper: makeWrapper() },
    );

    rerender({ term: '5450' });

    // Initial empty-term request only; the typed term has not fired yet.
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(1, '/api/gl-accounts', { search: undefined, limit: 200 });

    await act(async () => { vi.advanceTimersByTime(299); });
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve(); });
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(2, '/api/gl-accounts', { search: '5450', limit: 200 });

    vi.useRealTimers();
  });

  it('filters out blank codes from the response', async () => {
    vi.mocked(api.get).mockResolvedValue([
      { code: '5450', description: 'Subcontract Job Cost' },
      { code: '   ', description: 'blank' },
    ]);
    const { result } = renderHook(() => useGlAccounts(''), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual([{ code: '5450', description: 'Subcontract Job Cost' }]));
  });
});

describe('useGlAccountByCode (selected-value resolver)', () => {
  it('resolves a GL account by exact code so an off-page selection keeps its label', async () => {
    vi.mocked(api.get).mockResolvedValue([
      { code: '5450', description: 'Subcontract Job Cost' },
      { code: '5451', description: 'Other' },
    ]);
    const { result } = renderHook(() => useGlAccountByCode('5450'), { wrapper: makeWrapper() });
    await waitFor(() =>
      expect(result.current.data).toEqual({ code: '5450', description: 'Subcontract Job Cost' }),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/gl-accounts', { search: '5450', limit: 200 });
  });

  it('is disabled (no request) when no code is selected', () => {
    renderHook(() => useGlAccountByCode(undefined), { wrapper: makeWrapper() });
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});

// ─── useSubcontracts ──────────────────────────────────────────────────────────

describe('useSubcontracts', () => {
  it('is disabled when both vendorCode and jobNumber are undefined', () => {
    renderHook(() => useSubcontracts(undefined, undefined), { wrapper: makeWrapper() });
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('is enabled when vendorCode is provided', async () => {
    vi.mocked(api.get).mockResolvedValue([]);

    const { result } = renderHook(() => useSubcontracts('ZPAL91', undefined), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(api.get)).toHaveBeenCalled();
  });
});

// ─── useClassifications ──────────────────────────────────────────────────────

describe('useClassifications', () => {
  it('loads enriched classifications and available associations from the live endpoint', async () => {
    const classifications = [
      {
        name: 'invoice',
        label: 'Invoice',
        opensAs: 'invoice',
        action: 'extract-match',
        builtIn: true,
        status: 'active',
      },
      {
        name: 'custom-doc',
        label: 'Custom Doc',
        opensAs: 'other',
        action: 'view-only',
        builtIn: false,
        status: 'disabled',
        updatedBy: 'admin@example.com',
      },
    ];
    const availableAssociations = [
      { key: 'invoice', label: 'Invoice', description: 'Invoice workflow' },
      { key: 'other', label: 'Other', description: 'Generic document panel' },
    ];
    vi.mocked(api.get).mockResolvedValue({ classifications, availableAssociations });

    const { result } = renderHook(() => useClassifications(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(classifications));
    expect(result.current.classifications).toEqual(classifications);
    expect(result.current.availableAssociations).toEqual(availableAssociations);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/classifications?include=associations&status=all');
  });

  it('returns deterministic fallback mappings while loading', () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => undefined));

    const { result } = renderHook(() => useClassifications(), { wrapper: makeWrapper() });

    expect(result.current.data).toEqual(DEFAULT_MAPPINGS);
    expect(result.current.availableAssociations).toEqual(DEFAULT_CLASSIFICATION_ASSOCIATIONS);
    expect(result.current.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'coi', label: 'Certificate of Insurance' }),
      expect.objectContaining({ name: 'w9', label: 'W-9 Tax Form' }),
      expect.objectContaining({ name: 'credit-memo', label: 'Credit Memo / Adjustment' }),
      expect.objectContaining({ name: 'other', label: 'Other / Unclassified' }),
    ]));
    expect(result.current.availableAssociations.map((association) => association.label)).toEqual([
      'Invoice Workflow',
      'Receipt Panel',
      'Statement Panel',
      'Certificate of Insurance Panel',
      'W-9 Panel',
      'Lien Waiver Panel',
      'Generic Panel',
    ]);
  });

  it('falls back when the enriched response is empty or invalid', async () => {
    vi.mocked(api.get).mockResolvedValue({
      classifications: [],
      availableAssociations: [{ key: 'invoice', label: 'Invoice', description: 'Invoice workflow' }],
    });

    const { result } = renderHook(() => useClassifications(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(DEFAULT_MAPPINGS);
    expect(result.current.availableAssociations).toEqual(DEFAULT_CLASSIFICATION_ASSOCIATIONS);
  });

  it('preserves query errors while exposing fallback mappings', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('classification API unavailable'));

    const { result } = renderHook(() => useClassifications(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('classification API unavailable');
    expect(result.current.data).toEqual(DEFAULT_MAPPINGS);
  });
});
