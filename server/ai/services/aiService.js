/**
 * AI Service - OpenAI Integration (Updated May 2026)
 * Uses gpt-4.1-mini via Responses API (cheaper & faster)
 */

const { OpenAI } = require('openai');
const PROMPTS = require('../utils/prompts');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

class AIService {
  
  // Use gpt-4.1-mini via Responses API (90% cheaper than GPT-4 Vision)
  async analyzeFace(imageUrl) {
    const startTime = Date.now();
    
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: PROMPTS.faceAnalysis },
            { type: 'input_image', image_url: imageUrl, detail: 'high' }
          ]
        }
      ]
    });
    
    // Parse JSON from output_text
    const outputText = response.output_text || '';
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    
    return {
      analysis: result,
      model: 'gpt-4.1-mini',
      tokens: response.usage?.total_tokens || 0,
      processingTime: Date.now() - startTime,
      cost: this.estimateCost('gpt-4.1-mini', response.usage?.total_tokens || 0)
    };
  }

  async recommendHairstyle(imageUrl, preferences = {}) {
    const startTime = Date.now();
    
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: PROMPTS.hairstyleRecommendation(preferences) },
            { type: 'input_image', image_url: imageUrl, detail: 'high' }
          ]
        }
      ]
    });
    
    const outputText = response.output_text || '';
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    
    return {
      recommendations: result.recommendations || [],
      generalAdvice: result.generalAdvice,
      avoidStyles: result.avoidStyles,
      model: 'gpt-4.1-mini',
      tokens: response.usage?.total_tokens || 0,
      processingTime: Date.now() - startTime,
      cost: this.estimateCost('gpt-4.1-mini', response.usage?.total_tokens || 0)
    };
  }

  async recommendOutfit(imageUrl, occasion = 'casual', season = 'tropical') {
    const startTime = Date.now();
    
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: PROMPTS.outfitRecommendation(occasion, season) },
            { type: 'input_image', image_url: imageUrl, detail: 'high' }
          ]
        }
      ]
    });
    
    const outputText = response.output_text || '';
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    
    return {
      colorAnalysis: result.colorAnalysis,
      outfitRecommendations: result.outfitRecommendations || [],
      styleIdentity: result.styleIdentity,
      shoppingList: result.shoppingList,
      model: 'gpt-4.1-mini',
      tokens: response.usage?.total_tokens || 0,
      processingTime: Date.now() - startTime,
      cost: this.estimateCost('gpt-4.1-mini', response.usage?.total_tokens || 0)
    };
  }

  // Use gpt-image-2 for generation (latest model)
  async generatePreview(imageUrl, analysis, transformationType = 'modern_gentleman') {
    const startTime = Date.now();
    
    const prompt = PROMPTS.previewGeneration(analysis, transformationType);
    
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: `Generate a photorealistic hairstyle makeover image. ${prompt}`,
      tools: [{ type: 'image_generation' }]
    });
    
    // Extract generated image from response
    const imageData = response.output
      .filter(output => output.type === 'image_generation_call')
      .map(output => output.result);
    
    return {
      generatedImageBase64: imageData[0] || null,
      model: 'gpt-image-2',
      processingTime: Date.now() - startTime,
      cost: 0.08 // Fixed cost for image generation
    };
  }

  async combinedAnalysis(imageUrl) {
    const startTime = Date.now();
    
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: PROMPTS.combinedAnalysis },
            { type: 'input_image', image_url: imageUrl, detail: 'high' }
          ]
        }
      ]
    });
    
    const outputText = response.output_text || '';
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    
    return {
      analysis: result,
      model: 'gpt-4.1-mini',
      tokens: response.usage?.total_tokens || 0,
      processingTime: Date.now() - startTime,
      cost: this.estimateCost('gpt-4.1-mini', response.usage?.total_tokens || 0)
    };
  }

  // Cost estimation
  estimateCost(model, tokens) {
    // gpt-4.1-mini: ~$0.40 per 1M tokens
    const costPer1M = 0.40;
    return (tokens / 1000000) * costPer1M;
  }

  async processByType(imageUrl, serviceType, preferences = {}) {
    switch (serviceType) {
      case 'face_analysis':
        return this.analyzeFace(imageUrl);
      case 'hairstyle':
        return this.recommendHairstyle(imageUrl, preferences);
      case 'outfit':
        return this.recommendOutfit(imageUrl, preferences.occasion, preferences.season);
      case 'preview':
        const analysis = await this.analyzeFace(imageUrl);
        return this.generatePreview(imageUrl, analysis.analysis, preferences.transformationType);
      default:
        throw new Error(`Unknown service type: ${serviceType}`);
    }
  }

  // Test connection
  async testConnection() {
    try {
      const models = await openai.models.list();
      return { 
        success: true, 
        availableModels: models.data.length,
        message: 'OpenAI API key valid!' 
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
}

module.exports = new AIService();
