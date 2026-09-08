export const OWNER_EMAILS = new Set([
  'adhit24@gmail.com',
  'suwandi_gunawan@yahoo.com',
]);

export const BOOKING_BRANCHES = ['bypass', 'sumber', 'samadikun', 'csb', 'tegal'] as const;
export type BookingBranch = (typeof BOOKING_BRANCHES)[number];
export type BookingAdminRole = 'owner' | 'manager';

export interface BookingAdminSession {
  userId: string;
  email: string;
  role: BookingAdminRole;
  branch: BookingBranch | null;
}

export interface BookingTarget {
  id: string;
  location?: string | null;
}

export type PolicyResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

const BRANCH_ALIASES = new Map<string, BookingBranch>([
  ['csb mall', 'csb'],
  ['redbox csb mall', 'csb'],
  ['redbox barbershop csb', 'csb'],
  ['redbox barbershop bypass', 'bypass'],
  ['redbox bypass', 'bypass'],
  ['redbox barbershop samadikun', 'samadikun'],
  ['redbox samadikun', 'samadikun'],
  ['redbox barbershop sumber', 'sumber'],
  ['redbox sumber', 'sumber'],
  ['redbox barbershop tegal', 'tegal'],
  ['redbox tegal', 'tegal'],
]);

export function normalizeBranch(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  return BRANCH_ALIASES.get(raw) || raw;
}

export function isBookingBranch(value: string): value is BookingBranch {
  return (BOOKING_BRANCHES as readonly string[]).includes(value as BookingBranch);
}

export function resolveBookingAdminRole(
  email: string | null | undefined,
  profileRole: string | null | undefined
): string {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (OWNER_EMAILS.has(normalizedEmail)) return 'owner';
  return typeof profileRole === 'string' ? profileRole.trim().toLowerCase() : '';
}

export function authorizeBookingAdminSession(
  user: { id?: string | null; email?: string | null } | null | undefined,
  profile: { id?: string | null; role?: string | null; branch?: string | null } | null | undefined
): PolicyResult<BookingAdminSession> {
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (!userId) {
    return { ok: false, status: 401, error: 'Unauthorized: authentication required' };
  }

  if (!profile || profile.id !== userId) {
    return { ok: false, status: 403, error: 'Forbidden: profile not found' };
  }

  const role = resolveBookingAdminRole(email, profile.role);
  if (role !== 'owner' && role !== 'manager') {
    return { ok: false, status: 403, error: 'Forbidden: insufficient privileges (owner or manager required)' };
  }

  if (role === 'owner') {
    return {
      ok: true,
      value: {
        userId,
        email,
        role: 'owner',
        branch: null,
      },
    };
  }

  // Manager must have an assigned branch
  const rawBranch = typeof profile.branch === 'string' ? profile.branch.trim().toLowerCase() : '';
  const branch = normalizeBranch(rawBranch);
  if (!isBookingBranch(branch)) {
    // Fail closed: manager without branch or with invalid branch is rejected
    return { ok: false, status: 403, error: 'Forbidden: manager has no assigned branch' };
  }

  return {
    ok: true,
    value: {
      userId,
      email,
      role: 'manager',
      branch,
    },
  };
}

export function authorizeBookingPatchOperation(
  session: BookingAdminSession,
  existingBooking: BookingTarget | null | undefined,
  requestedUpdates: { location?: unknown } | null | undefined
): PolicyResult<{ safeBranch: BookingBranch | null }> {
  if (!existingBooking) {
    return { ok: false, status: 404, error: 'Booking not found' };
  }

  if (session.role === 'owner') {
    // Owner can operate on any branch
    return { ok: true, value: { safeBranch: null } };
  }

  // Manager: verify existing booking location matches manager's branch
  const bookingLocation = normalizeBranch(existingBooking.location);
  if (bookingLocation !== session.branch) {
    return {
      ok: false,
      status: 403,
      error: `Forbidden: manager (${session.branch}) cannot operate on booking for branch (${bookingLocation || 'unassigned'})`,
    };
  }

  // If client requested a location change in updates, verify that target location matches manager branch
  if (requestedUpdates?.location !== undefined) {
    const targetLocation = normalizeBranch(requestedUpdates.location);
    if (targetLocation !== session.branch) {
      return {
        ok: false,
        status: 403,
        error: `Forbidden: manager (${session.branch}) cannot move booking to branch (${targetLocation || 'unassigned'})`,
      };
    }
  }

  return { ok: true, value: { safeBranch: session.branch } };
}
