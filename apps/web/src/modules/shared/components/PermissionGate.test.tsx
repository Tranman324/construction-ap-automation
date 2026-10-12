import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const GM = vi.hoisted(() => ({
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
  useAuth: () => GM.authReturn,
}));

import { PermissionGate } from '@/modules/shared/components/PermissionGate';

describe('PermissionGate', () => {
  it('renders children when the permission is granted', () => {
    GM.authReturn.user = { role: 'employee', isAdmin: false, permissions: ['accounting.invoices.view'] };

    render(
      <PermissionGate requires="accounting.invoices.view">
        <span>Allowed</span>
      </PermissionGate>,
    );

    expect(screen.getByText('Allowed')).toBeInTheDocument();
  });

  it('renders fallback when the permission is denied', () => {
    GM.authReturn.user = { role: 'employee', isAdmin: false, permissions: [] };

    render(
      <PermissionGate requires="accounting.invoices.view" fallback={<span>Denied</span>}>
        <span>Allowed</span>
      </PermissionGate>,
    );

    expect(screen.getByText('Denied')).toBeInTheDocument();
  });

  it('renders fallback for mode="all" when only one required key is present', () => {
    GM.authReturn.user = { role: 'employee', isAdmin: false, permissions: ['accounting.invoices.view'] };

    render(
      <PermissionGate
        requires={['accounting.invoices.view', 'accounting.invoices.approve']}
        mode="all"
        fallback={<span>Denied</span>}
      >
        <span>Allowed</span>
      </PermissionGate>,
    );

    expect(screen.getByText('Denied')).toBeInTheDocument();
  });

  it('renders children for admin users', () => {
    GM.authReturn.user = { role: 'admin', isAdmin: true, permissions: [] };

    render(
      <PermissionGate requires="unknown.permission">
        <span>Allowed</span>
      </PermissionGate>,
    );

    expect(screen.getByText('Allowed')).toBeInTheDocument();
  });

  it('renders children when wildcard permissions are present', () => {
    GM.authReturn.user = { role: 'employee', isAdmin: false, permissions: ['*'] };

    render(
      <PermissionGate requires="unknown.permission">
        <span>Allowed</span>
      </PermissionGate>,
    );

    expect(screen.getByText('Allowed')).toBeInTheDocument();
  });
});