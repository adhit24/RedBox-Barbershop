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
`
};

module.exports = PROMPTS;
