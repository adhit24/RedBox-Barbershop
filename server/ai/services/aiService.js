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

  // Use gpt-image-2-2026-04-21 via Images API
  async generatePreview(imageUrl, analysis, transformationType = 'modern_gentleman') {
    const startTime = Date.now();
    
    const prompt = PROMPTS.previewGeneration(analysis, transformationType);
    
    const response = await openai.images.generate({
      model: 'gpt-image-2-2026-04-21',
      prompt: `Photorealistic hairstyle makeover image. ${prompt}`,
      n: 1,
      size: '1024x1024'
    });
    
    const generatedImageBase64 = response.data?.[0]?.b64_json || null;
    
    return {
      generatedImageBase64,
      model: 'gpt-image-2-2026-04-21',
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

  // Run a single prompt against the image and parse JSON response
  async _runPrompt(promptText, imageUrl) {
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: promptText },
            { type: 'input_image', image_url: imageUrl, detail: 'high' }
          ]
        }
      ]
    });
    const outputText = response.output_text || '';
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    return {
      data: jsonMatch ? JSON.parse(jsonMatch[0]) : {},
      tokens: response.usage?.total_tokens || 0
    };
  }

  // Full analysis: all 5 prompts in parallel
  async fullAnalysis(imageUrl) {
    const startTime = Date.now();

    const [colorResult, outfitResult, eyewearResult, skincareResult, hairstyleResult] = await Promise.all([
      this._runPrompt(PROMPTS.personalColorAnalysis, imageUrl),
      this._runPrompt(PROMPTS.outfitByFaceShape, imageUrl),
      this._runPrompt(PROMPTS.eyewearRecommendation, imageUrl),
      this._runPrompt(PROMPTS.skincareAnalysis, imageUrl),
      this._runPrompt(PROMPTS.hairstyleVisual, imageUrl)
    ]);

    const totalTokens = colorResult.tokens + outfitResult.tokens + eyewearResult.tokens + skincareResult.tokens + hairstyleResult.tokens;

    return {
      personalColor: colorResult.data,
      outfit: outfitResult.data,
      eyewear: eyewearResult.data,
      skincare: skincareResult.data,
      hairstyle: hairstyleResult.data,
      model: 'gpt-4.1-mini',
      tokens: totalTokens,
      processingTime: Date.now() - startTime,
      cost: this.estimateCost('gpt-4.1-mini', totalTokens)
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
      case 'full_analysis':
        return this.fullAnalysis(imageUrl);
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
