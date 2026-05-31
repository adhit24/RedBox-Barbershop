/**
 * Vercel Serverless — POST /api/ai/hairstyle
 * mode='graphic' -> single analysis graphic card
 * mode unset     -> individual hairstyle simulation
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
    const { uploadId, hairstyleName, hairstyleDescription, mode, analysisData } = req.body || {};
    const isGraphic = mode === 'graphic';

    if (!uploadId) return res.status(400).json({ error: 'uploadId required' });
    if (!isGraphic && !hairstyleName) return res.status(400).json({ error: 'hairstyleName required' });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    let storagePath, cacheFolder, cacheFile;
    if (isGraphic) {
      storagePath = `graphics/${uploadId}/hairstyle-graphic.jpg`;
      cacheFolder = `graphics/${uploadId}`;
      cacheFile   = 'hairstyle-graphic.jpg';
    } else {
      const safeName = hairstyleName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      storagePath = `hairstyles/${uploadId}/${safeName}.jpg`;
      cacheFolder = `hairstyles/${uploadId}`;
      cacheFile   = `${safeName}.jpg`;
    }

    const { data: fileList } = await supabase.storage.from('ai-images').list(cacheFolder, { search: cacheFile });
    if (fileList && fileList.length > 0) {
      const { data: { publicUrl } } = supabase.storage.from('ai-images').getPublicUrl(storagePath);
      return res.status(200).json({ imageUrl: publicUrl, cached: true });
    }

    const { data: upload, error: fetchError } = await supabase
      .from('ai_uploads').select('original_image_url').eq('id', uploadId).single();
    if (fetchError || !upload?.original_image_url) return res.status(404).json({ error: 'Upload not found' });

    const imgRes = await fetch(upload.original_image_url);
    if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    const imgUrl   = upload.original_image_url.toLowerCase();
    const isPng    = imgUrl.includes('.png');
    const mimeType = isPng ? 'image/png' : 'image/jpeg';
    const imgFile  = new File([imgBuffer], isPng ? 'photo.png' : 'photo.jpg', { type: mimeType });

    let prompt;
    if (isGraphic) {
      const a = analysisData || {};
      const faceShape   = (a.faceShape   || 'oval').toUpperCase();
      const hairType    = (a.hairType    || 'straight').toUpperCase();
      const hairDensity = (a.hairDensity || 'medium').toUpperCase();
      const hairLength  = (a.hairLength  || 'medium').toUpperCase();
      const recs   = (a.recs   || []).slice(0, 4).map(r => r.name || r).join(', ') || 'Two Block, Korean Comma, Textured Crop, Classic Taper';
      const avoids = (a.avoids || []).slice(0, 2).map(r => r.name || r).join(', ') || 'Bowl Cut, Flat & Limp';
      prompt = `Create a detailed hairstyle analysis graphic card using this portrait photo as the subject. Dark background #080808 with white and green #9bd448 text, premium barbershop style. TOP: "HAIRSTYLE ANALYSIS" as bold header. LEFT TOP: portrait photo with FACE SHAPE label (e.g., OVAL) and face shape outline. RIGHT TOP: "BEST HAIR CHARACTERISTICS" with 3 icon circles: Tapered Sides, Volume on Top, Natural Texture; then HAIR TYPE (e.g., STRAIGHT / SLIGHTLY WAVE), HAIR THICKNESS with dot indicators, HAIR LENGTH with slider from SHORT to MEDIUM to LONG. MIDDLE: RECOMMENDED HAIRSTYLES (green title) with 4 images of the subject with checkmark badges: ${recs}; HAIRSTYLES TO AVOID (red title) with 2 images of the subject with X badges: ${avoids}. BOTTOM LEFT: STYLING GUIDE with icons (blow dry, apply product, style & shape, finish hairspray); KEY TIPS with 4 icons (keep sides tapered, add texture for volume, avoid heavy fringe, regular trim every 4-6 weeks). BOTTOM RIGHT: RECOMMENDED PRODUCTS with 4 product bottles (matte clay, styling paste, sea salt spray, volume powder); HAIR COLOR SUGGESTION with 5 circular color swatches (natural black, dark brown, ash brown, light brown, ash gray). High quality, professional barbershop editorial graphic.`;
    } else {
      prompt = [
        `Change ONLY the hairstyle of this man to: "${hairstyleName}".`,
        hairstyleDescription ? `Hair description: ${hairstyleDescription}.` : '',
        'Preserve the exact same customer identity. Keep face, skin tone, features, expression, ethnicity, clothing unchanged.',
        'Only modify the hair. Realistic photo. Professional barbershop editorial lighting.',
      ].filter(Boolean).join(' ');
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const editResult = await openai.images.edit({ model: 'gpt-image-2', image: imgFile, prompt, n: 1, size: '1024x1024' });

    const item = editResult.data?.[0];
    if (!item) throw new Error('No image returned from OpenAI');

    let imageBuffer;
    if (item.b64_json) {
      imageBuffer = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      const urlRes = await fetch(item.url);
      if (!urlRes.ok) throw new Error('Failed to fetch generated image URL');
      imageBuffer = Buffer.from(await urlRes.arrayBuffer());
    } else {
      throw new Error('OpenAI returned no image data');
    }

    const { error: storeError } = await supabase.storage.from('ai-images')
      .upload(storagePath, imageBuffer, { contentType: 'image/jpeg', cacheControl: '86400', upsert: true });

    if (storeError) {
      return res.status(200).json({ imageUrl: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`, cached: false });
    }

    const { data: { publicUrl } } = supabase.storage.from('ai-images').getPublicUrl(storagePath);
    return res.status(200).json({ imageUrl: publicUrl, cached: false });

  } catch (err) {
    console.error('[AI Hairstyle] Error:', err.message, err.status || '');
    return res.status(500).json({ error: err.message || 'Failed to generate hairstyle image', detail: err.error?.message || '' });
  }
};