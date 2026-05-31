/**
 * Vercel Serverless — POST /api/ai/hairstyle
 * Generates hairstyle simulation using gpt-image-2 images.edit
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
    const { uploadId, hairstyleName, hairstyleDescription } = req.body || {};
    if (!uploadId || !hairstyleName) {
      return res.status(400).json({ error: 'uploadId and hairstyleName required' });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Cache check
    const safeName = hairstyleName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const storagePath = `hairstyles/${uploadId}/${safeName}.jpg`;

    const { data: fileList } = await supabase.storage
      .from('ai-images')
      .list(`hairstyles/${uploadId}`, { search: `${safeName}.jpg` });

    if (fileList && fileList.length > 0) {
      const { data: { publicUrl } } = supabase.storage.from('ai-images').getPublicUrl(storagePath);
      return res.status(200).json({ imageUrl: publicUrl, cached: true });
    }

    // Fetch original image
    const { data: upload, error: fetchError } = await supabase
      .from('ai_uploads')
      .select('original_image_url')
      .eq('id', uploadId)
      .single();

    if (fetchError || !upload) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const imgRes = await fetch(upload.original_image_url);
    if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    // Detect content type from URL or default to jpeg
    const imgUrl = upload.original_image_url;
    const isPng = imgUrl.toLowerCase().includes('.png');
    const mimeType = isPng ? 'image/png' : 'image/jpeg';
    const fileName = isPng ? 'photo.png' : 'photo.jpg';

    // Use native File (Node.js 20+, Vercel Node 24)
    const imgFile = new File([imgBuffer], fileName, { type: mimeType });

    const prompt = [
      `Change ONLY the hairstyle of this man to: "${hairstyleName}".`,
      hairstyleDescription ? `Hair description: ${hairstyleDescription}.` : '',
      'Preserve the exact same customer identity from the uploaded photo.',
      'Keep the face, skin tone, facial features, expression, age, ethnicity, and all clothing completely unchanged.',
      'Do not swap the person, do not beautify into another model, and do not alter facial proportions.',
      'Only modify the hair on top of the head.',
      'Realistic photo. Professional barbershop editorial lighting.',
    ].filter(Boolean).join(' ');

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // gpt-image-2 edit — no response_format param (returns b64_json by default)
    const editResult = await openai.images.edit({
      model: 'gpt-image-2',
      image: imgFile,
      prompt,
      n: 1,
      size: '1024x1024',
    });

    const item = editResult.data?.[0];
    if (!item) throw new Error('No image item returned from OpenAI');

    // gpt-image-2 returns b64_json; fall back to url if present
    let imageBuffer;

    if (item.b64_json) {
      imageBuffer = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      // Fetch from temporary URL and store in Supabase
      const urlRes = await fetch(item.url);
      if (!urlRes.ok) throw new Error('Failed to fetch generated image URL');
      imageBuffer = Buffer.from(await urlRes.arrayBuffer());
    } else {
      throw new Error('OpenAI returned no image data');
    }

    // Upload to Supabase Storage
    const { error: storeError } = await supabase.storage
      .from('ai-images')
      .upload(storagePath, imageBuffer, {
        contentType: 'image/jpeg',
        cacheControl: '86400',
        upsert: true,
      });

    if (storeError) {
      // Return base64 inline if storage fails
      const b64Fallback = imageBuffer.toString('base64');
      return res.status(200).json({
        imageUrl: `data:image/jpeg;base64,${b64Fallback}`,
        cached: false,
      });
    }

    const { data: { publicUrl } } = supabase.storage.from('ai-images').getPublicUrl(storagePath);
    return res.status(200).json({ imageUrl: publicUrl, cached: false });

  } catch (err) {
    console.error('[AI Hairstyle] Error:', err.message, err.status || '');
    // Return structured error so frontend can display it
    return res.status(500).json({
      error: err.message || 'Failed to generate hairstyle image',
      detail: err.error?.message || '',
    });
  }
};
