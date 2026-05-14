/**
 * Vercel Serverless — POST /api/ai/hairstyle
 * Generates a hairstyle simulation image using the user's original photo + gpt-image-2
 * One image per call; frontend calls this progressively for each hairstyle card.
 */

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', service: 'AI Hairstyle' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { uploadId, hairstyleName, hairstyleDescription, slotKey } = req.body || {};

    if (!uploadId || !hairstyleName) {
      return res.status(400).json({ error: 'uploadId and hairstyleName required' });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Cache key in Supabase Storage
    const safeName = hairstyleName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const storagePath = `hairstyles/${uploadId}/${safeName}.jpg`;

    // Return cached image if already generated
    const { data: fileList } = await supabase.storage
      .from('ai-images')
      .list(`hairstyles/${uploadId}`, { search: `${safeName}.jpg` });

    if (fileList && fileList.length > 0) {
      const { data: { publicUrl } } = supabase.storage.from('ai-images').getPublicUrl(storagePath);
      return res.status(200).json({ imageUrl: publicUrl, cached: true, slotKey });
    }

    // Fetch user's original image URL
    const { data: upload, error: fetchError } = await supabase
      .from('ai_uploads')
      .select('original_image_url')
      .eq('id', uploadId)
      .single();

    if (fetchError || !upload) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    // Download original image as buffer
    const imgRes = await fetch(upload.original_image_url);
    if (!imgRes.ok) throw new Error('Failed to fetch original image');
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    // Wrap buffer as File using openai's toFile helper
    const { toFile } = require('openai');
    const imgFile = await toFile(imgBuffer, 'photo.jpg', { type: 'image/jpeg' });

    // Build prompt — keep face, change only hair
    const descPart = hairstyleDescription ? `, styled as: ${hairstyleDescription}` : '';
    const prompt = `Realistic portrait photo. Change ONLY the hairstyle of the person in the image to "${hairstyleName}"${descPart}. Keep the face, skin tone, facial features, expression, and clothing completely unchanged. Only the hair changes. Professional barbershop editorial lighting, sharp detail, clean neutral background.`;

    // Generate with gpt-image-2 edit
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const result = await openai.images.edit({
      model: 'gpt-image-2',
      image: imgFile,
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    });

    const b64 = result.data[0]?.b64_json;
    if (!b64) throw new Error('No image data returned from OpenAI');

    const imageBuffer = Buffer.from(b64, 'base64');

    // Store in Supabase Storage for caching
    const { error: storeError } = await supabase.storage
      .from('ai-images')
      .upload(storagePath, imageBuffer, {
        contentType: 'image/jpeg',
        cacheControl: '86400',
        upsert: true,
      });

    if (storeError) {
      // Fallback: return base64 data URL if storage fails
      return res.status(200).json({
        imageUrl: `data:image/jpeg;base64,${b64}`,
        cached: false,
        slotKey,
      });
    }

    const { data: { publicUrl } } = supabase.storage.from('ai-images').getPublicUrl(storagePath);
    return res.status(200).json({ imageUrl: publicUrl, cached: false, slotKey });

  } catch (err) {
    console.error('[AI Hairstyle] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to generate hairstyle image' });
  }
};
