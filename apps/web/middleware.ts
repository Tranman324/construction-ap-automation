import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { canAccessRoute, getDefaultRoute } from "@/modules/shared/lib/moduleAccess";

/**
 * Edge Middleware — page auth + backend API proxy.
 *
 * For /api/backend/* requests:
 *   Uses NextResponse.rewrite() to redirect to the real backend. Injects
 *   x-internal-secret (shared with backend) and x-user-email (from session
 *   cookie) as request headers. The rewrite happens at the edge with zero
 *   serverless cold start.
 *
 *   Auth for the proxy path is lightweight:
 *   - /api/backend/health → no auth needed, always proxied
 *   - All other /api/backend/* → checks for session cookie presence via
 *     getToken(). If no session, returns 401.
 *
 * For page requests:
 *   Standard NextAuth session check — redirect to /login if no session.
 */

// ─── Lightweight edge rate limiter for auth endpoints ─────────────────────────
const AUTH_RATE_LIMIT = 60;
const AUTH_RATE_WINDOW = 5 * 60 * 1000;
const authAttempts = new Map<string, { count: number; resetAt: number }>();

function isAuthRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + AUTH_RATE_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > AUTH_RATE_LIMIT;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authAttempts) {
    if (now > entry.resetAt) authAttempts.delete(ip);
  }
}, 5 * 60 * 1000);

const BACKEND_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3456"
).trim();

const INTERNAL_SECRET = (process.env.INTERNAL_API_SECRET ?? "").replace(
  /\s+/g,
  "",
);

function getTokenPermissions(token: unknown): string[] {
  if (!token || typeof token !== "object") {
    return [];
  }

  const authToken = token as { permissions?: unknown };
  return Array.isArray(authToken.permissions)
    ? authToken.permissions.filter((permission): permission is string => typeof permission === "string")
    : [];
}

function getTokenAuth(token: unknown): { isAdmin: boolean; permissions: string[] } {
  if (!token || typeof token !== "object") {
    return { isAdmin: false, permissions: [] };
  }

  const authToken = token as { isAdmin?: unknown; permissions?: unknown };
  return {
    isAdmin: Boolean(authToken.isAdmin),
    permissions: getTokenPermissions(authToken),
  };
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://api.mapbox.com https://*.mapbox.com https://tile.openstreetmap.org",
      "font-src 'self'",
      "connect-src 'self' https://api.mapbox.com https://*.mapbox.com https://events.mapbox.com https://tile.openstreetmap.org https://login.microsoftonline.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );

  return response;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ─── Backend API proxy (/api/backend/*) ───────────────────────────────
  if (pathname.startsWith("/api/backend/")) {
    return applySecurityHeaders(await handleBackendProxy(req));
  }

  // ─── Rate-limited auth paths ──────────────────────────────────────────
  if (pathname === "/login" || pathname.startsWith("/api/auth")) {
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || (req as unknown as { ip?: string }).ip
      || "unknown";
    if (isAuthRateLimited(clientIp)) {
      return applySecurityHeaders(
        NextResponse.json(
          { error: "Too many authentication attempts. Please try again later." },
          { status: 429 },
        ),
      );
    }
    return applySecurityHeaders(NextResponse.next());
  }

  // ─── Skip auth for static assets ──────────────────────────────────────
  if (
    pathname.startsWith("/_next/static") ||
    pathname.startsWith("/_next/image") ||
    pathname === "/favicon.ico"
  ) {
    return applySecurityHeaders(NextResponse.next());
  }

  // ─── Page auth ────────────────────────────────────────────────────────

  // No Azure AD → dev mode, skip auth
  if (!process.env.AZURE_AD_CLIENT_ID) {
    return applySecurityHeaders(NextResponse.next());
  }

  // Check for valid session via cookie
  let token: Awaited<ReturnType<typeof getToken>> | null;
  try {
    token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  } catch {
    token = null;
  }

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.url);
    return applySecurityHeaders(NextResponse.redirect(loginUrl));
  }

  try {
    const auth = getTokenAuth(token);
    if (pathname === "/") {
      return applySecurityHeaders(
        NextResponse.redirect(new URL(getDefaultRoute(auth), req.url)),
      );
    }

    if (!canAccessRoute(auth, pathname)) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      );
    }
  } catch {
    return applySecurityHeaders(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
  }

  return applySecurityHeaders(NextResponse.next());
}

// ─── Backend proxy via rewrite ──────────────────────────────────────────────

async function handleBackendProxy(req: NextRequest): Promise<NextResponse> {
  const backendPath = req.nextUrl.pathname.replace(/^\/api\/backend\//, "");
  const isHealth = backendPath === "health";

  if (!INTERNAL_SECRET) {
    return applySecurityHeaders(
      NextResponse.json({ error: "Proxy not configured" }, { status: 503 }),
    );
  }

  // ─── CSRF protection for mutating requests ──────────────────────────
  const mutatingMethods = ["POST", "PATCH", "PUT", "DELETE"];
  if (mutatingMethods.includes(req.method.toUpperCase()) && !isHealth) {
    const origin = req.headers.get("origin");
    const allowedOrigins = [
      "https://toolbox.northwindcg.example",
      ...(process.env.NODE_ENV !== "production" ? ["http://localhost:3000"] : []),
    ];
    if (origin && !allowedOrigins.includes(origin)) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      );
    }
  }

  // Auth check — lightweight session cookie decode
  let userEmail = "system";
  let userRole = "";
  let userId = "";
  let userPermissions: string[] = [];
  if (!isHealth) {
    const noAzure = !process.env.AZURE_AD_CLIENT_ID;

    if (noAzure) {
      userEmail = "dev@localhost";
      userRole = "admin";
      userId = "mock-admin-user";
      userPermissions = ["*"];
    } else {
      // Use getToken() which handles chunked cookies (.0, .1, etc.)
      // automatically — do NOT check raw cookie names since NextAuth
      // splits large JWTs across multiple __Secure-*-session-token.N cookies.
      try {
        const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
        if (!token) {
          return applySecurityHeaders(
            NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
          );
        }
        userEmail = (token?.email as string) || "unknown";
        userRole = (token?.role as string) || "";
        userId = (token?.userId as string) || "";
        userPermissions = getTokenPermissions(token);
      } catch {
        return applySecurityHeaders(
          NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        );
      }
    }
  }

  // Build the rewrite target URL
  const targetUrl = new URL(`/api/${backendPath}`, BACKEND_URL);
  req.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  // Rewrite with injected headers — this is a true URL rewrite at the edge,
  // not a fetch+response. Vercel handles the actual proxy transparently.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-internal-secret", INTERNAL_SECRET);
  requestHeaders.set("x-user-email", userEmail);
  requestHeaders.set("x-user-role", userRole);
  requestHeaders.set("x-user-id", userId);
  requestHeaders.set("x-user-permissions", userPermissions.join(","));
  // Remove cookie header so session cookies don't leak to the backend
  requestHeaders.delete("cookie");

  return applySecurityHeaders(
    NextResponse.rewrite(targetUrl, {
      request: {
        headers: requestHeaders,
      },
    }),
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
