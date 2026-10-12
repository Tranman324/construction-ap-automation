// In the browser, route all API calls through Next.js's own server via the
// /api/backend rewrite (next.config.ts). This avoids CORS entirely — the
// browser calls same-origin localhost:3000, and Next.js proxies server-side.
// On the server (SSR / route handlers) hit the backend directly.
const BASE_URL =
  typeof window === "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3456")
    : ""; // relative — rewrite handles it

// Translate /api/foo → /api/backend/foo when using the proxy path
function proxyPath(path: string): string {
  if (typeof window === "undefined") return path; // server: use path as-is
  return path.replace(/^\/api\//, "/api/backend/");
}

// ─── Structured API Error ─────────────────────────────────────────────────────

export interface ApiError {
  message: string;
  status: number;
  code?: string;
  details?: unknown;
  actionId?: string;
  missing?: string[];
  path?: string;
  staleFields?: string[];
  lockedFields?: string[];
  undoWindowSeconds?: number;
  expiresAt?: string;
  invoiceDateMonth?: string;
  suggestedInvoiceDate?: string;
  glDateMonth?: string;
  currentMonth?: string;
  suggestedGlDate?: string;
  nextAction?: string;
}

function isApiError(e: unknown): e is ApiError {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    "message" in e
  );
}

export { isApiError };

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Params = Record<string, string | number | boolean | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildUrl(path: string, params?: Params): string {
  // In the browser BASE_URL is "" so use current origin for URL construction,
  // then return just the pathname+search (keeps it relative / same-origin).
  const base =
    BASE_URL !== ""
      ? BASE_URL
      : typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost:3000";
  const url = new URL(path, base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  // Return relative URL when proxying through Next.js (BASE_URL is "")
  return BASE_URL !== "" ? url.toString() : `${url.pathname}${url.search}`;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    // 204 No Content
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // Rate limited — provide a clear message
  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    const error: ApiError = {
      message: retryAfter
        ? `Rate limited. Try again in ${retryAfter} seconds.`
        : "Too many requests. Please wait a moment and try again.",
      status: 429,
    };
    throw error;
  }

  let message: string;
  let code: string | undefined;
  let details: unknown;
  let actionId: string | undefined;
  let missing: string[] | undefined;
  let path: string | undefined;
  let staleFields: string[] | undefined;
  let lockedFields: string[] | undefined;
  let undoWindowSeconds: number | undefined;
  let expiresAt: string | undefined;
  let invoiceDateMonth: string | undefined;
  let suggestedInvoiceDate: string | undefined;
  let glDateMonth: string | undefined;
  let currentMonth: string | undefined;
  let suggestedGlDate: string | undefined;
  let nextAction: string | undefined;
  try {
    const body = await res.json() as unknown;
    if (isRecord(body)) {
      message = typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : res.statusText;
      code = typeof body.code === "string" ? body.code : undefined;
      details = body.details;
      const detailRecord = isRecord(details) ? details : {};
      const field = (key: string): unknown => body[key] ?? detailRecord[key];
      const actionIdValue = field("actionId");
      const missingValue = field("missing");
      const pathValue = field("path");
      const staleFieldsValue = field("staleFields");
      const lockedFieldsValue = field("lockedFields");
      const undoWindowSecondsValue = field("undoWindowSeconds");
      const expiresAtValue = field("expiresAt");
      const invoiceDateMonthValue = field("invoiceDateMonth");
      const suggestedInvoiceDateValue = field("suggestedInvoiceDate");
      const glDateMonthValue = field("glDateMonth");
      const currentMonthValue = field("currentMonth");
      const suggestedGlDateValue = field("suggestedGlDate");
      const nextActionValue = field("nextAction");
      actionId = typeof actionIdValue === "string" ? actionIdValue : undefined;
      missing = Array.isArray(missingValue) && missingValue.every((item) => typeof item === "string")
        ? missingValue
        : undefined;
      path = typeof pathValue === "string" ? pathValue : undefined;
      staleFields = Array.isArray(staleFieldsValue) && staleFieldsValue.every((item) => typeof item === "string")
        ? staleFieldsValue
        : undefined;
      lockedFields = Array.isArray(lockedFieldsValue) && lockedFieldsValue.every((item) => typeof item === "string")
        ? lockedFieldsValue
        : undefined;
      undoWindowSeconds = typeof undoWindowSecondsValue === "number" ? undoWindowSecondsValue : undefined;
      expiresAt = typeof expiresAtValue === "string" ? expiresAtValue : undefined;
      invoiceDateMonth = typeof invoiceDateMonthValue === "string"
        ? invoiceDateMonthValue
        : invoiceDateMonthValue === undefined && typeof glDateMonthValue === "string"
          ? glDateMonthValue
          : undefined;
      suggestedInvoiceDate = typeof suggestedInvoiceDateValue === "string"
        ? suggestedInvoiceDateValue
        : suggestedInvoiceDateValue === undefined && typeof suggestedGlDateValue === "string"
          ? suggestedGlDateValue
          : undefined;
      glDateMonth = typeof glDateMonthValue === "string" ? glDateMonthValue : undefined;
      currentMonth = typeof currentMonthValue === "string" ? currentMonthValue : undefined;
      suggestedGlDate = typeof suggestedGlDateValue === "string" ? suggestedGlDateValue : undefined;
      nextAction = typeof nextActionValue === "string" ? nextActionValue : undefined;
    } else {
      message = res.statusText;
    }
  } catch {
    message = res.statusText;
  }

  const error: ApiError = {
    message,
    status: res.status,
    code,
    details,
    actionId,
    missing,
    path,
    staleFields,
    lockedFields,
    undoWindowSeconds,
    expiresAt,
    invoiceDateMonth,
    suggestedInvoiceDate,
    glDateMonth,
    currentMonth,
    suggestedGlDate,
    nextAction,
  };
  throw error;
}

// ─── Default headers (injected at runtime, e.g. x-user-id) ───────────────────

const _defaultHeaders: Record<string, string> = {};

/**
 * Set a default header that will be sent with every API request.
 * Call from a component with session access to inject `x-user-id`.
 */
export function setDefaultHeader(key: string, value: string) {
  _defaultHeaders[key] = value;
}

function mergeHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ..._defaultHeaders, ...extra };
}

// ─── API Client ───────────────────────────────────────────────────────────────

export const api = {
  async get<T>(path: string, params?: Params): Promise<T> {
    const res = await fetch(buildUrl(proxyPath(path), params), {
      headers: mergeHeaders(),
    });
    return handleResponse<T>(res);
  },

  async post<T>(path: string, body?: unknown, options?: { headers?: Record<string, string> }): Promise<T> {
    const res = await fetch(buildUrl(proxyPath(path)), {
      method: "POST",
      headers: mergeHeaders({ "Content-Type": "application/json", ...(options?.headers ?? {}) }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  async postForm<T>(path: string, body: FormData): Promise<T> {
    const res = await fetch(buildUrl(proxyPath(path)), {
      method: "POST",
      headers: mergeHeaders(),
      body,
    });
    return handleResponse<T>(res);
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(buildUrl(proxyPath(path)), {
      method: "PATCH",
      headers: mergeHeaders({ "Content-Type": "application/json" }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  async del<T>(path: string): Promise<T> {
    const res = await fetch(buildUrl(proxyPath(path)), {
      method: "DELETE",
      headers: mergeHeaders(),
    });
    return handleResponse<T>(res);
  },

  async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(buildUrl(proxyPath(path)), {
      method: "PUT",
      headers: mergeHeaders({ "Content-Type": "application/json" }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },
};
