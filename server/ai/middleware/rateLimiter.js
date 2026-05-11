/**
 * Rate Limiting Middleware - Tier-based
 */

const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);

// In-memory fallback if Redis not available
const memoryStore = new Map();

const rateLimitByTier = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tier = req.user.ai_subscription_tier || 'basic';
    
    // Tier limits
    const limits = {
      basic: { requests: 5, window: 24 * 60 * 60 },     // 5 per day
      pro: { requests: 50, window: 24 * 60 * 60 },      // 50 per day
      ultra: { requests: 100, window: 60 * 60 }        // 100 per hour
    };

    const { requests, window } = limits[tier] || limits.basic;
    const key = `ai_rate_limit:${userId}`;

    // Check Redis or memory
    let current;
    try {
      current = await redis.get(key);
    } catch {
      current = memoryStore.get(key);
    }

    current = parseInt(current) || 0;

    if (current >= requests) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        limit: requests,
        window: `${window / 60} minutes`,
        upgradeUrl: '/membership.html'
      });
    }

    // Increment counter
    try {
      await redis.incr(key);
      await redis.expire(key, window);
    } catch {
      memoryStore.set(key, current + 1);
      setTimeout(() => memoryStore.delete(key), window * 1000);
    }

    next();

  } catch (error) {
    console.error('Rate limit error:', error);
    next(); // Allow request on error
  }
};

// Express rate limiter for stricter endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: 'Too many requests, please try again later'
});

module.exports = { rateLimitByTier, strictLimiter };
