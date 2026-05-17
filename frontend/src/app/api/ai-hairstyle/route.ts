import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const REDBOX_PRODUCTS = [
  { id: 'clay-80', name: 'RedBox Clay 80g', type: 'clay', hold: 'light', base: 'water', size: '80g', emoji: '🪨', shopeeUrl: 'https://id.shp.ee/9ommEZPf' },
  { id: 'water-base-80', name: 'RedBox Water Base Pomade 80g', type: 'pomade', hold: 'light', base: 'water', size: '80g', emoji: '💧', shopeeUrl: 'https://id.shp.ee/9ommEZPf' },
  { id: 'water-base-30', name: 'RedBox Water Base Pomade 30g', type: 'pomade', hold: 'light', base: 'water', size: '30g', emoji: '💧', shopeeUrl: 'https://id.shp.ee/9ommEZPf' },
  { id: 'oil-base-80', name: 'RedBox Oil Base Pomade 80g', type: 'pomade', hold: 'light', base: 'oil', size: '80g', emoji: '✨', shopeeUrl: 'https://id.shp.ee/9ommEZPf' },
  { id: 'oil-base-30', name: 'RedBox Oil Base Pomade 30g', type: 'pomade', hold: 'light', base: 'oil', size: '30g', emoji: '✨', shopeeUrl: 'https://id.shp.ee/9ommEZPf' },
  { id: 'parfum-eleft', name: 'W-Mate E Left Heree 30ml', type: 'parfum', hold: null, base: null, size: '30ml', emoji: '🌿', shopeeUrl: 'https://id.shp.ee/9ommEZPf' },
  { id: 'parfum-psyhi', name: 'W-Mate Psyhi 30ml', type: 'parfum', hold: null, base: null, size: '30ml', emoji: '🍊', shopeeUrl: 'https://id.shp.ee/9ommEZPf' },
];

function getRecommendedProducts(faceShape: string, texture: string, density: string) {
  const products = [];
  if (texture === 'straight' || texture === 'wavy') {
    products.push(REDBOX_PRODUCTS.find(p => p.id === 'clay-80')!);
    products.push(REDBOX_PRODUCTS.find(p => p.id === 'water-base-80')!);
  } else {
    products.push(REDBOX_PRODUCTS.find(p => p.id === 'oil-base-80')!);
    products.push(REDBOX_PRODUCTS.find(p => p.id === 'water-base-80')!);
  }
  products.push(REDBOX_PRODUCTS.find(p => p.id === 'parfum-eleft')!);
  void faceShape; void density;
  return products.filter(Boolean);
}

const SYSTEM_PROMPT = `You are a professional barber. Analyze this portrait and return ONLY valid JSON, no markdown, no extra text:

{
  "currentHair": {
    "texture": "straight|wavy|curly|coily",
    "density": "thin|medium|thick",
    "length": "short|medium|long",
    "currentStyle": "5 words max"
  },
  "faceShape": "oval|round|square|heart|diamond|oblong|triangle",
  "recommendations": [
    {
      "rank": 1,
      "category": "Korean|Classic|Modern Fade|Versatile|Textured",
      "name": "Hairstyle Name",
      "description": "10 words max",
      "whyItSuits": "8 words max",
      "maintenanceLevel": "low|medium|high",
      "maintenanceFrequency": "Every X weeks",
      "stylingTime": "X min daily",
      "suitabilityScore": 90
    }
  ],
  "avoidHairstyles": [
    { "style": "Name", "reason": "8 words max", "category": "Shape|Proportion|Feature Issue" }
  ],
  "barberTip": "One sentence for barber"
}

Return exactly 4 recommendations and 3 avoidHairstyles. All text concise. No extra fields.`;

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 500 });
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const formData = await req.formData();
    const imageFile = formData.get('image') as File;

    if (!imageFile) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    if (!imageFile.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
    }

    if (imageFile.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large (max 5MB)' }, { status: 400 });
    }

    const bytes = await imageFile.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');
    const mimeType = imageFile.type;
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: 'low',
              },
            },
          ],
        },
      ],
    });

    const rawText = response.choices[0]?.message?.content || '';

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    const result = JSON.parse(jsonMatch[0]);

    const recommendedProducts = getRecommendedProducts(
      result.faceShape || '',
      result.currentHair?.texture || '',
      result.currentHair?.density || ''
    );

    return NextResponse.json({
      success: true,
      data: { ...result, recommendedProducts },
      tokens_used: response.usage?.total_tokens || 0,
    });
  } catch (error: unknown) {
    console.error('AI Hairstyle API error:', error);

    if (error instanceof OpenAI.APIError) {
      if (error.status === 429) {
        return NextResponse.json({ error: 'API quota exceeded. Please try again later.' }, { status: 429 });
      }
      return NextResponse.json({ error: error.message }, { status: error.status || 500 });
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
