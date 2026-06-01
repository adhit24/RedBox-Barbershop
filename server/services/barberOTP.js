// server/services/barberOTP.js
const { randomUUID } = require('crypto');
const { sendWA: sendWAFonnte } = require('./fonnte');

function normalizeWa(phone) {
  return String(phone || '').replace(/\D/g, '').replace(/^0/, '62');
}

/**
 * Kirim OTP ke kapster.
 * Cek di tabel `barbers` apakah phone ini terdaftar.
 * Return { ok, barber, error }
 */
async function sendBarberOTP(supabase, phone) {
  const wa = normalizeWa(phone);
  if (wa.length < 10 || !wa.startsWith('62')) {
    return { ok: false, error: 'Format nomor HP tidak valid' };
  }

  const { data: barber } = await supabase
    .from('barbers')
    .select('id, name, phone, branch')
    .eq('phone', wa)
    .eq('is_active', true)
    .maybeSingle();

  if (!barber) {
    return { ok: false, error: 'Nomor tidak terdaftar sebagai kapster. Hubungi admin.' };
  }

  // Rate limit: max 3 OTP per 10 menit (reuse tabel otp_codes existing)
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await supabase.from('otp_codes')
    .select('*', { count: 'exact', head: true })
    .eq('phone', wa).gte('created_at', since);
  if (count >= 3) {
    return { ok: false, error: 'Terlalu banyak percobaan. Tunggu 10 menit.' };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from('otp_codes').insert({ phone: wa, code, expires_at: expiresAt });

  const firstName = (barber.name || 'Kapster').split(' ')[0];
  const msg = `Halo ${firstName}! 👋\n\nKode OTP login RedBox Staff:\n\n*${code}*\n\nBerlaku 10 menit. Jangan bagikan ke siapapun ya! 🔒`;

  try {
    await sendWAFonnte(wa, msg);
  } catch (e) {
    console.error('[BarberOTP] sendWA error:', e.message);
    return { ok: false, error: 'Gagal kirim OTP ke WhatsApp. Coba lagi.' };
  }

  return { ok: true, barber: { id: barber.id, name: barber.name, branch: barber.branch } };
}

/**
 * Verify OTP, auto-enroll ke barber_users kalau belum ada, issue session token.
 * Return { ok, token, barber, setup_completed, error }
 */
async function verifyBarberOTP(supabase, phone, code) {
  const wa = normalizeWa(phone);

  const { data: otp } = await supabase
    .from('otp_codes')
    .select('id')
    .eq('phone', wa)
    .eq('code', String(code).trim())
    .is('verified_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otp) {
    return { ok: false, error: 'Kode OTP salah atau sudah expired' };
  }

  await supabase.from('otp_codes')
    .update({ verified_at: new Date().toISOString() })
    .eq('id', otp.id);

  // Lookup barber by phone
  const { data: barber } = await supabase
    .from('barbers')
    .select('id, name, branch')
    .eq('phone', wa)
    .eq('is_active', true)
    .maybeSingle();

  if (!barber) {
    return { ok: false, error: 'Kapster tidak ditemukan' };
  }

  // Auto-enroll kalau belum ada di barber_users
  const { data: existing } = await supabase
    .from('barber_users')
    .select('barber_id, setup_completed')
    .eq('barber_id', barber.id)
    .maybeSingle();

  let setupCompleted = false;
  if (!existing) {
    await supabase.from('barber_users').insert({
      barber_id: barber.id,
      phone: wa,
      setup_completed: false,
      last_login_at: new Date().toISOString(),
    });
  } else {
    setupCompleted = !!existing.setup_completed;
    await supabase.from('barber_users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('barber_id', barber.id);
  }

  // Issue session token
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('barber_sessions').insert({
    token,
    barber_id: barber.id,
    expires_at: expiresAt,
  });

  return {
    ok: true,
    token,
    barber: { id: barber.id, name: barber.name, branch: barber.branch },
    setup_completed: setupCompleted,
  };
}

/**
 * Destroy session token (logout)
 */
async function destroyBarberSession(supabase, token) {
  if (!token) return;
  await supabase.from('barber_sessions').delete().eq('token', token);
}

module.exports = { sendBarberOTP, verifyBarberOTP, destroyBarberSession, normalizeWa };
