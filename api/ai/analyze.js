/**
 * Vercel Serverless — POST /api/ai/analyze
 * Fetches image from ai_uploads, calls OpenAI vision, saves & returns results
 */

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const COMBINED_PROMPT = `You are RedBox Barbershop's premium AI grooming consultant.
Analyze ONLY what is reasonably visible in this portrait photo.
Return ONLY valid JSON. No markdown, no prose outside JSON.

Use this exact shape:
{
  "subject": {
    "face_shape": {
      "type": "oval|round|square|heart|diamond|oblong",
      "characteristics": ["short trait", "short trait", "short trait", "short trait"]
    },
    "hair": {
      "type": "straight|wavy|curly|coily",
      "density": "thin|medium|medium_thick|thick",
      "current_length": "short|medium|long",
      "natural_texture": "smooth|soft_wave|coarse"
    },
    "skin": {
      "type": "oily|combination|normal|dry|sensitive",
      "undertone": "warm|neutral|cool",
      "notes": ["short note", "short note"]
    }
  },
  "personal_color_analysis": {
    "season": "Warm Autumn",
    "keywords": ["short keyword", "short keyword", "short keyword"],
    "best_colors": [
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"}
    ],
    "okay_colors": [
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"}
    ],
    "avoid_colors": [
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"}
    ]
  },
  "outfit_recommendation": {
    "faceShape": "Oval",
    "faceShapeDescription": "short sentence",
    "recommended_styles": [
      {"name": "style name", "occasion": "occasion", "why_it_works": "short reason"},
      {"name": "style name", "occasion": "occasion", "why_it_works": "short reason"},
      {"name": "style name", "occasion": "occasion", "why_it_works": "short reason"},
      {"name": "style name", "occasion": "occasion", "why_it_works": "short reason"}
    ],
    "fit_guidance": {
      "recommended": ["short tip", "short tip"],
      "avoid": ["short tip", "short tip"]
    }
  },
  "eyewear_analysis": {
    "recommended": [
      {"name": "frame name", "category": "category", "why_it_suits": "short reason"},
      {"name": "frame name", "category": "category", "why_it_suits": "short reason"},
      {"name": "frame name", "category": "category", "why_it_suits": "short reason"},
      {"name": "frame name", "category": "category", "why_it_suits": "short reason"}
    ],
    "avoid": [
      {"name": "frame name", "reason": "short reason"},
      {"name": "frame name", "reason": "short reason"},
      {"name": "frame name", "reason": "short reason"},
      {"name": "frame name", "reason": "short reason"}
    ],
    "sports_recommended": [
      {"name": "sport frame", "why_it_suits": "short reason"},
      {"name": "sport frame", "why_it_suits": "short reason"},
      {"name": "sport frame", "why_it_suits": "short reason"},
      {"name": "sport frame", "why_it_suits": "short reason"}
    ],
    "sports_avoid": [
      {"name": "sport frame", "reason": "short reason"},
      {"name": "sport frame", "reason": "short reason"},
      {"name": "sport frame", "reason": "short reason"},
      {"name": "sport frame", "reason": "short reason"}
    ]
  },
  "skin_analysis": {
    "type": "oily|combination|normal|dry|sensitive",
    "concerns": [
      {"type": "concern", "severity": "low|medium|high", "tip": "short tip"},
      {"type": "concern", "severity": "low|medium|high", "tip": "short tip"},
      {"type": "concern", "severity": "low|medium|high", "tip": "short tip"}
    ],
    "goals": ["goal", "goal", "goal", "goal", "goal", "goal"],
    "routine": {
      "morning": ["step", "step", "step", "step", "step"],
      "night": ["step", "step", "step", "step", "step"]
    },
    "ingredients": ["ingredient", "ingredient", "ingredient", "ingredient", "ingredient"]
  },
  "hairstyle_analysis": {
    "recommended_styles": [
      {"name": "style name", "score": 95, "match_reason": "short reason"},
      {"name": "style name", "score": 92, "match_reason": "short reason"},
      {"name": "style name", "score": 89, "match_reason": "short reason"},
      {"name": "style name", "score": 86, "match_reason": "short reason"}
    ],
    "avoid_styles": [
      {"name": "style name", "reason": "short reason"},
      {"name": "style name", "reason": "short reason"},
      {"name": "style name", "reason": "short reason"},
      {"name": "style name", "reason": "short reason"}
    ],
    "styling_products": ["product", "product", "product", "product"],
    "styling_steps": ["step", "step", "step", "step"],
    "barber_tip": "one short actionable sentence",
    "hair_color_recommendations": [
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"},
      {"name": "color name", "hex": "#AABBCC"}
    ],
    "maintenance_tips": ["tip", "tip", "tip", "tip"]
  }
}

Rules:
- Use concise Indonesian-friendly labels but keep JSON keys in English exactly as written.
- Return exactly the requested item counts for each list.
- Do not invent medical certainty. Base the answer on visible cues only.
- Keep each reason/tip under 12 words when possible.
- Make hairstyle recommendations varied across classic, modern, textured, and clean options.
- Replace every example value with an actual analysis of this person.`;

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

    // Fetch image as base64 for OpenAI Vision API
    const imgRes = await fetch(upload.original_image_url);
    if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status} ${imgRes.statusText}`);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const imgBase64 = imgBuffer.toString('base64');
    const imgUrl = upload.original_image_url.toLowerCase();
    const mimeType = imgUrl.includes('png') ? 'image/png' : 'image/jpeg';

    // Call OpenAI with vision using base64 image directly (faster & avoids download timeouts
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      max_tokens: 2500,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: COMBINED_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imgBase64}`, detail: 'low' }
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
      model_used: 'gpt-4.1-mini',
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
      meta: { model: 'gpt-4.1-mini', tokens, processingTime }
    });

  } catch (err) {
    console.error('[AI Analyze] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
