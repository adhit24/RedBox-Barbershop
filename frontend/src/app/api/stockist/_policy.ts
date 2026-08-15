export const STOCKIST_BRANCHES = ['bypass', 'sumber', 'samadikun', 'csb', 'tegal'] as const;

export type StockistBranch = (typeof STOCKIST_BRANCHES)[number];
export type StockistRole = 'owner' | 'branch_admin';

export type StockistSession = {
  userId: string;
  role: StockistRole;
  branch: StockistBranch | null;
};

type AuthUser = { id?: string | null } | null | undefined;
type UserProfile = { id?: string | null; role?: string | null; branch?: string | null } | null | undefined;

type PolicyFailure = { ok: false; status: 401 | 403; error: string };
type PolicySuccess<T> = { ok: true; value: T };

function isStockistBranch(value: string): value is StockistBranch {
  return (STOCKIST_BRANCHES as readonly string[]).includes(value);
}

export function authorizeStockistAdmin(
  user: AuthUser,
  profile: UserProfile,
): PolicyFailure | PolicySuccess<StockistSession> {
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };

  if (!profile || profile.id !== userId || !['owner', 'branch_admin'].includes(profile.role || '')) {
    return { ok: false, status: 403, error: 'Stockist access required' };
  }

  if (profile.role === 'owner') {
    return { ok: true, value: { userId, role: 'owner', branch: null } };
  }

  const branch = typeof profile.branch === 'string' ? profile.branch.trim().toLowerCase() : '';
  if (!isStockistBranch(branch)) {
    return { ok: false, status: 403, error: 'Admin branch is not configured' };
  }
  return { ok: true, value: { userId, role: 'branch_admin', branch } };
}
