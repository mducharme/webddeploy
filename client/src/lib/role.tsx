import { roleAtLeast, type Role } from '@webddeploy/shared';
import type { ReactNode } from 'react';
import { useMe } from './api.ts';

/** Whether the signed-in user has at least `role`. The server enforces it either way; this only hides what they can't use. */
export function useCan(role: Role): boolean {
  return roleAtLeast(useMe().data?.role, role);
}

export function Can({ role, children, otherwise = null }: { role: Role; children: ReactNode; otherwise?: ReactNode }) {
  return <>{useCan(role) ? children : otherwise}</>;
}
