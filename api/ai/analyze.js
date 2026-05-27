/**
 * Vercel Serverless — POST /api/ai/analyze
 * Fetches image from ai_uploads, calls OpenAI vision, saves & returns results
 */

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const COMBINED_PROMPT = `You are a men's hair stylist for RedBox Barbershop.
Analyze this photo. Return ONLY valid JSON, no markdown/explanation.

{
  "subject": {
    "face_shape": {"type": "oval|round|square|heart|diamond|oblong"},
    "hair": {
      "type": "straight|wavy|curly|coily",
      "density": "thin|medium|medium_thick|thick",
      "current_length": "short|medium|long",
      "natural_texture": "smooth|soft_wave|coarse"
    }
  },
  "hairstyle_analysis": {
    "recommended_styles": [
      {"name": "Style Name", "score": 95, "match_reason": "Why it fits this face"}
    ],
    "avoid_styles": [
      {"name": "Style Name", "reason": "Why to avoid"}
    ],
    "styling_products": ["Product1", "Product2", "Product3", "Product4"]
  }
}

Rules:
- Return exactly 4 recommended_styles, 5 avoid_styles
- Include variety: Korean, Classic, Modern, Textured styles
- Products: exactly 4 items (clay/paste/spray/powder type)
- All text concise, under 8 words per field
- Replace ALL example values with real analysis of THIS person`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', service: 'AI Analyze' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const startTime = Date.now();

  try {
    const { uploadId, serviceType = 'full_analysis' } = req.body || {};
    if (!uploadId) return res.status(400).json({ error: 'uploadId required' });

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Get image URL from ai_uploads
    const { data: upload, error: fetchError } = await supabase
      .from('ai_uploads')
      .select('id, original_image_url, service_type, status')
      .eq('id', uploadId)
      .single();

    if (fetchError || !upload) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    // Mark as processing
    await supabase
      .from('ai_uploads')
      .update({ status: 'processing' })
      .eq('id', uploadId);

    // Call OpenAI with vision
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: COMBINED_PROMPT },
            { type: 'image_url', image_url: { url: upload.original_image_url, detail: 'low' } }
          ]
        }
      ]
    });

    const rawText = completion.choices[0]?.message?.content || '';
    const tokens = completion.usage?.total_tokens || 0;

    // Parse JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await supabase.from('ai_uploads').update({ status: 'failed', error_message: 'No JSON in response' }).eq('id', uploadId);
      return res.status(500).json({ error: 'AI returned invalid response' });
    }

    const analysisResult = JSON.parse(jsonMatch[0]);
    const processingTime = Date.now() - startTime;

    // Save results
    await supabase.from('ai_results').insert({
      upload_id: uploadId,
      analysis_result: analysisResult,
      model_used: 'gpt-4o-mini',
      tokens_used: tokens,
      processing_time_ms: processingTime
    });

    // Mark upload as completed
    await supabase
      .from('ai_uploads')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', uploadId);

    return res.status(200).json({
      uploadId,
      status: 'completed',
      serviceType,
      results: analysisResult,
      meta: { model: 'gpt-4o-mini', tokens, processingTime }
    });

  } catch (err) {
    console.error('[AI Analyze] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
