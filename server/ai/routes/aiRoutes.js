/**
 * AI Routes - Express API Endpoints
 */

const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { authenticate, requireMembership } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');
const { rateLimitByTier } = require('../middleware/rateLimiter');

// GET /api/ai/upload - Health check (use POST for actual upload)
router.get('/upload', (req, res) => {
  res.json({ status: 'ok', service: 'AI Upload', method: req.method, hint: 'Use POST /api/ai/upload' });
});

// POST /api/ai/upload - Upload image for AI analysis
router.post('/upload',
  (req, res, next) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    const isJson = ct.includes('application/json') || ct.includes('text/json');
    const hasBody = req.body && typeof req.body === 'object';
    const image = hasBody ? req.body.image : null;

    if (!isJson || !image) return next();

    const uploadId = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    return res.status(200).json({
      uploadId,
      status: 'pending',
      message: 'Upload received (json mode)',
      serviceType: req.body.serviceType || 'face_analysis',
      imageSize: String(image).length,
    });
  },
  authenticate,
  requireMembership,
  rateLimitByTier,
  uploadImage.single('image'),
  aiController.uploadImage
);

// POST /api/ai/analyze - Trigger AI analysis (queue job)
router.post('/analyze',
  authenticate,
  requireMembership,
  rateLimitByTier,
  aiController.analyzeImage
);

// GET /api/ai/results/:uploadId - Get analysis results
router.get('/results/:uploadId',
  authenticate,
  aiController.getResults
);

// GET /api/ai/status/:uploadId - Check processing status
router.get('/status/:uploadId',
  authenticate,
  aiController.getStatus
);

// GET /api/ai/history - Get user's AI usage history
router.get('/history',
  authenticate,
  aiController.getHistory
);

// GET /api/ai/credits - Get user's AI credits
router.get('/credits',
  authenticate,
  aiController.getCredits
);

// GET /api/ai/stats - Get user's AI usage stats
router.get('/stats',
  authenticate,
  aiController.getStats
);

// POST /api/ai/retry/:uploadId - Retry failed analysis
router.post('/retry/:uploadId',
  authenticate,
  requireMembership,
  aiController.retryAnalysis
);

// DELETE /api/ai/upload/:uploadId - Delete upload and results
router.delete('/upload/:uploadId',
  authenticate,
  aiController.deleteUpload
);

module.exports = router;
