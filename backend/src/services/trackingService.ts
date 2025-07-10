import Redis from 'ioredis';
import { UserAction } from '@/types';
import { UserActionModel } from '@/models/UserAction';
import { EventEmitter } from 'events';
import { logger } from '@/utils/logger';
import { MLModelUpdateQueue } from '@/ml/modelUpdateQueue';

export class TrackingService extends EventEmitter {
  private redis: Redis;
  private modelUpdateQueue: MLModelUpdateQueue;
  private actionBuffer: UserAction[] = [];
  private bufferSize = 100;
  private flushInterval = 5000; // 5 seconds

  constructor(redis: Redis) {
    super();
    this.redis = redis;
    this.modelUpdateQueue = new MLModelUpdateQueue();
    this.startBufferFlush();
  }

  /**
   * Ana veri toplama fonksiyonu - planın 1.1 bölümü
   */
  async recordAction(action: UserAction): Promise<void> {
    try {
      const enrichedAction = this.enrichAction(action);
      
      // 1. Real-time Redis'e kaydet (anında erişim için)
      await this.saveToRedisStream(enrichedAction);
      
      // 2. Buffer'a ekle (batch processing için)
      this.actionBuffer.push(enrichedAction);
      
      // 3. Critical actions için immediate processing
      if (this.isCriticalAction(enrichedAction)) {
        await this.processCriticalAction(enrichedAction);
      }
      
      // 4. Buffer dolmuşsa flush et
      if (this.actionBuffer.length >= this.bufferSize) {
        await this.flushBuffer();
      }
      
      // 5. Event emit et (real-time listeners için)
      this.emit('userAction', enrichedAction);
      
      logger.info('User action recorded', {
        userId: action.userId,
        movieId: action.movieId,
        actionType: action.actionType,
        value: action.value
      });

    } catch (error) {
      logger.error('Failed to record user action', {
        error: error.message,
        action
      });
      throw error;
    }
  }

  /**
   * Redis stream'e real-time veri yazma
   */
  private async saveToRedisStream(action: UserAction): Promise<void> {
    const streamKey = `user-actions:${action.userId}`;
    
    await this.redis.xadd(
      streamKey,
      '*', // Otomatik timestamp
      'movieId', action.movieId.toString(),
      'actionType', action.actionType,
      'value', action.value.toString(),
      'timestamp', action.timestamp.toISOString(),
      'sessionId', action.sessionId || '',
      'metadata', JSON.stringify(action.metadata || {})
    );

    // Stream boyutunu sınırla (son 1000 entry)
    await this.redis.xtrim(streamKey, 'MAXLEN', '~', 1000);
    
    // Global actions stream'e de ekle (analytics için)
    await this.redis.xadd(
      'global-actions',
      '*',
      'userId', action.userId,
      'movieId', action.movieId.toString(),
      'actionType', action.actionType,
      'value', action.value.toString(),
      'timestamp', action.timestamp.toISOString()
    );
  }

  /**
   * Action'ı contextual bilgilerle zenginleştir
   */
  private enrichAction(action: UserAction): UserAction {
    return {
      ...action,
      timestamp: action.timestamp || new Date(),
      sessionId: action.sessionId || this.generateSessionId(action.userId),
      metadata: {
        ...action.metadata,
        serverTimestamp: new Date().toISOString(),
        source: action.metadata?.source || 'web'
      }
    };
  }

  /**
   * Critical action'lar için immediate processing
   * Rating, watchlist gibi ML model'i etkileyecek aksiyonlar
   */
  private async processCriticalAction(action: UserAction): Promise<void> {
    if (action.actionType === 'rate' || action.actionType === 'addToWatchlist') {
      // Model güncelleme job'ı ekle
      await this.modelUpdateQueue.addUpdateJob({
        userId: action.userId,
        movieId: action.movieId,
        action: action.actionType,
        value: action.value,
        priority: 'high'
      });

      // User profile'ı güncelle
      await this.updateUserProfileCache(action);
    }
  }

