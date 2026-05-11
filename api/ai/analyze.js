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

    // Return mock result for testing (without OpenAI for now)
    const mockResult = {
      faceShape: 'Oval',
      faceShapeDescription: 'Your face has a balanced oval shape, which is versatile for many hairstyles.',
      recommendations: {
        hairstyles: [
          {
            name: 'Classic Pompadour',
            description: 'A timeless style that works perfectly with your face shape',
            suitability: 95
          },
          {
            name: 'Textured Crop',
            description: 'Modern and low-maintenance option',
            suitability: 90
          },
          {
            name: 'Side Part',
            description: 'Professional and clean look',
            suitability: 88
          }
        ],
        outfits: [
          {
            style: 'Smart Casual',
            description: 'Perfect for your look',
            items: ['Blazer', 'Chinos', 'Clean sneakers']
          }
        ]
      },
      groomingTips: [
        'Keep your beard well-trimmed',
        'Use matte finish products',
        'Regular barber visits every 3 weeks'
      ]
    };

    return res.status(200).json({
      uploadId: uploadId,
      status: 'completed',
      results: mockResult,
      message: 'AI analysis completed (mock data for testing)'
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
