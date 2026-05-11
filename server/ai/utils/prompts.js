/**
 * AI Prompts Templates
 * Prompts untuk GPT-4 Vision dan DALL-E 3
 */

const PROMPTS = {
  
  // ==========================================
  // 1. FACE ANALYSIS
  // ==========================================
  faceAnalysis: `
Anda adalah profesional grooming consultant dengan keahlian dalam analisis wajah dan gaya pria.

Analisis foto wajah ini dan berikan output dalam format JSON berikut:

{
  "faceShape": "oval|round|square|heart|diamond|oblong|triangle",
  "confidence": 0.85,
  "analysis": {
    "forehead": "deskripsi dahi",
    "cheekbones": "deskripsi tulang pipi",
    "jawline": "deskripsi rahang",
    "chin": "deskripsi dagu"
  },
  "skin": {
    "tone": "fair|light|medium|olive|brown|dark",
    "undertone": "warm|cool|neutral",
    "texture": "smooth|normal|oily|dry|combination"
  },
  "hair": {
    "texture": "straight|wavy|curly|coily",
    "density": "thin|medium|thick",
    "currentStyle": "deskripsi gaya rambut saat ini"
  },
  "recommendations": {
    "haircuts": [
      {
        "name": "nama potongan",
        "why": "alasan cocok",
        "maintenance": "low|medium|high"
      }
    ],
    "beardStyles": [
      {
        "name": "nama gaya jenggot",
        "suitability": "deskripsi"
      }
    ],
    "groomingTips": ["tip 1", "tip 2", "tip 3"]
  }
}

Berikan analisis yang detail dan spesifik untuk pria Indonesia. Fokus pada bentuk wajah yang paling cocok untuk berbagai gaya rambut modern seperti Korean style, Gentleman look, dan Classic barbershop cuts.
`,

  // ==========================================
  // 2. HAIRSTYLE RECOMMENDATION
  // ==========================================
  hairstyleRecommendation: (preferences) => `
Anda adalah hair stylist profesional dengan spesialisasi dalam tren rambut pria modern.

Berdasarkan foto wajah dan analisis fitur ini, rekomendasikan 3 gaya rambut terbaik.

Preferensi user: ${preferences.style || 'modern, versatile'}
Usia range: ${preferences.ageRange || '25-35'}
Gaya hidup: ${preferences.lifestyle || 'professional'}

Output format JSON:

{
  "recommendations": [
    {
      "rank": 1,
      "name": "nama gaya rambut",
      "category": "korean|gentleman|classic|modern|casual",
      "description": "deskripsi detail gaya",
      "whyItSuits": "penjelasan mengapa cocok dengan bentuk wajah",
      "faceShapes": ["oval", "round", "square"],
      "maintenance": {
        "level": "low|medium|high",
        "frequency": "setiap berapa minggu potong ulang",
        "products": ["produk rekomendasi 1", "produk 2"],
        "stylingTime": "berapa menit setiap pagi"
      },
      "variations": ["variasi 1", "variasi 2"],
      "confidence": 0.92
    }
  ],
  "generalAdvice": "tips umum perawatan rambut",
  "avoidStyles": ["gaya yang tidak cocok 1", "gaya 2"]
}

Berikan rekomendasi yang realistis dan sesuai dengan tren 2024-2025 di Indonesia.
`,

  // ==========================================
  // 3. OUTFIT RECOMMENDATION
  // ==========================================
  outfitRecommendation: (occasion, season) => `
Anda adalah fashion stylist profesional dengan keahlian dalam gaya pria modern.

Analisis foto ini dan rekomendasikan outfit yang paling cocok.

Konteks:
- Occasion: ${occasion || 'casual daily wear'}
- Season: ${season || 'tropical/all-season'}
- Style preference: smart casual, modern, comfortable

Output format JSON:

{
  "colorAnalysis": {
    "skinTone": "warm|cool|neutral",
    "bestColors": ["warna 1", "warna 2", "warna 3"],
    "colorsToAvoid": ["warna tidak cocok"],
    "neutralBase": ["hitam", "navy", "putih", "grey"]
  },
  "outfitRecommendations": [
    {
      "rank": 1,
      "name": "nama outfit",
      "occasion": "formal|semi-formal|casual|street",
      "top": {
        "item": "deskripsi atasan",
        "color": "warna spesifik",
        "fabric": "bahan rekomendasi"
      },
      "bottom": {
        "item": "deskripsi bawahan",
        "color": "warna spesifik",
        "fit": "slim|regular|relaxed"
      },
      "shoes": "rekomendasi sepatu",
      "accessories": ["aksesoris 1", "aksesoris 2"],
      "whyItWorks": "penjelasan harmoni warna dan style"
    }
  ],
  "styleIdentity": {
    "archetype": "The Modern Gentleman|Urban Creative|Minimalist|Classic",
    "keywords": ["kata kunci 1", "kata kunci 2"],
    "brands": ["brand lokal 1", "brand internasional 1"]
  },
  "shoppingList": {
    "essential": ["item wajib 1", "item 2"],
    "optional": ["item tambahan 1", "item 2"],
    "estimatedBudget": "range harga IDR"
  }
}

Fokus pada merek yang tersedia di Indonesia dan gaya yang nyaman untuk iklim tropis.
`,

  // ==========================================
  // 4. AI PREVIEW / MAKEOVER (DALL-E 3)
  // ==========================================
  previewGeneration: (analysis, transformationType) => {
    const transformations = {
      modern_gentleman: 'Modern gentleman look with clean fade haircut, well-groomed beard, wearing smart casual navy blazer with white shirt',
      korean_style: 'Korean oppa style with textured two-block haircut, clear skin, wearing oversized sweater with modern streetwear vibe',
      professional: 'Corporate professional with classic side part haircut, clean shaven or light stubble, wearing tailored suit',
      casual_cool: 'Relaxed casual style with messy textured hair, wearing premium t-shirt with minimalist jacket',
      classic_barber: 'Traditional barbershop look with pompadour or slick back, clean fade, wearing vintage leather jacket'
    };

    return `
Professional makeover portrait photo.

Subject: Man with ${analysis.faceShape} face shape, ${analysis.skinTone} skin tone, ${analysis.hairTexture} hair texture.

Transformation: ${transformations[transformationType] || transformations.modern_gentleman}

Style requirements:
- Photorealistic, high quality portrait
- Studio lighting, soft shadows
- Neutral grey or gradient background
- Professional photography style
- Before/After comparison layout (split image)
- Same person, different styling
- Consistent facial features and expression
- Age-appropriate styling (no drastic age change)

Output: High-resolution portrait suitable for professional grooming consultation preview.
`;
  },

  // ==========================================
  // 5. COMBINED ANALYSIS (All-in-one)
  // ==========================================
  combinedAnalysis: `
Anda adalah AI grooming consultant premium untuk Redbox Barbershop.

Analisis foto ini dan berikan rekomendasi komprehensif:

1. FACE ANALYSIS
2. HAIRSTYLE RECOMMENDATIONS (top 3)
3. OUTFIT SUGGESTIONS (for different occasions)
4. GROOMING TIPS

Output format JSON:

{
  "analysis": {
    "faceShape": "...",
    "skinTone": "...",
    "features": { ... }
  },
  "hair": {
    "currentStyle": "...",
    "texture": "...",
    "recommendations": [ ... ]
  },
  "style": {
    "colorPalette": [ ... ],
    "outfits": [ ... ],
    "brands": [ ... ]
  },
  "grooming": {
    "routine": [ ... ],
    "products": [ ... ]
  },
  "confidence": 0.88
}
`,

  // ==========================================
  // 6. PERSONAL COLOR ANALYSIS (Visual Infographic)
  // ==========================================
  personalColorAnalysis: `
You are a professional color analyst and fashion stylist.

Analyze this portrait and return a JSON for rendering a visual personal color infographic.

Tasks:
- Determine the subject's skin undertone (warm/cool/neutral) from their complexion, veins, and features
- Identify their personal color season (Spring/Summer/Autumn/Winter)
- List 6 BEST clothing colors that flatter them with hex codes and short labels
- List 4 WORST colors to avoid with hex codes and short labels
- Give a short skin analysis: skin type (oily/dry/combination/normal), tone, texture notes

Output JSON format:
{
  "skinAnalysis": {
    "tone": "fair|light|medium|olive|brown|dark",
    "undertone": "warm|cool|neutral",
    "type": "oily|dry|combination|normal",
    "texture": "smooth|uneven|acne-prone|normal",
    "notes": "1-sentence observation"
  },
  "colorSeason": "Spring|Summer|Autumn|Winter",
  "colorSeasonDescription": "1-sentence why",
  "bestColors": [
    { "name": "Navy Blue", "hex": "#1B3A6B", "label": "Power & Trust" },
    { "name": "Warm White", "hex": "#FAF0E6", "label": "Fresh & Clean" },
    { "name": "Olive Green", "hex": "#6B7B3A", "label": "Natural Harmony" },
    { "name": "Terracotta", "hex": "#C17D5A", "label": "Warmth & Depth" },
    { "name": "Camel", "hex": "#C19A6B", "label": "Sophisticated" },
    { "name": "Burgundy", "hex": "#800020", "label": "Bold Statement" }
  ],
  "avoidColors": [
    { "name": "Neon Yellow", "hex": "#FFFF00", "label": "Washes Out" },
    { "name": "Icy Pink", "hex": "#FFB6C1", "label": "Clashes Undertone" },
    { "name": "Bright Orange", "hex": "#FF6600", "label": "Overpowers" },
    { "name": "Cool Grey", "hex": "#A9A9A9", "label": "Dulls Complexion" }
  ],
  "outfitFormula": "e.g. Navy top + Khaki bottom + White sneakers"
}

Be precise with hex codes. Keep all labels under 3 words. Visual-first response.
`,

  // ==========================================
  // 7. OUTFIT INFOGRAPHIC BY FACE SHAPE
  // ==========================================
  outfitByFaceShape: `
You are a professional men's fashion stylist and visual consultant.

Analyze this portrait photo and return a JSON for rendering an outfit infographic based on face shape and body proportion.

Tasks:
- Identify face shape precisely
- Recommend 4 outfit styles that complement the face shape and overall look
- For each outfit: name, occasion, clothing items with colors, why it works
- List 2 outfit styles to AVOID and why

Output JSON format:
{
  "faceShape": "oval|round|square|heart|diamond|oblong|triangle",
  "faceShapeDescription": "1-sentence about detected face shape",
  "recommendedOutfits": [
    {
      "rank": 1,
      "name": "Smart Casual",
      "occasion": "Daily|Office|Social|Date|Formal",
      "items": [
        { "piece": "Top", "description": "White linen button-up, slim fit", "color": "#FFFFFF", "colorName": "White" },
        { "piece": "Bottom", "description": "Dark navy chinos, tapered", "color": "#1B3A6B", "colorName": "Navy" },
        { "piece": "Shoes", "description": "White leather sneakers", "color": "#F5F5F5", "colorName": "Off-White" },
        { "piece": "Accessory", "description": "Minimalist silver watch", "color": "#C0C0C0", "colorName": "Silver" }
      ],
      "whyItWorks": "Short explanation under 15 words",
      "styleKeyword": "Clean|Bold|Relaxed|Sharp|Minimal"
    }
  ],
  "avoidOutfits": [
    { "style": "Oversized Hoodie Stack", "reason": "Adds visual bulk, masks jawline definition" },
    { "style": "All-Black Monochrome", "reason": "Too harsh, erases facial contrast" }
  ],
  "stylePersonality": "The Modern Gentleman|Urban Creative|Minimalist|Classic|Street Edge"
}

Return 4 recommendedOutfits and 2 avoidOutfits. Keep descriptions concise, visual-first.
`,

  // ==========================================
  // 8. EYEWEAR RECOMMENDATIONS
  // ==========================================
  eyewearRecommendation: `
You are a professional optical stylist and eyewear consultant.

Analyze this portrait and return a JSON for rendering an eyewear recommendation infographic.

Tasks:
- Determine face shape and key facial proportions
- Recommend 3 eyewear styles that suit the face (style glasses, sport, sunglasses)
- For each frame: frame shape, material, color, why it suits
- List 2 eyewear styles to AVOID
- Include one recommendation each for: fashion/style, sport/active, and classic/everyday

Output JSON format:
{
  "faceShape": "oval|round|square|heart|diamond|oblong|triangle",
  "faceMeasurements": {
    "foreheadWidth": "wide|medium|narrow",
    "cheekboneWidth": "prominent|average|subtle",
    "jawlineShape": "strong|soft|pointed|wide"
  },
  "recommendations": [
    {
      "rank": 1,
      "category": "Style|Sport|Classic|Sunglasses",
      "name": "Aviator",
      "frameShape": "Teardrop",
      "material": "Metal|Acetate|TR90|Titanium",
      "recommendedColors": ["Gold", "Gunmetal"],
      "whyItSuits": "Under 12 words why this frame works",
      "bestFor": "Casual outings, traveling, social events",
      "suitabilityScore": 92
    }
  ],
  "avoidFrames": [
    { "style": "Round Wire Frame", "reason": "Amplifies roundness, no contrast to face shape" },
    { "style": "Oversized Square", "reason": "Overwhelms facial proportions" }
  ],
  "proTip": "One sentence practical eyewear tip for this face shape"
}

Return 3 recommendations (one Style, one Sport, one Classic/Everyday) and 2 avoidFrames.
`,

  // ==========================================
  // 9. SKINCARE ANALYSIS
  // ==========================================
  skincareAnalysis: `
You are a professional dermatologist and skincare consultant.

Analyze the facial skin visible in this portrait and return a JSON for a skincare recommendation infographic.

Goal: Help the subject achieve healthier, brighter, and more radiant skin.

Tasks:
- Assess current skin condition from the photo
- Identify top 3 skin concerns visible or likely
- Create a morning and evening skincare routine
- Recommend product types (not brand names) with purpose
- Give dietary/lifestyle tips for skin improvement

Output JSON format:
{
  "skinProfile": {
    "type": "oily|dry|combination|normal|sensitive",
    "tone": "fair|light|medium|olive|brown|dark",
    "undertone": "warm|cool|neutral",
    "texture": "smooth|rough|uneven|normal",
    "hydrationLevel": "well-hydrated|dehydrated|oily-dehydrated"
  },
  "concerns": [
    { "issue": "Uneven Skin Tone", "severity": "mild|moderate|severe", "tip": "Short fix tip" },
    { "issue": "Enlarged Pores", "severity": "mild|moderate|severe", "tip": "Short fix tip" },
    { "issue": "Dullness", "severity": "mild|moderate|severe", "tip": "Short fix tip" }
  ],
  "morningRoutine": [
    { "step": 1, "product": "Gentle Foam Cleanser", "purpose": "Remove overnight sebum", "duration": "60 sec" },
    { "step": 2, "product": "Vitamin C Serum", "purpose": "Brighten and antioxidant", "duration": "30 sec" },
    { "step": 3, "product": "Lightweight Moisturizer", "purpose": "Hydrate and seal", "duration": "30 sec" },
    { "step": 4, "product": "SPF 30+ Sunscreen", "purpose": "UV protection", "duration": "30 sec" }
  ],
  "eveningRoutine": [
    { "step": 1, "product": "Oil-Based Cleanser", "purpose": "Remove sunscreen and pollutants", "duration": "60 sec" },
    { "step": 2, "product": "Foam Cleanser", "purpose": "Deep clean", "duration": "60 sec" },
    { "step": 3, "product": "Niacinamide Serum", "purpose": "Pore refinement and brightness", "duration": "30 sec" },
    { "step": 4, "product": "Retinol Cream (2-3x/week)", "purpose": "Cell renewal", "duration": "30 sec" },
    { "step": 5, "product": "Rich Night Moisturizer", "purpose": "Overnight repair", "duration": "30 sec" }
  ],
  "lifestyleTips": [
    "Drink 2L water daily for cellular hydration",
    "Sleep 7-8 hours to reduce cortisol and skin inflammation",
    "Avoid sugar-heavy diets to prevent glycation and dullness",
    "Wash pillowcase twice a week to prevent bacteria transfer"
  ],
  "weeklyTreatment": "Exfoliating mask 1-2x/week for cell turnover",
  "expectedResults": "Visible improvement in brightness and texture within 4-6 weeks"
}

Be specific and actionable. Use simple language. Maximum 5 morning steps, 5 evening steps.
`,

  // ==========================================
  // 10. HAIRSTYLE VISUAL RECOMMENDATION
  // ==========================================
  hairstyleVisual: `
You are a professional barber and hair stylist with expertise in men's haircuts.

Analyze this portrait and return a JSON for a hairstyle recommendation infographic.

Tasks:
- Identify face shape, current hair texture, and density
- Recommend 4 haircuts that would suit the subject best
- For each haircut: name, description, styling tips, who it suits
- List 3 haircuts/hairdos to AVOID with clear reasons
- Include variety: one Korean/Asian style, one Classic barbershop, one Modern fade, one Versatile

Output JSON format:
{
  "currentHair": {
    "texture": "straight|wavy|curly|coily",
    "density": "thin|medium|thick",
    "length": "short|medium|long",
    "currentStyle": "Brief description of current look"
  },
  "faceShape": "oval|round|square|heart|diamond|oblong|triangle",
  "recommendations": [
    {
      "rank": 1,
      "category": "Korean|Classic|Modern Fade|Versatile|Textured",
      "name": "Two-Block Cut",
      "description": "Short sides with textured volume on top, signature K-style",
      "whyItSuits": "Under 12 words why this cut works for this face",
      "stylingProducts": ["Matte Clay", "Sea Salt Spray"],
      "maintenanceLevel": "low|medium|high",
      "maintenanceFrequency": "Every 3-4 weeks",
      "stylingTime": "5 minutes daily",
      "suitabilityScore": 94
    }
  ],
  "avoidHairstyles": [
    {
      "style": "Bowl Cut",
      "reason": "Widens face horizontally, loses definition",
      "category": "Shape Issue"
    },
    {
      "style": "Very Long Top Undercut",
      "reason": "Top-heavy, unbalances facial proportions",
      "category": "Proportion Issue"
    },
    {
      "style": "Slick Back (no volume)",
      "reason": "Exposes forehead width unfavorably",
      "category": "Feature Issue"
    }
  ],
  "barberTip": "One sentence tip to tell your barber",
  "groomingEssentials": ["Product 1", "Product 2", "Tool 1"]
}

Return exactly 4 recommendations and 3 avoidHairstyles. Keep all text concise and visual-friendly.
`
};

module.exports = PROMPTS;
