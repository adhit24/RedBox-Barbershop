import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a professional barber and hair stylist with 15+ years of experience specializing in men's grooming. 

Analyze the provided portrait image and return ONLY a valid JSON object with exactly this structure — no markdown, no explanation, no extra text:

{
  "face_shape": "string (Oval/Round/Square/Heart/Diamond/Oblong/Triangle)",
  "hair_type": "string (e.g. Straight / Slightly Wavy)",
  "hair_thickness": "string (Thin/Medium/Thick)",
  "hair_density": "string (Low/Medium/High)",
  "current_hair_condition": "string (brief description)",
  "recommended_hairstyles": ["array of 4-5 hairstyle names"],
  "avoid_hairstyles": ["array of 2-3 hairstyle names to avoid"],
  "styling_tips": ["array of 3-4 actionable tips"],
  "recommended_products": ["array of 2-3 product types"],
  "recommended_hair_colors": ["array of 2-3 color options"],
  "barber_instruction": "string (one sentence to tell your barber)",
  "confidence_score": number (0-100)
}

Rules:
- Analyze only hair and face shape — do NOT comment on identity, race, or personal appearance beyond hair
- Be specific and practical
- Keep all text concise, 5 words max per item in arrays
- Return ONLY the JSON, nothing else`;

export async function POST(req: NextRequest) {
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
      max_tokens: 800,
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

    return NextResponse.json({
      success: true,
      data: result,
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
