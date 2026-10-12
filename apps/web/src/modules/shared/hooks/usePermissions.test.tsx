import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const PM = vi.hoisted(() => ({
  authReturn: {
    user: null as {
      role: string;
      isAdmin: boolean;
      permissions: string[];
    } | null,
    isAuthenticated: false,
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('@/modules/shared/lib/auth', () => ({
  useAuth: () => PM.authReturn,
}));

import { usePermissions } from '@/modules/shared/hooks/usePermissions';

describe('usePermissions', () => {
  it('grants a single key that exists in the permissions array', () => {
    PM.authReturn.user = { role: 'employee', isAdmin: false, permissions: ['accounting.invoices.view'] };

    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasPermission('accounting.invoices.view')).toBe(true);
  });

  it('denies a single key when not admin and the key is missing', () => {
    PM.authReturn.user = { role: 'employee', isAdmin: false, permissions: ['accounting.invoices.view'] };

    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasPermission('accounting.invoices.approve')).toBe(false);
  });

  it('bypasses all checks for admins', () => {
    PM.authReturn.user = { role: 'admin', isAdmin: true, permissions: [] };

    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasPermission('unknown.permission')).toBe(true);
  });

  it('bypasses all checks when wildcard permissions are present', () => {
    PM.authReturn.user = { role: 'employee', isAdmin: false, permissions: ['*'] };

    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasPermission('unknown.permission')).toBe(true);
  });

  it('passes hasAnyPermission when one required key matches', () => {
    PM.authReturn.user = { role: 'employee', isAdmin: false, permissions: ['accounting.invoices.view_details'] };

    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasAnyPermission(['accounting.invoices.view', 'accounting.invoices.view_details'])).toBe(true);
  });

  it('fails hasAllPermissions when one required key is missing', () => {
    PM.authReturn.user = { role: 'employee', isAdmin: false, permissions: ['accounting.invoices.view'] };

    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasAllPermissions(['accounting.invoices.view', 'accounting.invoices.approve'])).toBe(false);
  });
});