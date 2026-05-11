/**
 * AI Controller - API Request Handlers
 */

const { AIDatabase } = require('../config/database');
const aiService = require('../services/aiService');
const imageService = require('../services/imageService');
const queueService = require('../services/queueService');

const db = new AIDatabase();

const aiController = {
  
  // POST /api/ai/upload
  uploadImage: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
      }

      const { serviceType } = req.body;
      const userId = req.user.id;
      const outletId = req.user.outlet_id;

      // Validate service type
      const validTypes = ['face_analysis', 'hairstyle', 'outfit', 'preview', 'full_analysis'];
      if (!validTypes.includes(serviceType)) {
        return res.status(400).json({ error: 'Invalid service type' });
      }

      // Process and upload image to Supabase Storage
      const processedBuffer = await imageService.processImage(req.file.buffer);
      const imageUrl = await imageService.uploadToStorage(
        processedBuffer,
        `ai-uploads/${userId}/${Date.now()}.jpg`
      );

      // Create upload record
      const upload = await db.createUpload({
        userId,
        outletId,
        imageUrl,
        serviceType
      });

      res.status(201).json({
        success: true,
        uploadId: upload.id,
        imageUrl,
        status: upload.status
      });

    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  },

  // POST /api/ai/analyze
  analyzeImage: async (req, res) => {
    try {
      const { uploadId } = req.body;
      const userId = req.user.id;

      // Get upload record
      const upload = await db.getUpload(uploadId);
      
      if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
      }

      if (upload.user_id !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      // Check credits
      const userCredits = await db.getUserCredits(userId);
      if (userCredits.ai_credits <= 0) {
        return res.status(403).json({
          error: 'Insufficient AI credits',
          upgradeUrl: '/membership.html'
        });
      }

      // Update status to processing
      await db.updateUploadStatus(uploadId, 'processing');

      // Add to queue
      await queueService.addJob('ai-analysis', {
        uploadId,
        userId,
        serviceType: upload.service_type,
        imageUrl: upload.original_image_url
      });

      res.json({
        success: true,
        uploadId,
        status: 'processing',
        message: 'AI analysis queued'
      });

    } catch (error) {
      console.error('Analyze error:', error);
      res.status(500).json({ error: 'Failed to queue analysis' });
    }
  },

  // GET /api/ai/results/:uploadId
  getResults: async (req, res) => {
    try {
      const { uploadId } = req.params;
      const userId = req.user.id;

      const upload = await db.getUpload(uploadId);

      if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
      }

      if (upload.user_id !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      res.json({
        uploadId,
        status: upload.status,
        serviceType: upload.service_type,
        imageUrl: upload.original_image_url,
        results: upload.ai_results?.[0] || null,
        createdAt: upload.created_at,
        completedAt: upload.completed_at
      });

    } catch (error) {
      console.error('Get results error:', error);
      res.status(500).json({ error: 'Failed to get results' });
    }
  },

  // GET /api/ai/status/:uploadId
  getStatus: async (req, res) => {
    try {
      const { uploadId } = req.params;
      const userId = req.user.id;

      const upload = await db.getUpload(uploadId);

      if (!upload || upload.user_id !== userId) {
        return res.status(404).json({ error: 'Not found' });
      }

      res.json({
        uploadId,
        status: upload.status,
        createdAt: upload.created_at,
        processingStartedAt: upload.processing_started_at,
        completedAt: upload.completed_at,
        errorMessage: upload.error_message
      });

    } catch (error) {
      console.error('Get status error:', error);
      res.status(500).json({ error: 'Failed to get status' });
    }
  },

  // GET /api/ai/history
  getHistory: async (req, res) => {
    try {
      const userId = req.user.id;
      const { limit = 20, offset = 0 } = req.query;

      const history = await db.getUserHistory(userId, parseInt(limit), parseInt(offset));

      res.json({
        history,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: history.length
        }
      });

    } catch (error) {
      console.error('Get history error:', error);
      res.status(500).json({ error: 'Failed to get history' });
    }
  },

  // GET /api/ai/credits
  getCredits: async (req, res) => {
    try {
      const userId = req.user.id;
      const credits = await db.getUserCredits(userId);

      res.json({
        credits: credits.ai_credits,
        tier: credits.ai_subscription_tier,
        expiresAt: credits.ai_subscription_expires,
        totalUsage: credits.total_ai_usage
      });

    } catch (error) {
      console.error('Get credits error:', error);
      res.status(500).json({ error: 'Failed to get credits' });
    }
  },

  // GET /api/ai/stats
  getStats: async (req, res) => {
    try {
      const userId = req.user.id;
      
      const { supabase } = require('../config/database');
      const { data, error } = await supabase
        .rpc('get_user_ai_stats', { user_uuid: userId });

      if (error) throw error;

      res.json(data[0]);

    } catch (error) {
      console.error('Get stats error:', error);
      res.status(500).json({ error: 'Failed to get stats' });
    }
  },

  // POST /api/ai/retry/:uploadId
  retryAnalysis: async (req, res) => {
    try {
      const { uploadId } = req.params;
      const userId = req.user.id;

      const upload = await db.getUpload(uploadId);

      if (!upload || upload.user_id !== userId) {
        return res.status(404).json({ error: 'Not found' });
      }

      if (upload.status !== 'failed') {
        return res.status(400).json({ error: 'Can only retry failed uploads' });
      }

      // Reset status and re-queue
      await db.updateUploadStatus(uploadId, 'pending');
      
      await queueService.addJob('ai-analysis', {
        uploadId,
        userId,
        serviceType: upload.service_type,
        imageUrl: upload.original_image_url
      });

      res.json({
        success: true,
        message: 'Analysis requeued'
      });

    } catch (error) {
      console.error('Retry error:', error);
      res.status(500).json({ error: 'Failed to retry' });
    }
  },

  // DELETE /api/ai/upload/:uploadId
  deleteUpload: async (req, res) => {
    try {
      const { uploadId } = req.params;
      const userId = req.user.id;

      const upload = await db.getUpload(uploadId);

      if (!upload || upload.user_id !== userId) {
        return res.status(404).json({ error: 'Not found' });
      }

      // Delete from storage
      await imageService.deleteFromStorage(upload.original_image_url);

      // Delete from database (cascade will handle ai_results)
      const { supabase } = require('../config/database');
      await supabase.from('ai_uploads').delete().eq('id', uploadId);

      res.json({ success: true, message: 'Upload deleted' });

    } catch (error) {
      console.error('Delete error:', error);
      res.status(500).json({ error: 'Failed to delete' });
    }
  }
};

module.exports = aiController;
