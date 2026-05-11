/**
 * Authentication & Membership Middleware
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get user profile with membership info
    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    req.user = { ...user, ...profile };
    next();

  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

const requireMembership = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Check if user has membership
    const { data: membership, error } = await supabase
      .from('members')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (error || !membership) {
      return res.status(403).json({
        error: 'Membership required',
        message: 'Join membership to access AI features',
        joinUrl: '/membership.html'
      });
    }

    // Check if membership is expired
    if (membership.expires_at && new Date(membership.expires_at) < new Date()) {
      return res.status(403).json({
        error: 'Membership expired',
        message: 'Please renew your membership'
      });
    }

    req.membership = membership;
    next();

  } catch (error) {
    console.error('Membership check error:', error);
    res.status(500).json({ error: 'Failed to verify membership' });
  }
};

module.exports = { authenticate, requireMembership };
