import Redis from 'ioredis';
import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';

interface CacheOptions {
  ttl: number; // Time to live in seconds
  keyGenerator?: (req: Request) => string;
  condition?: (req: Request) => boolean;
  compress?: boolean;
  tags?: string[];
  skipCache?: (req: Request, res: Response) => boolean;
}

interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalRequests: number;
}

export class SmartCacheMiddleware {
  private redis: Redis;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    totalRequests: 0
  };

  constructor(redisInstance: Redis) {
    this.redis = redisInstance;
  }

  /**
   * Plan 2.2: Ana cache middleware factory
   */
  cache(options: CacheOptions) {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Cache condition kontrolü
      if (options.condition && !options.condition(req)) {
        return next();
      }

      // Skip cache condition kontrolü
      if (options.skipCache && options.skipCache(req, res)) {
        return next();
      }

      try {
        // Cache key oluştur
        const cacheKey = this.generateCacheKey(req, options.keyGenerator);
        
        // Cache'den veri al
        const cachedData = await this.getCachedData(cacheKey);
        
        if (cachedData) {
          // Cache hit
          this.recordCacheHit();
          
          logger.debug('Cache hit', {
            key: cacheKey,
            method: req.method,
            url: req.originalUrl
          });

          // Cached response headers ekle
          res.set({
            'X-Cache': 'HIT',
            'X-Cache-Key': cacheKey,
            'Cache-Control': `max-age=${options.ttl}`
          });

          return res.json(cachedData);
        }

        // Cache miss - response'ı intercept et
        this.recordCacheMiss();
        this.interceptResponse(res, cacheKey, options);
        
        logger.debug('Cache miss', {
          key: cacheKey,
          method: req.method,
          url: req.originalUrl
        });

        next();

      } catch (error) {
        logger.error('Cache middleware error', {
          error: error instanceof Error ? error.message : 'Unknown error',
          url: req.originalUrl
        });
        
        // Cache hatası olursa normal flow'a devam et
        next();
      }
    };
  }

  /**
   * Response'ı intercept ederek cache'e kaydet
   */
  private interceptResponse(
    res: Response, 
    cacheKey: string, 
    options: CacheOptions
  ): void {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    // JSON response intercept
    res.json = (data: any) => {
      this.saveToCacheAsync(cacheKey, data, options);
      
      res.set({
        'X-Cache': 'MISS',
        'X-Cache-Key': cacheKey,
        'Cache-Control': `max-age=${options.ttl}`
      });

      return originalJson(data);
    };

    // Send response intercept (fallback)
    res.send = (data: any) => {
      if (res.get('Content-Type')?.includes('application/json')) {
        try {
          const jsonData = JSON.parse(data);
          this.saveToCacheAsync(cacheKey, jsonData, options);
        } catch (error) {
          // JSON parse edilemiyorsa cache'leme
        }
      }
      
      return originalSend(data);
    };
  }

  /**
   * Cache key generator
   */
  private generateCacheKey(
    req: Request, 
    customGenerator?: (req: Request) => string
  ): string {
    if (customGenerator) {
      return `cache:${customGenerator(req)}`;
    }

    // Default key generation
    const method = req.method.toLowerCase();
    const path = req.originalUrl;
    const query = Object.keys(req.query).length > 0 
      ? `:${Buffer.from(JSON.stringify(req.query)).toString('base64')}` 
      : '';
    
    const userContext = req.headers['user-id'] || 'anonymous';
    
    return `cache:${method}:${path}${query}:${userContext}`;
  }

  /**
   * Cache'den veri al
   */
  private async getCachedData(key: string): Promise<any | null> {
    try {
      const cached = await this.redis.get(key);
      
      if (!cached) {
        return null;
      }

      // Compressed data check
      if (cached.startsWith('COMPRESSED:')) {
        const compressed = cached.substring(11);
        // TODO: Decompression logic
        return JSON.parse(compressed);
      }

      return JSON.parse(cached);
    } catch (error) {
      logger.warn('Failed to get cached data', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Asenkron cache kaydetme
   */
  private saveToCacheAsync(
    key: string, 
    data: any, 
    options: CacheOptions
  ): void {
    // Non-blocking cache save
    setImmediate(async () => {
      try {
        let serializedData = JSON.stringify(data);
        
        // Compression check
        if (options.compress && serializedData.length > 1024) {
          // TODO: Compression logic
          serializedData = `COMPRESSED:${serializedData}`;
        }

        await this.redis.setex(key, options.ttl, serializedData);
        
        // Tags için ek indexleme
        if (options.tags && options.tags.length > 0) {
          await this.indexCacheWithTags(key, options.tags, options.ttl);
        }

        logger.debug('Data cached successfully', {
          key,
          size: serializedData.length,
          ttl: options.ttl,
          tags: options.tags
        });

      } catch (error) {
        logger.warn('Failed to cache data', {
          key,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  }

  /**
   * Tag-based cache indexing
   */
  private async indexCacheWithTags(
    key: string, 
    tags: string[], 
    ttl: number
  ): Promise<void> {
    const promises = tags.map(tag => {
      const tagKey = `cache_tag:${tag}`;
      return this.redis.sadd(tagKey, key);
    });

    await Promise.all(promises);
    
    // Tag keys için TTL ayarla
    const expirePromises = tags.map(tag => {
      const tagKey = `cache_tag:${tag}`;
      return this.redis.expire(tagKey, ttl + 300); // 5 dakika buffer
    });

    await Promise.all(expirePromises);
  }

  /**
   * Tag-based cache invalidation
   */
  async invalidateByTag(tag: string): Promise<number> {
    try {
      const tagKey = `cache_tag:${tag}`;
      const keys = await this.redis.smembers(tagKey);
      
      if (keys.length === 0) {
        return 0;
      }

      // Cache keys'leri sil
      await this.redis.del(...keys);
      
      // Tag key'ini de sil
      await this.redis.del(tagKey);
      
      logger.info('Cache invalidated by tag', {
        tag,
        keysInvalidated: keys.length
      });

      return keys.length;
    } catch (error) {
      logger.error('Failed to invalidate cache by tag', {
        tag,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Pattern-based cache invalidation
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.redis.keys(`cache:${pattern}`);
      
      if (keys.length === 0) {
        return 0;
      }

      await this.redis.del(...keys);
      
      logger.info('Cache invalidated by pattern', {
        pattern,
        keysInvalidated: keys.length
      });

      return keys.length;
    } catch (error) {
      logger.error('Failed to invalidate cache by pattern', {
        pattern,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Cache warming
   */
  async warmCache(
    requests: Array<{ url: string; data: any; ttl: number }>
  ): Promise<void> {
    const promises = requests.map(async ({ url, data, ttl }) => {
      const key = `cache:get:${url}`;
      await this.redis.setex(key, ttl, JSON.stringify(data));
    });

    await Promise.all(promises);
    
    logger.info('Cache warmed', {
      requestsCount: requests.length
    });
  }

  /**
   * Cache statistics
   */
  private recordCacheHit(): void {
    this.stats.hits++;
    this.stats.totalRequests++;
    this.updateHitRate();
  }

  private recordCacheMiss(): void {
    this.stats.misses++;
    this.stats.totalRequests++;
    this.updateHitRate();
  }

  private updateHitRate(): void {
    this.stats.hitRate = this.stats.totalRequests > 0 
      ? (this.stats.hits / this.stats.totalRequests) * 100 
      : 0;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats & {
    redisInfo?: any;
    cacheSize?: number;
  } {
    return {
      ...this.stats,
      // TODO: Redis info ve cache size hesaplama
    };
  }

  /**
   * Cache health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    latency: number;
    details: any;
  }> {
    const start = Date.now();
    
    try {
      await this.redis.ping();
      const latency = Date.now() - start;
      
      return {
        status: latency < 100 ? 'healthy' : 'degraded',
        latency,
        details: {
          hitRate: this.stats.hitRate,
          totalRequests: this.stats.totalRequests
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency: Date.now() - start,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }
}

// Helper functions for creating cache instances
export const createCacheMiddleware = (redis: Redis) => {
  return new SmartCacheMiddleware(redis);
};

// Predefined cache configurations
export const cacheConfigs = {
  // Kısa süreli cache (5 dakika)
  short: { ttl: 300 },
  
  // Orta süreli cache (1 saat)  
  medium: { ttl: 3600 },
  
  // Uzun süreli cache (24 saat)
  long: { ttl: 86400 },
  
  // Movie details cache
  movieDetails: {
    ttl: 3600,
    keyGenerator: (req: Request) => `movie:${req.params.id}`,
    tags: ['movies'],
    condition: (req: Request) => !!req.params.id
  },
  
  // User recommendations cache
  recommendations: {
    ttl: 300,
    keyGenerator: (req: Request) => `rec:${req.params.userId}`,
    tags: ['recommendations'],
    condition: (req: Request) => !!req.params.userId
  },
  
  // Popular movies cache
  popular: {
    ttl: 1800, // 30 minutes
    keyGenerator: () => 'popular_movies',
    tags: ['movies', 'popular']
  }
};