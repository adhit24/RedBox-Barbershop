import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { PermissionDenied } from '../components/PermissionDenied';

/**
 * Structural placeholder for future per-permission gating (spec §4/§9 — target
 * auth architecture). Today `permissions` is always empty (no server-side RBAC
 * to derive it from), so this always renders `children`. `required` is accepted
 * now so call sites don't need to change again once real permissions exist.
 */
export function PermissionGuard({
  required,
  children,
}: {
  required?: string;
  children: ReactNode;
}) {
  const { permissions } = useAuth();
  if (required && permissions.length > 0 && !permissions.includes(required)) {
    return <PermissionDenied />;
  }
  return <>{children}</>;
}
