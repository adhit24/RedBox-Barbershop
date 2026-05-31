/**
 * Vercel Serverless — POST /api/ai/hairstyle-graphic
 * Generates a single hairstyle analysis graphic image using gpt-image-2 images.edit.
 * Takes the customer's uploaded photo and analysis data, returns one composite graphic.
 * Results are cached in Supabase Storage by uploadId.
 */

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', service: 'AI Hairstyle Graphic' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { uploadId, analysisData } = req.body || {};
    if (!uploadId) return res.status(400).json({ error: 'uploadId required' });

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Cache check — one graphic per uploadId
    const storagePath = `graphics/${uploadId}/hairstyle-graphic.jpg`;
    const { data: fileList } = await supabase.storage
      .from('ai-images')
      .list(`graphics/${uploadId}`, { search: 'hairstyle-graphic.jpg' });

    if (fileList && fileList.length > 0) {
      const { data: { publicUrl } } = supabase.storage.from('ai-images').getPublicUrl(storagePath);
      return res.status(200).json({ imageUrl: publicUrl, cached: true });
    }

    // Fetch original customer photo
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

    // Build analysis context from data
    const a = analysisData || {};
    const faceShape = a.faceShape || 'oval';
    const hairType = a.hairType || 'straight';
    const hairDensity = a.hairDensity || 'medium';
    const hairLength = a.hairLength || 'medium';
    const recs = (a.recs || []).slice(0, 4).map(r => r.name || r).join(', ') || 'Two Block, Korean Comma, Textured Crop, Classic Taper';
    const avoids = (a.avoids || []).slice(0, 2).map(r => r.name || r).join(', ') || 'Bowl Cut, Flat & Limp';

    const prompt = [
      'Create a hairstyle analysis graphic card using this portrait photo as the subject.',
      'The graphic must use a dark background (#080808) with white and green (#9bd448) text.',
      'Layout: LEFT side shows the portrait photo with "FACE SHAPE: ' + faceShape.toUpperCase() + '" label at the bottom.',
      'RIGHT side shows "HAIRSTYLE ANALYSIS" header (large, bold), then these sections:',
      '"BEST HAIR CHARACTERISTICS" with 3 circular icons: Tapered Sides, Volume On Top, Natural Texture.',
      '"HAIR TYPE: ' + hairType.toUpperCase() + '"',
      '"HAIR THICKNESS: ' + hairDensity.toUpperCase() + '" with green filled dots indicator.',
      '"HAIR LENGTH: ' + hairLength.toUpperCase() + '" with a horizontal slider bar.',
      'BOTTOM section: "RECOMMENDED HAIRSTYLES" (green header) showing 4 small portrait-style photo boxes with names: ' + recs + ', each with a green checkmark badge.',
      'Next to it: "HAIRSTYLES TO AVOID" (red header) showing 2 photo boxes: ' + avoids + ', each with a red X badge.',
      'Style: premium barbershop editorial. Clean, minimal, dark. Use the actual person from the uploaded photo as the face in all portrait boxes.',
      'Make it look exactly like a professional hairstyle consultation card. Short labels only, no paragraphs.',
      'Size: wide landscape card (16:9 ratio feel), all elements clearly visible.',
    ].join(' ');

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const editResult = await openai.images.edit({
      model: 'gpt-image-2',
      image: imgFile,
      prompt,
      n: 1,
      size: '1024x1024',
    });

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
      throw new Error('No image data in response');
    }

    // Store in Supabase Storage
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

    // Fallback: return base64
    const b64 = imageBuffer.toString('base64');
    return res.status(200).json({ imageUrl: `data:image/jpeg;base64,${b64}`, cached: false });

  } catch (err) {
    console.error('[AI Hairstyle Graphic] Error:', err.message, err.status || '');
    return res.status(500).json({
      error: err.message || 'Failed to generate graphic',
      detail: err.error?.message || '',
    });
  }
};