  /**
   * User profile cache'ini güncelle
   */
  private async updateUserProfileCache(action: UserAction): Promise<void> {
    const cacheKey = `user-profile:${action.userId}`;
    
    // Mevcut profile'ı al
    const cachedProfile = await this.redis.get(cacheKey);
    
    if (cachedProfile) {
      const profile = JSON.parse(cachedProfile);
      
      // Rating ekle
      if (action.actionType === 'rate') {
        profile.lastRating = {
          movieId: action.movieId,
          rating: action.value,
          timestamp: action.timestamp
        };
        profile.totalRatings = (profile.totalRatings || 0) + 1;
      }
      
      // Cache'i güncelle (1 saat TTL)
      await this.redis.setex(cacheKey, 3600, JSON.stringify(profile));
    }
  }

  /**
   * Buffer'ı MongoDB'ye flush et
   */
  private async flushBuffer(): Promise<void> {
    if (this.actionBuffer.length === 0) return;

    const actionsToFlush = [...this.actionBuffer];
    this.actionBuffer = [];

    try {
      // Batch insert to MongoDB
      await UserActionModel.insertMany(actionsToFlush);
      
      logger.info('Buffer flushed to MongoDB', {
        count: actionsToFlush.length
      });

    } catch (error) {
      logger.error('Failed to flush buffer', {
        error: error.message,
        count: actionsToFlush.length
      });
      
      // Buffer'ı geri yükle (data loss'u önle)
      this.actionBuffer.unshift(...actionsToFlush);
    }
  }

  /**
   * Periyodik buffer flush
   */
  private startBufferFlush(): void {
    setInterval(async () => {
      await this.flushBuffer();
    }, this.flushInterval);
  }

  /**
   * Critical action kontrolü
   */
  private isCriticalAction(action: UserAction): boolean {
    return ['rate', 'addToWatchlist', 'removeFromWatchlist'].includes(action.actionType);
  }

  /**
   * Session ID generator
   */
  private generateSessionId(userId: string): string {
    return `${userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * User'ın son aktivitelerini getir
   */
  async getUserRecentActions(userId: string, limit: number = 10): Promise<UserAction[]> {
    const streamKey = `user-actions:${userId}`;
    
    const result = await this.redis.xrevrange(streamKey, '+', '-', 'COUNT', limit);
    
    return result.map(([id, fields]) => {
      const fieldMap = new Map();
      for (let i = 0; i < fields.length; i += 2) {
        fieldMap.set(fields[i], fields[i + 1]);
      }
      
      return {
        userId,
        movieId: parseInt(fieldMap.get('movieId')),
        actionType: fieldMap.get('actionType') as any,
        value: parseFloat(fieldMap.get('value')),
        timestamp: new Date(fieldMap.get('timestamp')),
        sessionId: fieldMap.get('sessionId'),
        metadata: JSON.parse(fieldMap.get('metadata') || '{}')
      };
    });
  }

  /**
   * Real-time analytics için aktif kullanıcı sayısı
   */
  async getActiveUsersCount(timeWindow: number = 300): Promise<number> {
    const now = Date.now();
    const windowStart = now - (timeWindow * 1000);
    
    // Son timeWindow saniye içinde aktivite gösterenler
    const result = await this.redis.xrange(
      'global-actions',
      windowStart,
      now
    );
    
    const uniqueUsers = new Set();
    result.forEach(([id, fields]) => {
      for (let i = 0; i < fields.length; i += 2) {
        if (fields[i] === 'userId') {
          uniqueUsers.add(fields[i + 1]);
          break;
        }
      }
    });
    
    return uniqueUsers.size;
  }

  /**
   * Service'i temiz bir şekilde kapat
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down TrackingService...');
    
    // Buffer'daki kalan veriyi flush et
    await this.flushBuffer();
    
    // Event listeners'ı temizle
    this.removeAllListeners();
    
    logger.info('TrackingService shutdown complete');
  }
}