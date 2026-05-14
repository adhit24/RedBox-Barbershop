/**
 * Vercel Serverless — POST /api/ai/analyze
 * Fetches image from ai_uploads, calls OpenAI vision, saves & returns results
 */

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const COMBINED_PROMPT = `You are a professional men's grooming consultant for RedBox Barbershop Indonesia.
Analyze this photo carefully and return ONLY a valid JSON object — no markdown, no explanation, no code block.
Replace ALL example values with real analysis of THIS specific person's face, skin, and hair.

Required JSON structure:
{
  "subject": {
    "gender": "male",
    "age_range": "17-22",
    "ethnicity_visual": "asian|caucasian|african|latin|middle_eastern",
    "face_shape": {
      "type": "oval|round|square|heart|diamond|oblong",
      "confidence": 0.90
    },
    "skin": {
      "type": "combination|oily|dry|normal",
      "tone": "warm_neutral|cool|warm|neutral",
      "undertone": "warm|cool|neutral",
      "concerns": ["slightly_dull", "minor_acne_marks", "mild_dehydration"]
    },
    "hair": {
      "type": "straight|wavy|curly|coily",
      "density": "thin|medium|medium_thick|thick",
      "volume": "low|medium|high",
      "current_length": "short|medium|long",
      "natural_texture": "smooth|soft_wave|coarse"
    }
  },
  "personal_color_analysis": {
    "season": "deep_autumn|bright_spring|cool_summer|deep_winter|warm_autumn|soft_summer",
    "summary_tags": ["warm", "deep", "muted"],
    "best_colors": [
      {"name": "Forest Green", "hex": "#2E4A32", "score": 96},
      {"name": "Navy", "hex": "#1F2A44", "score": 94},
      {"name": "Burgundy", "hex": "#5B1F2A", "score": 91},
      {"name": "Teal", "hex": "#0F4C5C", "score": 90}
    ],
    "okay_colors": [
      {"name": "Olive", "hex": "#6B6F3B"},
      {"name": "Taupe", "hex": "#8A7B70"},
      {"name": "Muted Sage", "hex": "#88907D"}
    ],
    "avoid_colors": [
      {"name": "Pastel Pink", "hex": "#F4C7D9"},
      {"name": "Lavender", "hex": "#D8C7F7"},
      {"name": "Cool Gray", "hex": "#BFC3C8"}
    ]
  },
  "outfit_recommendation": {
    "recommended_styles": [
      {
        "title": "Smart Casual",
        "score": 95,
        "top": "Olive Shirt",
        "bottom": "Cream Trousers",
        "shoes": "Brown Loafers",
        "fit": "Tailored"
      },
      {
        "title": "Korean Casual",
        "score": 93,
        "top": "Teal Overshirt",
        "bottom": "Black Straight Pants",
        "shoes": "White Sneakers",
        "fit": "Relaxed Clean"
      },
      {
        "title": "Semi Formal",
        "score": 90,
        "top": "Navy Blazer",
        "bottom": "Dark Slacks",
        "shoes": "Derby Black",
        "fit": "Structured"
      }
    ],
    "avoid_styles": ["Oversized Neon", "Chaotic Patterns", "Extreme Baggy Fit", "High Contrast Pastel"]
  },
  "eyewear_analysis": {
    "recommended": [
      {"model": "Wayfarer", "score": 94, "material": "Acetate", "frame_color": "Black"},
      {"model": "Korean Metal Frame", "score": 91, "material": "Metal", "frame_color": "Silver"},
      {"model": "Rectangle Frame", "score": 89, "material": "Mixed", "frame_color": "Gunmetal"}
    ],
    "avoid": [
      {"model": "Oversized Square", "reason": "Overwhelms face proportion"},
      {"model": "Tiny Round", "reason": "Imbalanced with face width"}
    ]
  },
  "skin_analysis": {
    "overall_score": 78,
    "concerns": [
      {"type": "Dehydration", "severity": "mild"},
      {"type": "Uneven Tone", "severity": "mild"},
      {"type": "Minor Acne Marks", "severity": "low"}
    ],
    "goals": ["Brighter Skin", "Healthy Glow", "Hydration", "Oil Balance"],
    "routine": {
      "morning": ["Gentle Cleanser", "Hydrating Toner", "Vitamin C Serum", "Moisturizer", "SPF 50"],
      "night": ["Cleanser", "Niacinamide Serum", "Moisturizer", "Spot Treatment"]
    },
    "ingredients": ["Niacinamide", "Hyaluronic Acid", "Vitamin C", "Zinc PCA"]
  },
  "hairstyle_analysis": {
    "recommended_styles": [
      {"name": "Textured Side Part", "score": 96, "maintenance": "medium", "match_reason": "Adds structure to face"},
      {"name": "Korean Comma Hair", "score": 94, "maintenance": "medium", "match_reason": "Balances face shape"},
      {"name": "Two Block", "score": 91, "maintenance": "easy", "match_reason": "Enhances natural texture"},
      {"name": "Classic Taper", "score": 89, "maintenance": "easy", "match_reason": "Clean and professional"}
    ],
    "avoid_styles": [
      {"name": "Bowl Cut", "reason": "Flattens face vertically"},
      {"name": "Extreme Skin Fade", "reason": "Too aggressive for face shape"}
    ],
    "styling_products": ["Matte Clay", "Sea Salt Spray", "Texture Powder"]
  }
}`;

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
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: COMBINED_PROMPT },
            { type: 'image_url', image_url: { url: upload.original_image_url, detail: 'high' } }
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
