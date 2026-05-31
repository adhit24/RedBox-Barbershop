/**
 * Vercel Serverless — POST /api/ai/generate-image
 * Generates an image from a text prompt using gpt-image-2.
 * If uploadId is provided, uses the customer's original photo as identity reference
 * and performs an image edit so the generated face stays the same person.
 * Results are cached in Supabase Storage by cacheKey.
 */

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', service: 'AI Generate Image' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, cacheKey, uploadId } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Cache check
    const safeKey = (cacheKey || '').toLowerCase().replace(/[^a-z0-9/\-]+/g, '-').slice(0, 120);
    const storagePath = `generated/${safeKey}.jpg`;

    if (safeKey) {
      const dir = storagePath.split('/').slice(0, -1).join('/');
      const file = storagePath.split('/').pop();
      const { data: fileList } = await supabase.storage
        .from('ai-images')
        .list(dir, { search: file });

      if (fileList && fileList.length > 0) {
        const { data: { publicUrl } } = supabase.storage.from('ai-images').getPublicUrl(storagePath);
        return res.status(200).json({ imageUrl: publicUrl, cached: true });
      }
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let result;
    if (uploadId) {
      const { data: upload, error: uploadError } = await supabase
        .from('ai_uploads')
        .select('original_image_url')
        .eq('id', uploadId)
        .single();

      if (uploadError || !upload?.original_image_url) {
        return res.status(404).json({ error: 'Upload not found' });
      }

      const imgRes = await fetch(upload.original_image_url);
      if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`);
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

      const imgUrl = upload.original_image_url.toLowerCase();
      const isPng = imgUrl.includes('.png');
      const mimeType = isPng ? 'image/png' : 'image/jpeg';
      const fileName = isPng ? 'photo.png' : 'photo.jpg';
      const imgFile = new File([imgBuffer], fileName, { type: mimeType });

      const identityPrompt = [
        'Use the uploaded customer photo as the identity reference.',
        'Create a photorealistic grooming visualization of the SAME man.',
        'Preserve the exact face, skin tone, age, ethnicity, facial features, expression, and overall identity.',
        'Do not replace him with another model or change his face.',
        'Keep the result realistic, premium, and suitable for a RedBox grooming consultation.',
        prompt,
      ].join(' ');

      result = await openai.images.edit({
        model: 'gpt-image-2',
        image: imgFile,
        prompt: identityPrompt,
        n: 1,
        size: '1024x1024',
      });
    } else {
      result = await openai.images.generate({
        model: 'gpt-image-2',
        prompt,
        n: 1,
        size: '1024x1024',
      });
    }

    const item = result.data?.[0];
    if (!item) throw new Error('No image returned from OpenAI');

    let imageBuffer;
    if (item.b64_json) {
      imageBuffer = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      const urlRes = await fetch(item.url);
      if (!urlRes.ok) throw new Error('Failed to fetch generated image URL');
      imageBuffer = Buffer.from(await urlRes.arrayBuffer());
    } else {
      throw new Error('No image data in response');
    }

    if (safeKey) {
      const { error: storeError } = await supabase.storage
        .from('ai-images')
        .upload(storagePath, imageBuffer, {
          contentType: 'image/jpeg',
          cacheControl: '86400',
          upsert: true,
        });

      if (!storeError) {
        const { data: { publicUrl } } = supabase.storage.from('ai-images').getPublicUrl(storagePath);
        return res.status(200).json({ imageUrl: publicUrl, cached: false });
      }
    }

    // Fallback: return base64 inline
    const b64 = imageBuffer.toString('base64');
    return res.status(200).json({ imageUrl: `data:image/jpeg;base64,${b64}`, cached: false });

  } catch (err) {
    console.error('[AI Generate Image] Error:', err.message, err.status || '');
    return res.status(500).json({
      error: err.message || 'Failed to generate image',
      detail: err.error?.message || '',
    });
  }
};
