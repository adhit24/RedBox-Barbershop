/**
 * AI Worker - Background Job Processor
 * Processes AI analysis jobs from the queue
 */

const Queue = require('bull');
const { AIDatabase } = require('../config/database');
const aiService = require('../services/aiService');
const imageService = require('../services/imageService');

const db = new AIDatabase();

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
};

// Create queue instance
const aiQueue = new Queue('ai-analysis', { redis: redisConfig });

// Process jobs
aiQueue.process(async (job) => {
  const { uploadId, userId, serviceType, imageUrl } = job.data;
  
  console.log(`Processing job ${job.id} - Upload: ${uploadId}, Service: ${serviceType}`);
  
  const startTime = Date.now();
  
  try {
    // Update status to processing
    await db.updateUploadStatus(uploadId, 'processing');
    
    // Decrement credits
    const newCredits = await db.decrementCredits(userId, 1);
    
    if (newCredits === null) {
      throw new Error('Insufficient credits');
    }
    
    // Process based on service type
    let result;
    
    switch (serviceType) {
      case 'face_analysis':
        result = await aiService.analyzeFace(imageUrl);
        break;
        
      case 'hairstyle':
        result = await aiService.recommendHairstyle(imageUrl, {
          style: 'modern',
          ageRange: '25-35'
        });
        break;
        
      case 'outfit':
        result = await aiService.recommendOutfit(imageUrl, 'casual', 'tropical');
        break;
        
      case 'preview':
        const analysis = await aiService.analyzeFace(imageUrl);
        result = await aiService.generatePreview(
          imageUrl,
          analysis.analysis,
          'modern_gentleman'
        );
        break;
        
      default:
        throw new Error(`Unknown service type: ${serviceType}`);
    }
    
    // Save results
    await db.saveResults({
      uploadId,
      userId,
      analysisResult: result.analysis || result,
      recommendations: result.recommendations,
      generatedImages: result.generatedImageUrl ? [result.generatedImageUrl] : null,
      modelUsed: result.model,
      tokensUsed: result.tokens,
      processingTime: Date.now() - startTime
    });
    
    // Update upload status
    await db.updateUploadStatus(uploadId, 'completed');
    
    // Log usage
    await db.logUsage({
      userId,
      serviceType,
      creditsUsed: 1,
      success: true
    });
    
    console.log(`Job ${job.id} completed in ${Date.now() - startTime}ms`);
    
    return {
      success: true,
      uploadId,
      processingTime: Date.now() - startTime
    };
    
  } catch (error) {
    console.error(`Job ${job.id} failed:`, error);
    
    // Update status to failed
    await db.updateUploadStatus(uploadId, 'failed', {
      error: error.message,
      retryCount: job.attemptsMade
    });
    
    // Log failed usage
    await db.logUsage({
      userId,
      serviceType,
      creditsUsed: 0,
      success: false,
      errorMessage: error.message
    });
    
    // Refund credits on failure (optional)
    if (job.attemptsMade >= 2) {
      await db.incrementCredits(userId, 1);
    }
    
    throw error;
  }
});

// Event handlers
aiQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed`, result);
});

aiQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

aiQueue.on('error', (error) => {
  console.error('Queue error:', error);
});

console.log('AI Worker started - Waiting for jobs...');

module.exports = aiQueue;
