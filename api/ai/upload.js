/**
 * Vercel Serverless — POST /api/ai/upload
 * Accepts base64 image, uploads to Supabase Storage, creates ai_uploads record
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Generate deterministic UUID v5 from email namespace
const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace
function emailToUuid(email) {
  if (!email || email === 'anonymous') return null;
  return crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex').replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', service: 'AI Upload' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image, serviceType = 'full_analysis', userEmail } = req.body || {};

    if (!image) return res.status(400).json({ error: 'No image provided' });

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Enforce per-member quota: max 2 analyses (whitelisted accounts are unlimited)
    const UNLIMITED_EMAILS = ['adhit24@gmail.com'];
    const MAX_USES = 2;
    const userUuid = emailToUuid(userEmail);
    if (userEmail && !UNLIMITED_EMAILS.includes(userEmail) && userUuid) {
      const { count, error: countError } = await supabase
        .from('ai_uploads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userUuid)
        .neq('status', 'failed');

      if (!countError && count >= MAX_USES) {
        return res.status(429).json({
          error: 'Limit reached',
          message: `Kamu sudah menggunakan ${MAX_USES}x analisis AI. Batas maksimal ${MAX_USES} kali per member.`,
          usedCount: count,
          maxCount: MAX_USES,
        });
      }
    }

    // Convert base64 data URL to buffer
    const matches = image.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Invalid image format' });

    const contentType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    // Enforce max 8MB
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image too large. Max 8MB.' });
    }

    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const storagePath = `uploads/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

    // Upload to Supabase Storage bucket 'ai-images'
    const { error: storageError } = await supabase.storage
      .from('ai-images')
      .upload(storagePath, buffer, { contentType, cacheControl: '3600', upsert: false });

    if (storageError) {
      console.error('[AI Upload] Storage error:', storageError.message);
      return res.status(500).json({ error: 'Failed to store image: ' + storageError.message });
    }

    const { data: { publicUrl } } = supabase.storage
      .from('ai-images')
      .getPublicUrl(storagePath);

    // Create ai_uploads record (userUuid already computed above for quota check)
    const { data: upload, error: dbError } = await supabase
      .from('ai_uploads')
      .insert({
        original_image_url: publicUrl,
        service_type: serviceType,
        status: 'pending',
        user_id: userUuid,
      })
      .select()
      .single();

    if (dbError) {
      console.error('[AI Upload] DB error:', dbError.message);
      return res.status(500).json({ error: 'Failed to create upload record: ' + dbError.message });
    }

    return res.status(201).json({
      uploadId: upload.id,
      status: 'pending',
      imageUrl: publicUrl,
      serviceType
    });

  } catch (err) {
    console.error('[AI Upload] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
