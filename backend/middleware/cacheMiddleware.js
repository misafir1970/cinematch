const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const cacheMiddleware = (ttl = 300) => {
  return async (req, res, next) => {
    try {
      // Generate cache key based on request
      const key = `cache:${req.method}:${req.originalUrl}:${JSON.stringify(req.query)}:${JSON.stringify(req.body)}`;
      
      // Check if response is cached
      const cached = await redis.get(key);
      if (cached) {
        console.log(`Cache hit for: ${req.originalUrl}`);
        return res.json(JSON.parse(cached));
      }
      
      // Store original res.json
      res.sendResponse = res.json;
      
      // Override res.json to cache the response
      res.json = (body) => {
        // Cache successful responses only
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redis.setex(key, ttl, JSON.stringify(body)).catch(err => {
            console.error('Cache set error:', err);
          });
        }
        res.sendResponse(body);
      };
      
      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      next();
    }
  };
};

const invalidateCache = (pattern) => {
  return async (req, res, next) => {
    try {
      // Get all keys matching the pattern
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`Invalidated ${keys.length} cache entries matching: ${pattern}`);
      }
      next();
    } catch (error) {
      console.error('Cache invalidation error:', error);
      next();
    }
  };
};

const conditionalCache = (condition, ttl = 300) => {
  return async (req, res, next) => {
    try {
      const shouldCache = typeof condition === 'function' ? condition(req) : condition;
      
      if (!shouldCache) {
        return next();
      }
      
      return cacheMiddleware(ttl)(req, res, next);
    } catch (error) {
      console.error('Conditional cache error:', error);
      next();
    }
  };
};

const userSpecificCache = (ttl = 300) => {
  return async (req, res, next) => {
    try {
      const userId = req.params.userId || req.query.userId || req.body.userId;
      
      if (!userId) {
        return next();
      }
      
      const key = `cache:user:${userId}:${req.method}:${req.originalUrl}:${JSON.stringify(req.query)}`;
      
      const cached = await redis.get(key);
      if (cached) {
        console.log(`User cache hit for: ${userId} - ${req.originalUrl}`);
        return res.json(JSON.parse(cached));
      }
      
      res.sendResponse = res.json;
      res.json = (body) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redis.setex(key, ttl, JSON.stringify(body)).catch(err => {
            console.error('User cache set error:', err);
          });
        }
        res.sendResponse(body);
      };
      
      next();
    } catch (error) {
      console.error('User specific cache error:', error);
      next();
    }
  };
};

const getCacheStats = async () => {
  try {
    const keys = await redis.keys('cache:*');
    const memory = await redis.memory('usage');
    const info = await redis.info('memory');
    
    return {
      totalKeys: keys.length,
      memoryUsage: memory,
      memoryInfo: info
    };
  } catch (error) {
    console.error('Error getting cache stats:', error);
    return {};
  }
};

const clearCache = async (pattern = 'cache:*') => {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`Cleared ${keys.length} cache entries`);
    }
    return keys.length;
  } catch (error) {
    console.error('Error clearing cache:', error);
    throw error;
  }
};

module.exports = {
  cacheMiddleware,
  invalidateCache,
  conditionalCache,
  userSpecificCache,
  getCacheStats,
  clearCache,
  redis
};