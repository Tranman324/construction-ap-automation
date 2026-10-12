import { describe, expect, it } from 'vitest';
import { hasPermission, resolvePermissions } from '@/modules/shared/lib/permissions';

describe('resolvePermissions', () => {
  it('grants any key for admins', () => {
    expect(
      resolvePermissions(
        {
          isAdmin: true,
          rolePermissions: [],
          userOverrides: {},
        },
        'unknown.permission',
      ),
    ).toBe(true);
  });

  it('grants a role permission when no override exists', () => {
    expect(
      resolvePermissions(
        {
          isAdmin: false,
          rolePermissions: ['accounting.invoices.approve'],
          userOverrides: {},
        },
        'accounting.invoices.approve',
      ),
    ).toBe(true);
  });

  it('denies when the role does not grant the key and no override exists', () => {
    expect(
      resolvePermissions(
        {
          isAdmin: false,
          rolePermissions: ['accounting.invoices.view'],
          userOverrides: {},
        },
        'accounting.invoices.approve',
      ),
    ).toBe(false);
  });

  it('grants when a user override explicitly allows a missing role permission', () => {
    expect(
      resolvePermissions(
        {
          isAdmin: false,
          rolePermissions: [],
          userOverrides: { 'accounting.invoices.reject': true },
        },
        'accounting.invoices.reject',
      ),
    ).toBe(true);
  });

  it('denies when a user override revokes a granted role permission', () => {
    expect(
      resolvePermissions(
        {
          isAdmin: false,
          rolePermissions: ['accounting.invoices.delete'],
          userOverrides: { 'accounting.invoices.delete': false },
        },
        'accounting.invoices.delete',
      ),
    ).toBe(false);
  });
});

describe('hasPermission', () => {
  it('grants any key when wildcard permissions are present', () => {
    expect(hasPermission(['*'], 'accounting.invoices.export')).toBe(true);
  });
});