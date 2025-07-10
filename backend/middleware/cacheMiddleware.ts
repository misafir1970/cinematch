import { Request, Response, NextFunction } from 'express';
import * as Redis from 'ioredis';

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  keyGenerator?: (req: Request) => string;
  skipCache?: (req: Request) => boolean;
  varyBy?: string[]; // Headers to vary cache by
  tags?: string[]; // Cache tags for invalidation
}

interface CachedResponse {
  data: any;
  headers: { [key: string]: string };
  statusCode: number;
  timestamp: number;
  tags: string[];
}

class CacheManager {
  private redis: Redis.Redis;
  private defaultTtl: number = 300; // 5 minutes

  constructor(redis: Redis.Redis) {
    this.redis = redis;
  }

  // Generate cache key based on request
  private generateCacheKey(req: Request, keyGenerator?: (req: Request) => string): string {
    if (keyGenerator) {
      return keyGenerator(req);
    }

    const baseKey = `cache:${req.method}:${req.originalUrl}`;
    const queryString = Object.keys(req.query).length > 0 
      ? `:${JSON.stringify(req.query)}` 
      : '';
    
    return `${baseKey}${queryString}`;
  }

  // Generate vary key for cache variations
  private generateVaryKey(req: Request, varyBy: string[] = []): string {
    if (varyBy.length === 0) return '';
    
    const varyValues = varyBy.map(header => 
      req.headers[header.toLowerCase()] || 'none'
    ).join(':');
    
    return `:vary:${varyValues}`;
  }

  // Set cache with metadata
  async setCache(
    key: string, 
    data: any, 
    headers: { [key: string]: string }, 
    statusCode: number,
    ttl: number,
    tags: string[] = []
  ): Promise<void> {
    try {
      const cachedResponse: CachedResponse = {
        data,
        headers,
        statusCode,
        timestamp: Date.now(),
        tags
      };

      // Set main cache entry
      await this.redis.setex(key, ttl, JSON.stringify(cachedResponse));

      // Set cache tags for invalidation
      if (tags.length > 0) {
        const pipeline = this.redis.pipeline();
        tags.forEach(tag => {
          pipeline.sadd(`tag:${tag}`, key);
          pipeline.expire(`tag:${tag}`, ttl + 60); // Slightly longer TTL for tags
        });
        await pipeline.exec();
      }

      // Update cache statistics
      await this.updateCacheStats('set', key, ttl);

    } catch (error) {
      console.error('Error setting cache:', error);
    }
  }

  // Get cache with validation
  async getCache(key: string): Promise<CachedResponse | null> {
    try {
      const cached = await this.redis.get(key);
      if (!cached) {
        await this.updateCacheStats('miss', key);
        return null;
      }

      const cachedResponse: CachedResponse = JSON.parse(cached);
      
      // Validate cache age (optional additional check)
      const age = Date.now() - cachedResponse.timestamp;
      if (age > 3600000) { // 1 hour max age regardless of TTL
        await this.redis.del(key);
        await this.updateCacheStats('expired', key);
        return null;
      }

      await this.updateCacheStats('hit', key);
      return cachedResponse;

    } catch (error) {
      console.error('Error getting cache:', error);
      await this.updateCacheStats('error', key);
      return null;
    }
  }

  // Invalidate cache by tags
  async invalidateByTags(tags: string[]): Promise<void> {
    try {
      for (const tag of tags) {
        const keys = await this.redis.smembers(`tag:${tag}`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
          await this.redis.del(`tag:${tag}`);
        }
      }
    } catch (error) {
      console.error('Error invalidating cache by tags:', error);
    }
  }

  // Invalidate cache by pattern
  async invalidateByPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error('Error invalidating cache by pattern:', error);
    }
  }

  // Update cache statistics
  private async updateCacheStats(operation: string, key: string, ttl?: number): Promise<void> {
    try {
      const statsKey = 'cache:stats';
      const pipeline = this.redis.pipeline();
      
      pipeline.hincrby(statsKey, `${operation}_count`, 1);
      pipeline.hset(statsKey, `last_${operation}`, Date.now());
      
      if (operation === 'set' && ttl) {
        pipeline.hset(statsKey, 'last_ttl', ttl);
      }
      
      await pipeline.exec();
    } catch (error) {
      console.error('Error updating cache stats:', error);
    }
  }

  // Get cache statistics
  async getCacheStats(): Promise<any> {
    try {
      const stats = await this.redis.hgetall('cache:stats');
      const hitRate = stats.hit_count && stats.miss_count 
        ? (parseInt(stats.hit_count) / (parseInt(stats.hit_count) + parseInt(stats.miss_count))) * 100
        : 0;

      return {
        ...stats,
        hit_rate: hitRate.toFixed(2) + '%',
        total_requests: (parseInt(stats.hit_count || '0') + parseInt(stats.miss_count || '0'))
      };
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return {};
    }
  }
}

