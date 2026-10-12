"use client";

import { useSession, signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthUser {
  name: string;
  email: string;
  image?: string | null;
  position?: string | null;
  role: string;
  isAdmin: boolean;
  permissions: string[];
  userId: string;
  roleVersion: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

// SessionProvider is wired in providers.tsx — AuthProvider is now a passthrough.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const MOCK_USER: AuthUser = {
  name: "Dana (Dev)",
  email: "dana@northwindcg.example",
  image: null,
  position: "Finance Manager",
  role: "admin",
  isAdmin: true,
  permissions: ["*"],
  userId: "mock-admin-user",
  roleVersion: 0,
};

export function useAuth(): AuthContextValue {
  const { data: session, status } = useSession();

  // Local dev bypass — when no Azure AD configured AND no active session,
  // provide a mock user so the dashboard is fully usable.
  // Skip bypass during tests (Vitest sets NODE_ENV=test or import.meta.env.MODE=test).
  const isTest = typeof process !== "undefined" && process.env.NODE_ENV === "test";
  const hasAzureAd = typeof window !== "undefined"
    ? !!process.env.NEXT_PUBLIC_AZURE_AD_CONFIGURED
    : !!process.env.AZURE_AD_CLIENT_ID;

  if (!isTest && !hasAzureAd && status === "unauthenticated" && !session) {
    return {
      user: MOCK_USER,
      isAuthenticated: true,
      isLoading: false,
      signIn: async () => { console.log("[dev] signIn bypassed — no Azure AD configured"); },
      signOut: async () => { console.log("[dev] signOut bypassed — no Azure AD configured"); },
    };
  }

  return {
    user: session?.user
      ? {
          name: session.user.name ?? "",
          email: session.user.email ?? "",
          image: session.user.image ?? null,
          position: session.user.position ?? null,
          role: session.user.role ?? "",
          isAdmin: session.user.isAdmin ?? false,
          permissions: session.user.permissions ?? [],
          userId: session.user.userId ?? "",
          roleVersion: session.user.roleVersion ?? 0,
        }
      : null,
    isAuthenticated: status === "authenticated",
    isLoading: status === "loading",
    signIn: async () => { await nextAuthSignIn("azure-ad"); },
    signOut: async () => { await nextAuthSignOut({ callbackUrl: "/login" }); },
  };
}

