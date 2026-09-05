'use strict';

const BACKOFFICE_HOST = 'backoffice.redboxbarbershop.com';
const OWNER_EMAILS = new Set([
  'adhit24@gmail.com',
  'suwandi_gunawan@yahoo.com',
]);
const ALLOWED_BACKOFFICE_ROLES = new Set(['owner', 'manager']);

function normalizeRole(email, profileRole) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (OWNER_EMAILS.has(normalizedEmail)) return 'owner';
  return String(profileRole || '').trim().toLowerCase();
}

function createBackofficeSupabaseAuth(supabase, legacyAdminAuth) {
  if (!supabase || typeof legacyAdminAuth !== 'function') {
    throw new Error('createBackofficeSupabaseAuth requires supabase and legacyAdminAuth');
  }

  return async function backofficeSupabaseAuth(req, res, next) {
    const hostname = String(req.hostname || '').trim().toLowerCase();
    const authHeader = String(req.headers?.authorization || '');
    const isBackofficeBearer = hostname === BACKOFFICE_HOST && authHeader.startsWith('Bearer ');

    // Preserve every existing admin/stockist/cron authentication path exactly.
    if (!isBackofficeBearer) return legacyAdminAuth(req, res, next);

    const accessToken = authHeader.slice(7).trim();
    if (!accessToken) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken);
      const user = userResult?.user;
      if (userError || !user?.id || !user?.email) {
        return res.status(401).json({ error: 'Invalid or expired Supabase session' });
      }

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('id,name,role,branch')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) {
        console.error('[BackofficeAuth] profile lookup failed:', profileError.message);
        return res.status(503).json({ error: 'Backoffice profile unavailable' });
      }

      const role = normalizeRole(user.email, profile?.role);
      if (!ALLOWED_BACKOFFICE_ROLES.has(role)) {
        return res.status(403).json({ error: 'Backoffice access denied' });
      }

      req.adminAuth = {
        staffId: user.id,
        role,
        branch: role === 'manager' ? (profile?.branch || null) : null,
        sessionVerified: true,
        email: user.email,
        name: profile?.name || null,
        authSource: 'supabase',
      };
      return next();
    } catch (error) {
      console.error('[BackofficeAuth] verification failed:', error?.message || error);
      return res.status(401).json({ error: 'Invalid or expired Supabase session' });
    }
  };
}

module.exports = {
  BACKOFFICE_HOST,
  OWNER_EMAILS,
  ALLOWED_BACKOFFICE_ROLES,
  normalizeRole,
  createBackofficeSupabaseAuth,
};
