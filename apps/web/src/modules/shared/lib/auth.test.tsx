/**
 * auth.test.tsx
 * Tests for useAuth() hook — verifies it correctly wraps useSession from next-auth/react.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Hoisted mutable state ────────────────────────────────────────────────────

const AM = vi.hoisted(() => ({
  sessionReturn: {
    data: null as {
      user: {
        name: string;
        email: string;
        image: string | null;
        position?: string | null;
        role?: string;
        isAdmin?: boolean;
        permissions?: string[];
        userId?: string;
        roleVersion?: number;
      };
    } | null,
    status: 'unauthenticated' as 'authenticated' | 'unauthenticated' | 'loading',
  },
  mockSignIn: vi.fn(),
  mockSignOut: vi.fn(),
}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined) {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('next-auth/react', () => ({
  useSession: () => AM.sessionReturn,
  signIn: AM.mockSignIn,
  signOut: AM.mockSignOut,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { useAuth } from '@/modules/shared/lib/auth';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }

  return Wrapper;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  AM.sessionReturn = { data: null, status: 'unauthenticated' };
  AM.mockSignIn.mockReset();
  AM.mockSignOut.mockReset();
  setNodeEnv(ORIGINAL_NODE_ENV);
  delete process.env.NEXT_PUBLIC_AZURE_AD_CONFIGURED;
  document.cookie = '';
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useAuth', () => {
  // ── Test 1 ─────────────────────────────────────────────────────────────────
  it('returns the session auth fields verbatim when session is authenticated', () => {
    AM.sessionReturn = {
      data: {
        user: {
          name: 'Dana Brown',
          email: 'dana@northwindcg.example',
          image: null,
          position: 'Leadership',
          role: 'leadership',
          isAdmin: false,
          permissions: ['accounting.invoices.view'],
          userId: 'user-123',
          roleVersion: 4,
        },
      },
      status: 'authenticated',
    };

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.name).toBe('Dana Brown');
    expect(result.current.user?.email).toBe('dana@northwindcg.example');
    expect(result.current.user?.position).toBe('Leadership');
    expect(result.current.user?.role).toBe('leadership');
    expect(result.current.user?.isAdmin).toBe(false);
    expect(result.current.user?.permissions).toEqual(['accounting.invoices.view']);
    expect(result.current.user?.userId).toBe('user-123');
    expect(result.current.user?.roleVersion).toBe(4);
    expect(result.current.isLoading).toBe(false);
  });

  // ── Test 1b ────────────────────────────────────────────────────────────────
  it('returns the wildcard admin mock user in dev mode when no session exists', () => {
    setNodeEnv('development');
    AM.sessionReturn = { data: null, status: 'unauthenticated' };

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.role).toBe('admin');
    expect(result.current.user?.isAdmin).toBe(true);
    expect(result.current.user?.permissions).toEqual(['*']);
    expect(result.current.user?.userId).toBe('mock-admin-user');
    expect(result.current.user?.roleVersion).toBe(0);
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  it('returns isAuthenticated=false and user=null when unauthenticated', () => {
    AM.sessionReturn = { data: null, status: 'unauthenticated' };

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  it('returns isLoading=true when session status is "loading"', () => {
    AM.sessionReturn = { data: null, status: 'loading' };

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  it('signIn calls nextAuthSignIn with "azure-ad"', async () => {
    AM.sessionReturn = { data: null, status: 'unauthenticated' };

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });
    await result.current.signIn();

    expect(AM.mockSignIn).toHaveBeenCalledWith('azure-ad');
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  it('signOut calls nextAuthSignOut with { callbackUrl: "/login" }', async () => {
    AM.sessionReturn = { data: null, status: 'unauthenticated' };

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });
    await result.current.signOut();

    expect(AM.mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });
});
