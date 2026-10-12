import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, isApiError } from '@/modules/shared/lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockResponse(status: number, body?: unknown, jsonFails = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Status Text',
    json: jsonFails
      ? () => Promise.reject(new SyntaxError('Unexpected token'))
      : () => Promise.resolve(body),
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── buildUrl (via api.get) ───────────────────────────────────────────────────

describe('buildUrl param handling', () => {
  it('skips undefined values in query string', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(200, {}));
    await api.get('/api/test', { a: 'hello', b: undefined });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('a=hello');
    expect(url).not.toContain('b=');
  });

  it('includes defined param values in query string', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(200, {}));
    await api.get('/api/test', { page: 2, limit: 10 });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('page=2');
    expect(url).toContain('limit=10');
  });
});

// ─── handleResponse ───────────────────────────────────────────────────────────

describe('handleResponse', () => {
  it('returns parsed JSON for a 200 response', async () => {
    const data = { id: '123', name: 'Acme Corp' };
    mockFetch.mockResolvedValue(makeMockResponse(200, data));
    const result = await api.get('/api/test');
    expect(result).toEqual(data);
  });

  it('returns undefined for a 204 No Content response', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(204));
    const result = await api.get('/api/test');
    expect(result).toBeUndefined();
  });

  it('throws ApiError with status 400 and parsed message body', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(400, { message: 'Bad request' }));
    await expect(api.get('/api/test')).rejects.toMatchObject({
      status: 400,
      message: 'Bad request',
    });
  });

  it('preserves structured backend error fields', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(409, {
      error: 'State changed',
      code: 'STATE_CHANGED_SINCE_ACTION',
      actionId: 'action-1',
      staleFields: ['filed_at'],
    }));

    await expect(api.post('/api/test')).rejects.toMatchObject({
      status: 409,
      message: 'State changed',
      code: 'STATE_CHANGED_SINCE_ACTION',
      actionId: 'action-1',
      staleFields: ['filed_at'],
    });
  });

  it('keeps top-level code and canonical details metadata available to callers', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(409, {
      error: 'State changed',
      code: 'STATE_CHANGED_SINCE_ACTION',
      details: {
        actionId: 'action-1',
        staleFields: ['filed_at'],
      },
    }));

    await expect(api.post('/api/test')).rejects.toMatchObject({
      status: 409,
      message: 'State changed',
      code: 'STATE_CHANGED_SINCE_ACTION',
      actionId: 'action-1',
      staleFields: ['filed_at'],
      details: { actionId: 'action-1', staleFields: ['filed_at'] },
    });
  });

  it('preserves canonical closed-period recovery fields from an approve rejection', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(422, {
      error: 'The invoice date is in a closed period.',
      code: 'CLOSED_PERIOD_DATE',
      invoiceDateMonth: 'July 2026',
      currentMonth: 'August 2026',
      suggestedInvoiceDate: '2026-08-01',
      nextAction: 'Use the open period date.',
    }));

    await expect(api.post('/api/invoices/inv-1/approve', {})).rejects.toMatchObject({
      status: 422,
      message: 'The invoice date is in a closed period.',
      code: 'CLOSED_PERIOD_DATE',
      invoiceDateMonth: 'July 2026',
      currentMonth: 'August 2026',
      suggestedInvoiceDate: '2026-08-01',
      nextAction: 'Use the open period date.',
    });
  });

  it('falls back to legacy W7 fields only when the canonical names are absent', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(422, {
      error: 'The invoice date is in a closed period.',
      code: 'CLOSED_PERIOD_DATE',
      glDateMonth: 'July 2026',
      currentMonth: 'August 2026',
      suggestedGlDate: '2026-08-01',
    }));

    await expect(api.post('/api/invoices/inv-1/approve', {})).rejects.toMatchObject({
      invoiceDateMonth: 'July 2026',
      suggestedInvoiceDate: '2026-08-01',
      glDateMonth: 'July 2026',
      suggestedGlDate: '2026-08-01',
    });
  });

  it('prefers canonical W7 fields when the backend dual-emits both names', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(422, {
      error: 'The invoice date is in a closed period.',
      code: 'CLOSED_PERIOD_DATE',
      invoiceDateMonth: 'July 2026',
      suggestedInvoiceDate: '2026-08-01',
      glDateMonth: 'June 2026',
      suggestedGlDate: '2026-07-01',
    }));

    await expect(api.post('/api/invoices/inv-1/approve', {})).rejects.toMatchObject({
      invoiceDateMonth: 'July 2026',
      suggestedInvoiceDate: '2026-08-01',
      glDateMonth: 'June 2026',
      suggestedGlDate: '2026-07-01',
    });
  });

  // ── F1b: capture lockedFields (was the only 409 body field dropped) ────────
  it('captures lockedFields from a financial-lock 409 (top-level)', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(409, {
      message: 'Invoice is financially locked.',
      code: 'SUBMITTED_FINANCIAL_LOCKED',
      lockedFields: ['invoiceNumber', 'amount'],
    }));

    await expect(api.patch('/api/invoices/inv-1', {})).rejects.toMatchObject({
      status: 409,
      code: 'SUBMITTED_FINANCIAL_LOCKED',
      lockedFields: ['invoiceNumber', 'amount'],
    });
  });

  it('captures lockedFields nested under details', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(409, {
      message: 'Invoice is financially locked.',
      code: 'SUBMITTED_FINANCIAL_LOCKED',
      details: { lockedFields: ['amount'] },
    }));

    await expect(api.patch('/api/invoices/inv-1', {})).rejects.toMatchObject({
      status: 409,
      lockedFields: ['amount'],
    });
  });

  it('throws ApiError with status 500 when response body is not JSON', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(500, undefined, true));
    await expect(api.get('/api/test')).rejects.toMatchObject({ status: 500 });
  });
});

describe('multipart requests', () => {
  it('posts FormData without setting a content type boundary manually', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(200, { success: true }));
    const body = new FormData();
    body.append('file', new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' }));

    await api.postForm('/api/invoices/doc-1/attach-file', body);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/backend/invoices/doc-1/attach-file',
      expect.objectContaining({ method: 'POST', body }),
    );
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    expect(options.headers).not.toHaveProperty('Content-Type');
  });
});

// ─── isApiError ───────────────────────────────────────────────────────────────

describe('isApiError', () => {
  it('returns true for an object with message and status', () => {
    expect(isApiError({ message: 'x', status: 400 })).toBe(true);
  });

  it('returns false for a plain Error and for null', () => {
    expect(isApiError(new Error('oops'))).toBe(false);
    expect(isApiError(null)).toBe(false);
  });
});
