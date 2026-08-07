export const MEMBERSHIP_BRANCHES = ['bypass', 'sumber', 'samadikun', 'csb', 'tegal'] as const;

export type MembershipBranch = (typeof MEMBERSHIP_BRANCHES)[number];
export type MembershipAdminRole = 'owner' | 'branch_admin';

export type MembershipAdminSession = {
  userId: string;
  role: MembershipAdminRole;
  branch: MembershipBranch | null;
};

type AuthUser = { id?: string | null } | null | undefined;
type UserProfile = {
  id?: string | null;
  role?: string | null;
  branch?: string | null;
} | null | undefined;

type PolicyFailure = { ok: false; status: 401 | 403 | 400; error: string };
type PolicySuccess<T> = { ok: true; value: T };

function normalizeBranch(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isMembershipBranch(value: string): value is MembershipBranch {
  return (MEMBERSHIP_BRANCHES as readonly string[]).includes(value);
}

export function authorizeMembershipAdmin(
  user: AuthUser,
  profile: UserProfile,
): PolicyFailure | PolicySuccess<MembershipAdminSession> {
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };

  if (!profile || profile.id !== userId || !['owner', 'branch_admin'].includes(profile.role || '')) {
    return { ok: false, status: 403, error: 'Admin access required' };
  }

  if (profile.role === 'owner') {
    return { ok: true, value: { userId, role: 'owner', branch: null } };
  }

  const branch = normalizeBranch(profile.branch);
  if (!isMembershipBranch(branch)) {
    return { ok: false, status: 403, error: 'Admin branch is not configured' };
  }

  return { ok: true, value: { userId, role: 'branch_admin', branch } };
}

export function resolveMembershipActivationBranch(
  session: MembershipAdminSession,
  requestedBranch: unknown,
): PolicyFailure | PolicySuccess<MembershipBranch> {
  const branch = normalizeBranch(requestedBranch);
  if (!branch) return { ok: false, status: 400, error: 'branch is required' };

  if (session.role === 'branch_admin') {
    if (branch !== session.branch) {
      return { ok: false, status: 403, error: 'Branch access denied' };
    }
    return { ok: true, value: session.branch };
  }

  if (!isMembershipBranch(branch)) {
    return { ok: false, status: 400, error: 'invalid branch' };
  }
  return { ok: true, value: branch };
}
