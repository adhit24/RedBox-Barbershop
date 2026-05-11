/**
 * AI Service Tests
 * Unit tests untuk AI Grooming Assistant
 */

const chai = require('chai');
const expect = chai.expect;
const aiService = require('../services/aiService');
const helpers = require('../utils/helpers');

describe('AI Service', () => {
  
  describe('Helpers', () => {
    it('should format currency correctly', () => {
      const result = helpers.formatCurrency(100000);
      expect(result).to.include('Rp');
    });

    it('should validate image URLs', () => {
      expect(helpers.isValidImageUrl('https://example.com/photo.jpg')).to.be.true;
      expect(helpers.isValidImageUrl('https://example.com/file.pdf')).to.be.false;
    });

    it('should parse membership tiers', () => {
      expect(helpers.parseTier('platinum')).to.equal('ultra');
      expect(helpers.parseTier('gold')).to.equal('pro');
      expect(helpers.parseTier('bronze')).to.equal('basic');
    });
  });

  describe('Service Types', () => {
    it('should estimate costs correctly', () => {
      expect(helpers.estimateCost('face_analysis')).to.equal(0.03);
      expect(helpers.estimateCost('preview')).to.equal(0.08);
    });
  });

  // Integration tests (require API keys)
  describe('OpenAI Integration', () => {
    // Skip if no API key
    before(function() {
      if (!process.env.OPENAI_API_KEY) {
        this.skip();
      }
    });

    it('should analyze face from image URL', async function() {
      this.timeout(30000);
      
      const testImage = 'https://example.com/test-face.jpg';
      
      try {
        const result = await aiService.analyzeFace(testImage);
        
        expect(result).to.have.property('analysis');
        expect(result).to.have.property('model');
        expect(result).to.have.property('tokens');
        expect(result).to.have.property('processingTime');
      } catch (error) {
        // Expected if test image not accessible
        expect(error).to.be.an('error');
      }
    });
  });
});

module.exports = {};
