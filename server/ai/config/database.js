/**
 * AI Service Database Configuration
 * Supabase client for AI Grooming Assistant
 */

const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration for AI service');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// AI specific database helpers
class AIDatabase {
  constructor() {
    this.client = supabase;
  }

  /**
   * Create new AI upload record
   */
  async createUpload({ userId, outletId, imageUrl, serviceType }) {
    const { data, error } = await this.client
      .from('ai_uploads')
      .insert({
        user_id: userId,
        outlet_id: outletId,
        original_image_url: imageUrl,
        service_type: serviceType,
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update upload status
   */
  async updateUploadStatus(uploadId, status, metadata = {}) {
    const updates = { status };
    
    if (status === 'processing') {
      updates.processing_started_at = new Date().toISOString();
    } else if (status === 'completed') {
      updates.completed_at = new Date().toISOString();
    } else if (status === 'failed') {
      updates.error_message = metadata.error || 'Unknown error';
      updates.retry_count = metadata.retryCount || 0;
    }

    const { data, error } = await this.client
      .from('ai_uploads')
      .update(updates)
      .eq('id', uploadId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Save AI analysis results
   */
  async saveResults({ uploadId, userId, analysisResult, recommendations, generatedImages, modelUsed, tokensUsed, processingTime }) {
    const { data, error } = await this.client
      .from('ai_results')
      .insert({
        upload_id: uploadId,
        user_id: userId,
        analysis_result: analysisResult,
        recommendations: recommendations || [],
        generated_images: generatedImages || [],
        model_used: modelUsed,
        tokens_used: tokensUsed,
        processing_time_ms: processingTime
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Log AI usage
   */
  async logUsage({ userId, serviceType, creditsUsed, success, errorMessage, ipAddress, userAgent }) {
    const { error } = await this.client
      .from('ai_usage_logs')
      .insert({
        user_id: userId,
        service_type: serviceType,
        credits_used: creditsUsed,
        success,
        error_message: errorMessage,
        ip_address: ipAddress,
        user_agent: userAgent
      });

    if (error) console.error('Failed to log AI usage:', error);
  }

  /**
   * Decrement user AI credits
   */
  async decrementCredits(userId, amount = 1) {
    const { data, error } = await this.client
      .rpc('decrement_ai_credits', {
        user_uuid: userId,
        amount: amount
      });

    if (error) throw error;
    return data;
  }

  /**
   * Get user AI credits and tier
   */
  async getUserCredits(userId) {
    const { data, error } = await this.client
      .from('users')
      .select('ai_credits, ai_subscription_tier, ai_subscription_expires, total_ai_usage')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get upload by ID
   */
  async getUpload(uploadId) {
    const { data, error } = await this.client
      .from('ai_uploads')
      .select('*, ai_results(*)')
      .eq('id', uploadId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get user's upload history
   */
  async getUserHistory(userId, limit = 20, offset = 0) {
    const { data, error } = await this.client
      .from('ai_uploads')
      .select('*, ai_results(analysis_result, recommendations, generated_images)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data;
  }
}

module.exports = { supabase, AIDatabase };
