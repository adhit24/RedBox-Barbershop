/**
 * Vercel Serverless — POST /api/ai/upload
 * Accepts base64 image, uploads to Supabase Storage, creates ai_uploads record
 */

// Validate environment variables early
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.error('[AI Upload] Missing environment variables:', missingVars.join(', '));
}

let createClient;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (moduleErr) {
  console.error('[AI Upload] Module loading error:', moduleErr.message);
}

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
  if (req.method === 'GET') {
    const rawUrl = process.env.SUPABASE_URL || '';
    return res.status(200).json({ 
      status: 'ok', 
      service: 'AI Upload',
      envCheck: { 
        hasSupabase: !!process.env.SUPABASE_URL,
        hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
        supabaseUrl: rawUrl,
        urlLength: rawUrl.length,
        urlEndsWithSlash: rawUrl.endsWith('/'),
        serviceKeyLength: (process.env.SUPABASE_SERVICE_KEY || '').length,
        missingVars: missingVars.length > 0 ? missingVars : undefined
      }
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Check if modules loaded
  if (!createClient) {
    return res.status(500).json({ 
      error: 'Server configuration error: modules not loaded',
      detail: missingVars.length > 0 ? `Missing env vars: ${missingVars.join(', ')}` : 'Unknown module error'
    });
  }

  // Check environment variables
  if (missingVars.length > 0) {
    return res.status(500).json({ 
      error: 'Server configuration error: missing environment variables',
      detail: `Missing: ${missingVars.join(', ')}`
    });
  }

  try {
    const { image, serviceType = 'full_analysis', userEmail } = req.body || {};

    if (!image) return res.status(400).json({ error: 'No image provided' });

    // Strip trailing slash from URL to prevent "Invalid path" errors
    const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '').trim();
    const supabase = createClient(
      supabaseUrl,
      process.env.SUPABASE_SERVICE_KEY
    );
    console.log('[AI Upload] Using Supabase URL:', supabaseUrl);

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
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

    // List buckets first to verify connection and bucket existence
    const { data: bucketList, error: listError } = await supabase.storage.listBuckets();
    console.log('[AI Upload] Available buckets:', bucketList?.map(b => b.name) || 'none');
    
    if (listError) {
      console.error('[AI Upload] Cannot list buckets:', listError.message);
      return res.status(500).json({ 
        error: 'Storage connection failed: ' + listError.message,
        detail: 'Could not list buckets - check SUPABASE_URL and SUPABASE_SERVICE_KEY'
      });
    }

    const targetBucket = bucketList?.find(b => b.name === 'ai-images');
    if (!targetBucket) {
      console.error('[AI Upload] Bucket ai-images not found. Available:', bucketList?.map(b => b.name));
      return res.status(500).json({ 
        error: 'Bucket "ai-images" does not exist',
        detail: `Available buckets: ${bucketList?.map(b => b.name).join(', ') || 'none'}`,
        availableBuckets: bucketList?.map(b => b.name) || []
      });
    }

    // Upload to Supabase Storage bucket 'ai-images' - use root path
    const { data: uploadData, error: storageError } = await supabase.storage
      .from('ai-images')
      .upload(fileName, buffer, { 
        contentType, 
        cacheControl: '3600', 
        upsert: false 
      });

    if (storageError) {
      console.error('[AI Upload] Storage error:', JSON.stringify(storageError));
      return res.status(500).json({ 
        error: 'Failed to store image: ' + storageError.message,
        detail: storageError.name || 'Storage error',
        fileName,
        contentType,
        bufferSize: buffer.length,
      });
    }

    // Get public URL using the path returned from upload
    const storagePath = uploadData?.path || fileName;

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
