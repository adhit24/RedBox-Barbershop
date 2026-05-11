// Vercel Serverless Function for AI Upload - Simple version
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
    return res.status(200).json({ status: 'ok', service: 'AI Upload', method: req.method });
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', method: req.method });
  }

  try {
    const { image, serviceType, fileName } = req.body || {};
    
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Generate upload ID (without database for now)
    const uploadId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return res.status(200).json({
      uploadId: uploadId,
      status: 'pending',
      message: 'Upload received (database storage disabled for testing)',
      serviceType: serviceType || 'face_analysis',
      imageSize: image.length
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