// Create cache middleware
export const createCacheMiddleware = (redis: Redis.Redis) => {
  const cacheManager = new CacheManager(redis);

  return (options: CacheOptions = {}) => {
    const {
      ttl = 300,
      keyGenerator,
      skipCache,
      varyBy = [],
      tags = []
    } = options;

    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Skip caching for certain conditions
        if (skipCache && skipCache(req)) {
          return next();
        }

        // Skip caching for non-GET requests
        if (req.method !== 'GET') {
          return next();
        }

        // Generate cache key
        const baseKey = cacheManager['generateCacheKey'](req, keyGenerator);
        const varyKey = cacheManager['generateVaryKey'](req, varyBy);
        const cacheKey = `${baseKey}${varyKey}`;

        // Try to get from cache
        const cached = await cacheManager.getCache(cacheKey);
        if (cached) {
          // Set original headers
          Object.entries(cached.headers).forEach(([key, value]) => {
            res.setHeader(key, value);
          });
          
          // Add cache headers
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('X-Cache-Age', Math.floor((Date.now() - cached.timestamp) / 1000));
          
          return res.status(cached.statusCode).json(cached.data);
        }

        // Override res.json to cache the response
        const originalJson = res.json.bind(res);
        const originalStatus = res.status.bind(res);
        let statusCode = 200;

        res.status = (code: number) => {
          statusCode = code;
          return originalStatus(code);
        };

        res.json = (data: any) => {
          // Only cache successful responses
          if (statusCode >= 200 && statusCode < 300) {
            const headers: { [key: string]: string } = {};
            
            // Capture relevant headers
            const headersToCache = ['content-type', 'etag', 'last-modified'];
            headersToCache.forEach(header => {
              const value = res.getHeader(header);
              if (value) {
                headers[header] = String(value);
              }
            });

            // Cache the response asynchronously
            setImmediate(() => {
              cacheManager.setCache(cacheKey, data, headers, statusCode, ttl, tags);
            });
          }

          // Add cache headers
          res.setHeader('X-Cache', 'MISS');
          
          return originalJson(data);
        };

        next();

      } catch (error) {
        console.error('Cache middleware error:', error);
        next();
      }
    };
  };
};

// Specialized caching middlewares
export const movieCache = (redis: Redis.Redis) => {
  const cache = createCacheMiddleware(redis);
  
  return cache({
    ttl: 1800, // 30 minutes
    tags: ['movies'],
    varyBy: ['accept-language'],
    keyGenerator: (req) => `movie:${req.params.id || req.originalUrl}`
  });
};

export const recommendationCache = (redis: Redis.Redis) => {
  const cache = createCacheMiddleware(redis);
  
  return cache({
    ttl: 300, // 5 minutes
    tags: ['recommendations'],
    keyGenerator: (req) => `rec:${req.params.userId || 'anonymous'}:${req.originalUrl}`,
    skipCache: (req) => {
      // Skip cache for real-time requests
      return req.query.realtime === 'true';
    }
  });
};

export const popularMoviesCache = (redis: Redis.Redis) => {
  const cache = createCacheMiddleware(redis);
  
  return cache({
    ttl: 3600, // 1 hour
    tags: ['popular', 'movies'],
    varyBy: ['accept-language']
  });
};

export const searchCache = (redis: Redis.Redis) => {
  const cache = createCacheMiddleware(redis);
  
  return cache({
    ttl: 900, // 15 minutes
    tags: ['search'],
    keyGenerator: (req) => `search:${req.query.q || ''}:${req.originalUrl}`
  });
};

// Cache invalidation helpers
export const invalidateMovieCache = async (redis: Redis.Redis, movieId?: string) => {
  const cacheManager = new CacheManager(redis);
  
  if (movieId) {
    await cacheManager.invalidateByPattern(`cache:*movie:${movieId}*`);
  }
  
  await cacheManager.invalidateByTags(['movies']);
};

export const invalidateUserCache = async (redis: Redis.Redis, userId: string) => {
  const cacheManager = new CacheManager(redis);
  await cacheManager.invalidateByPattern(`cache:*:${userId}:*`);
  await cacheManager.invalidateByTags(['recommendations']);
};

export const invalidateSearchCache = async (redis: Redis.Redis) => {
  const cacheManager = new CacheManager(redis);
  await cacheManager.invalidateByTags(['search']);
};

// Cache warming function
export const warmCache = async (redis: Redis.Redis, routes: string[]) => {
  const axios = require('axios');
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001';
  
  for (const route of routes) {
    try {
      await axios.get(`${baseUrl}${route}`);
    } catch (error) {
      console.warn(`Failed to warm cache for route: ${route}`, error.message);
    }
  }
};

export default createCacheMiddleware;