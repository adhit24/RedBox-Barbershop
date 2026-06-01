// server/services/barberAuth.js

/**
 * Middleware factory. Validates barber_sessions.token from header.
 * Frontend mengirim token via header 'x-barber-token' (proxy ambil dari cookie).
 * Attach req.barber = { id, name, branch } pada success.
 */
function createBarberAuth(supabase) {
  return async function barberAuth(req, res, next) {
    const token = req.headers['x-barber-token'] || '';
    if (!token) return res.status(401).json({ error: 'No barber session' });

    const { data: session } = await supabase
      .from('barber_sessions')
      .select('barber_id, expires_at')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

    const { data: barber } = await supabase
      .from('barbers')
      .select('id, name, branch')
      .eq('id', session.barber_id)
      .maybeSingle();

    if (!barber) return res.status(401).json({ error: 'Barber not found' });

    req.barber = barber;
    next();
  };
}

module.exports = { createBarberAuth };
