/**
 * Vercel Serverless — POST /api/ai/generate-image
 * Generates a generic image from a text prompt using gpt-image-2.
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
    const { prompt, cacheKey } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const supabaseUrl = (process.env.SUPABASE_URL || '')
      .trim()
      .replace(/\/rest\/v1\/?$/, '')
      .replace(/\/rest\/?$/, '')
      .replace(/\/+$/, '');
    const supabase = createClient(
      supabaseUrl,
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

    const result = await openai.images.generate({
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size: '1024x1024',
    });

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
