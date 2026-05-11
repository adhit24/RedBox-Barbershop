/**
 * Utility Helpers
 */

const helpers = {
  
  // Format currency
  formatCurrency: (amount, currency = 'IDR') => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0
    }).format(amount);
  },

  // Format date
  formatDate: (date) => {
    return new Date(date).toLocaleDateString('id-ID', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  },

  // Calculate processing time
  calculateDuration: (startTime, endTime) => {
    const duration = endTime - startTime;
    return {
      milliseconds: duration,
      seconds: Math.round(duration / 1000 * 100) / 100
    };
  },

  // Sanitize user input
  sanitizeString: (str) => {
    if (!str) return '';
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/[<>]/g, '')
      .trim();
  },

  // Validate image URL
  isValidImageUrl: (url) => {
    try {
      const parsed = new URL(url);
      const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
      return validExtensions.some(ext => 
        parsed.pathname.toLowerCase().endsWith(ext)
      );
    } catch {
      return false;
    }
  },

  // Generate unique filename
  generateFilename: (userId, extension = 'jpg') => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `ai-${userId}-${timestamp}-${random}.${extension}`;
  },

  // Parse tier from membership
  parseTier: (membershipType) => {
    const tierMap = {
      'bronze': 'basic',
      'silver': 'pro',
      'gold': 'pro',
      'platinum': 'ultra'
    };
    return tierMap[membershipType] || 'basic';
  },

  // Estimate cost
  estimateCost: (serviceType) => {
    const costs = {
      face_analysis: 0.03,
      hairstyle: 0.02,
      outfit: 0.02,
      preview: 0.08
    };
    return costs[serviceType] || 0.03;
  },

  // Sleep function for delays
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  // Retry function
  retry: async (fn, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === retries - 1) throw error;
        await helpers.sleep(delay * (i + 1));
      }
    }
  }
};

module.exports = helpers;
