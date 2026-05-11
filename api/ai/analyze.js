// Vercel Serverless Function for AI Analysis - Simple version
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Health check endpoint
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'AI Analysis', method: req.method });
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', method: req.method });
  }

  try {
    const { uploadId, serviceType } = req.body || {};
    
    if (!uploadId) {
      return res.status(400).json({ error: 'No uploadId provided' });
    }

    const resolvedServiceType = serviceType || 'full_analysis';

    let mockResult;
    if (resolvedServiceType === 'full_analysis') {
      mockResult = {
        personalColor: {
          skinAnalysis: { tone: 'medium', undertone: 'warm', type: 'combination', texture: 'normal', notes: 'Healthy complexion with warm golden undertones.' },
          colorSeason: 'Autumn',
          colorSeasonDescription: 'Warm, earthy tones complement your golden-warm complexion best.',
          bestColors: [
            { name: 'Navy Blue', hex: '#1B3A6B', label: 'Power & Trust' },
            { name: 'Warm White', hex: '#FAF0E6', label: 'Fresh & Clean' },
            { name: 'Olive Green', hex: '#6B7B3A', label: 'Natural Harmony' },
            { name: 'Terracotta', hex: '#C17D5A', label: 'Warmth & Depth' },
            { name: 'Camel', hex: '#C19A6B', label: 'Sophisticated' },
            { name: 'Burgundy', hex: '#800020', label: 'Bold Statement' }
          ],
          avoidColors: [
            { name: 'Neon Yellow', hex: '#FFFF00', label: 'Washes Out' },
            { name: 'Icy Pink', hex: '#FFB6C1', label: 'Clashes Undertone' },
            { name: 'Bright Orange', hex: '#FF6600', label: 'Overpowers' },
            { name: 'Cool Grey', hex: '#A9A9A9', label: 'Dulls Complexion' }
          ],
          outfitFormula: 'Navy top + Khaki chinos + White leather sneakers'
        },
        outfit: {
          faceShape: 'Oval',
          faceShapeDescription: 'Balanced proportions — most styles work well.',
          recommendedOutfits: [
            {
              rank: 1, name: 'Smart Casual', occasion: 'Daily',
              items: [
                { piece: 'Top', description: 'White linen button-up, slim fit', color: '#FFFFFF', colorName: 'White' },
                { piece: 'Bottom', description: 'Dark navy chinos, tapered', color: '#1B3A6B', colorName: 'Navy' },
                { piece: 'Shoes', description: 'White leather sneakers', color: '#F5F5F5', colorName: 'Off-White' },
                { piece: 'Accessory', description: 'Minimalist silver watch', color: '#C0C0C0', colorName: 'Silver' }
              ],
              whyItWorks: 'Clean contrast flatters warm skin and oval face.',
              styleKeyword: 'Clean'
            },
            {
              rank: 2, name: 'Urban Street', occasion: 'Social',
              items: [
                { piece: 'Top', description: 'Olive oversized graphic tee', color: '#6B7B3A', colorName: 'Olive' },
                { piece: 'Bottom', description: 'Beige cargo pants, relaxed', color: '#C9B99A', colorName: 'Beige' },
                { piece: 'Shoes', description: 'Black chunky sneakers', color: '#1A1A1A', colorName: 'Black' },
                { piece: 'Accessory', description: 'Bucket hat, neutral tone', color: '#A8915A', colorName: 'Tan' }
              ],
              whyItWorks: 'Earthy tones echo warm undertones, relaxed silhouette works well.',
              styleKeyword: 'Relaxed'
            }
          ],
          avoidOutfits: [
            { style: 'Oversized All-Black', reason: 'Too heavy, erases facial warmth and definition' },
            { style: 'Neon Colorblocking', reason: 'Clashes with warm undertone, overwhelms features' }
          ],
          stylePersonality: 'The Modern Gentleman'
        },
        eyewear: {
          faceShape: 'Oval',
          faceMeasurements: { foreheadWidth: 'medium', cheekboneWidth: 'average', jawlineShape: 'soft' },
          recommendations: [
            {
              rank: 1, category: 'Style', name: 'Aviator',
              frameShape: 'Teardrop', material: 'Metal',
              recommendedColors: ['Gold', 'Gunmetal'],
              whyItSuits: 'Teardrop shape adds definition without competing with oval face.',
              bestFor: 'Casual outings, traveling, social events',
              suitabilityScore: 92
            },
            {
              rank: 2, category: 'Sport', name: 'Wrap-Around Sport',
              frameShape: 'Wrap', material: 'TR90',
              recommendedColors: ['Matte Black', 'Dark Navy'],
              whyItSuits: 'Secure fit, bold frame contrasts balanced proportions cleanly.',
              bestFor: 'Sports, outdoor activities, gym',
              suitabilityScore: 87
            },
            {
              rank: 3, category: 'Classic', name: 'Rectangle Frame',
              frameShape: 'Rectangle', material: 'Acetate',
              recommendedColors: ['Tortoise', 'Black'],
              whyItSuits: 'Structured angles complement soft oval contours perfectly.',
              bestFor: 'Office, formal occasions, everyday wear',
              suitabilityScore: 90
            }
          ],
          avoidFrames: [
            { style: 'Round Wire Frame', reason: 'Amplifies softness, removes facial structure' },
            { style: 'Oversized Cat-Eye', reason: 'Overwhelms balanced proportions' }
          ],
          proTip: 'For oval faces, choose frames as wide as or slightly wider than your cheekbones.'
        },
        skincare: {
          skinProfile: { type: 'combination', tone: 'medium', undertone: 'warm', texture: 'normal', hydrationLevel: 'well-hydrated' },
          concerns: [
            { issue: 'Uneven Skin Tone', severity: 'mild', tip: 'Vitamin C serum daily in the morning' },
            { issue: 'Enlarged Pores', severity: 'mild', tip: 'Niacinamide serum + gentle exfoliation 2x/week' },
            { issue: 'Dullness', severity: 'moderate', tip: 'AHA toner twice a week for cell turnover' }
          ],
          morningRoutine: [
            { step: 1, product: 'Gentle Foam Cleanser', purpose: 'Remove overnight sebum', duration: '60 sec' },
            { step: 2, product: 'Vitamin C Serum', purpose: 'Brighten and antioxidant protection', duration: '30 sec' },
            { step: 3, product: 'Lightweight Moisturizer', purpose: 'Hydrate and seal', duration: '30 sec' },
            { step: 4, product: 'SPF 30+ Sunscreen', purpose: 'UV protection', duration: '30 sec' }
          ],
          eveningRoutine: [
            { step: 1, product: 'Oil-Based Cleanser', purpose: 'Remove sunscreen & pollutants', duration: '60 sec' },
            { step: 2, product: 'Foam Cleanser', purpose: 'Deep clean', duration: '60 sec' },
            { step: 3, product: 'Niacinamide Serum', purpose: 'Pore refinement and brightness', duration: '30 sec' },
            { step: 4, product: 'Retinol Cream (2-3x/week)', purpose: 'Cell renewal', duration: '30 sec' },
            { step: 5, product: 'Rich Night Moisturizer', purpose: 'Overnight repair', duration: '30 sec' }
          ],
          lifestyleTips: [
            'Drink 2L water daily for cellular hydration',
            'Sleep 7-8 hours to reduce cortisol and skin inflammation',
            'Avoid sugar-heavy diets to prevent glycation and dullness',
            'Wash pillowcase twice a week to prevent bacteria transfer'
          ],
          weeklyTreatment: 'Exfoliating mask 1-2x/week for cell turnover',
          expectedResults: 'Visible improvement in brightness and texture within 4-6 weeks'
        },
        hairstyle: {
          currentHair: { texture: 'straight', density: 'medium', length: 'short', currentStyle: 'Clean short cut with natural parting' },
          faceShape: 'Oval',
          recommendations: [
            {
              rank: 1, category: 'Korean', name: 'Two-Block Cut',
              description: 'Short sides with textured volume on top, signature K-style look.',
              whyItSuits: 'Adds height and softens the oval face naturally.',
              stylingProducts: ['Matte Clay', 'Sea Salt Spray'],
              maintenanceLevel: 'medium', maintenanceFrequency: 'Every 3-4 weeks',
              stylingTime: '5 minutes daily', suitabilityScore: 94
            },
            {
              rank: 2, category: 'Classic', name: 'Classic Pompadour',
              description: 'Volume swept back and up from the forehead, clean fade sides.',
              whyItSuits: 'Elongates proportions and highlights facial structure.',
              stylingProducts: ['Strong Hold Pomade', 'Hair Dryer'],
              maintenanceLevel: 'high', maintenanceFrequency: 'Every 2-3 weeks',
              stylingTime: '10 minutes daily', suitabilityScore: 88
            },
            {
              rank: 3, category: 'Modern Fade', name: 'Textured Crop Fade',
              description: 'Short textured top with skin or low fade on the sides.',
              whyItSuits: 'Clean, modern, low-effort look that frames the face well.',
              stylingProducts: ['Matte Wax', 'Light Hold Spray'],
              maintenanceLevel: 'low', maintenanceFrequency: 'Every 3-4 weeks',
              stylingTime: '3 minutes daily', suitabilityScore: 91
            },
            {
              rank: 4, category: 'Versatile', name: 'Side Part',
              description: 'Defined side part with tapered sides, works formal or casual.',
              whyItSuits: 'Universally flattering, balanced and professional.',
              stylingProducts: ['Medium Hold Pomade'],
              maintenanceLevel: 'low', maintenanceFrequency: 'Every 4 weeks',
              stylingTime: '5 minutes daily', suitabilityScore: 86
            }
          ],
          avoidHairstyles: [
            { style: 'Bowl Cut', reason: 'Widens face horizontally, loses definition', category: 'Shape Issue' },
            { style: 'Very Long Undercut', reason: 'Top-heavy, unbalances facial proportions', category: 'Proportion Issue' },
            { style: 'Slick Back Flat', reason: 'Exposes full forehead without volume balance', category: 'Feature Issue' }
          ],
          barberTip: 'Ask for a medium fade with texture on top — scissor cut over comb for a natural finish.',
          groomingEssentials: ['Matte Clay', 'Fine-tooth Comb', 'Hair Dryer']
        }
      };
    } else if (resolvedServiceType === 'hairstyle') {
      mockResult = {
        recommendations: [
          {
            name: 'Textured Crop',
            description: 'Modern, clean, and easy to maintain.',
            category: 'modern',
            confidence: 90,
            maintenance: { level: 'low' }
          },
          {
            name: 'Classic Side Part',
            description: 'Timeless style for a sharp, professional look.',
            category: 'classic',
            confidence: 86,
            maintenance: { level: 'medium' }
          },
          {
            name: 'Short Quiff',
            description: 'Adds height and structure without being too bold.',
            category: 'modern',
            confidence: 82,
            maintenance: { level: 'medium' }
          }
        ],
        generalAdvice: 'Pilih style yang sesuai jenis rambut, lalu minta barber rapihkan garis rambut dan fade sesuai preferensi.'
      };
    } else if (resolvedServiceType === 'outfit') {
      mockResult = {
        colorAnalysis: {
          skinTone: 'Medium',
          bestColors: ['Navy', 'White', 'Olive'],
          recommendedColors: [
            { name: 'Navy', hex: '#0B1F3B' },
            { name: 'Olive', hex: '#556B2F' },
            { name: 'Off White', hex: '#F3F2ED' }
          ]
        },
        outfitRecommendations: [
          {
            occasion: 'Smart Casual',
            description: 'Clean & versatile for hangouts or date night.',
            items: ['Oxford shirt', 'Chinos', 'Leather sneakers']
          },
          {
            occasion: 'Work',
            description: 'Sharp but not too formal.',
            items: ['Polo', 'Slim trousers', 'Loafers']
          }
        ],
        groomingTips: ['Pakai parfum fresh/clean', 'Rapihkan alis & beard line', 'Gunakan matte product untuk rambut']
      };
    } else if (resolvedServiceType === 'preview') {
      mockResult = {
        originalImageUrl: '',
        generatedImageBase64: null
      };
    } else {
      mockResult = {
        faceShape: 'Oval',
        faceShapeDescription: 'Your face has a balanced oval shape, which is versatile for many hairstyles.',
        skinTone: 'Medium',
        skinUndertone: 'Warm',
        skinRecommendations: ['Use sunscreen daily', 'Stay hydrated'],
        recommendations: {
          haircuts: [
            { name: 'Classic Pompadour', description: 'Timeless shape with volume', confidence: 90 },
            { name: 'Textured Crop', description: 'Modern and low-maintenance', confidence: 88 },
            { name: 'Side Part', description: 'Clean, professional', confidence: 85 }
          ],
          beardStyles: [
            { name: 'Short Boxed Beard', description: 'Defines jawline cleanly', confidence: 86 },
            { name: 'Stubble', description: 'Low effort, sharp look', confidence: 80 }
          ]
        },
        processingTime: 2.5,
        model: 'mock'
      };
    }

    return res.status(200).json({
      uploadId: uploadId,
      status: 'completed',
      results: mockResult,
      serviceType: resolvedServiceType,
      message: 'AI analysis completed (mock data for testing)'
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
