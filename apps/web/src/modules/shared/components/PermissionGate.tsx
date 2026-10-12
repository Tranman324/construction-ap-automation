import type { ReactNode } from 'react';
import type { PermissionKey } from '@/modules/shared/types/permissions';
import { usePermissions } from '@/modules/shared/hooks/usePermissions';

interface PermissionGateProps {
  requires: PermissionKey | PermissionKey[];
  mode?: 'any' | 'all';
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGate({
  requires,
  mode = 'any',
  fallback = null,
  children,
}: PermissionGateProps) {
  const { hasAnyPermission, hasAllPermissions } = usePermissions();
  const requiredKeys = Array.isArray(requires) ? requires : [requires];
  const isAllowed = mode === 'all'
    ? hasAllPermissions(requiredKeys)
    : hasAnyPermission(requiredKeys);

  return isAllowed ? <>{children}</> : <>{fallback}</>;
}