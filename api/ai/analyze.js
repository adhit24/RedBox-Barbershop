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

    const resolvedServiceType = serviceType || 'face_analysis';

    let mockResult;
    if (resolvedServiceType === 'hairstyle') {
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
