import { EventEmitter } from 'events';
import * as tf from '@tensorflow/tfjs-node';
import { UserRating, ModelUpdateJob } from '@/types';
import { MatrixFactorization } from './matrixFactorization';
import { logger } from '@/utils/logger';
import Redis from 'ioredis';

interface OnlineLearningConfig {
  batchSize: number;
  learningRate: number;
  updateThreshold: number;
  maxQueueSize: number;
  updateInterval: number; // milliseconds
}

interface ModelPerformanceMetrics {
  accuracy: number;
  loss: number;
  updateCount: number;
  lastUpdated: Date;
  sampleSize: number;
}

export class OnlineLearningService extends EventEmitter {
  private updateQueue: ModelUpdateJob[] = [];
  private matrixFactorization: MatrixFactorization;
  private redis: Redis;
  private config: OnlineLearningConfig;
  private isProcessing = false;
  private metrics: ModelPerformanceMetrics;
  private updateTimer: NodeJS.Timeout | null = null;

  constructor(
    matrixFactorization: MatrixFactorization,
    redis: Redis,
    config: Partial<OnlineLearningConfig> = {}
  ) {
    super();
    
    this.matrixFactorization = matrixFactorization;
    this.redis = redis;
    
    this.config = {
      batchSize: 32,
      learningRate: 0.001,
      updateThreshold: 10,
      maxQueueSize: 1000,
      updateInterval: 5000, // 5 seconds
      ...config
    };

    this.metrics = {
      accuracy: 0,
      loss: 0,
      updateCount: 0,
      lastUpdated: new Date(),
      sampleSize: 0
    };

    this.startPeriodicUpdates();
  }

  /**
   * Plan 3.1: Yeni rating geldiğinde online learning tetikle
   */
  async processNewRating(
    userId: string, 
    movieId: number, 
    rating: number,
    priority: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<void> {
    try {
      // Immediate prediction update - cache'i güncelle
      await this.updateUserPredictionCache(userId, movieId, rating);
      
      // Queue'ya job ekle
      const job: ModelUpdateJob = {
        userId,
        movieId,
        action: 'rate',
        value: rating,
        priority,
        timestamp: new Date()
      };

      this.updateQueue.push(job);
      
      // Priority sıralama
      this.sortQueueByPriority();
      
      // Queue size kontrolü
      if (this.updateQueue.length > this.config.maxQueueSize) {
        this.updateQueue = this.updateQueue.slice(-this.config.maxQueueSize);
        logger.warn('Update queue size exceeded, dropping old jobs');
      }

      // Threshold check for immediate processing
      if (this.updateQueue.length >= this.config.updateThreshold || priority === 'high') {
        await this.processBatchUpdate();
      }

      // Event emit
      this.emit('newRating', { userId, movieId, rating, queueSize: this.updateQueue.length });

      logger.debug('New rating processed for online learning', {
        userId,
        movieId,
        rating,
        queueSize: this.updateQueue.length
      });

    } catch (error) {
      logger.error('Failed to process new rating for online learning', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        movieId,
        rating
      });
      throw error;
    }
  }

  /**
   * Batch model update - planın asenkron kısmı
   */
  private async processBatchUpdate(): Promise<void> {
    if (this.isProcessing || this.updateQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();

    try {
      // Batch'i al
      const batchSize = Math.min(this.config.batchSize, this.updateQueue.length);
      const batch = this.updateQueue.splice(0, batchSize);
      
      logger.info(`Starting batch update with ${batch.length} items`);

      // Rating'leri UserRating formatına çevir
      const ratings: UserRating[] = batch.map(job => ({
        userId: job.userId,
        movieId: job.movieId,
        rating: job.value,
        timestamp: job.timestamp || new Date()
      }));

      // Incremental training
      await this.matrixFactorization.incrementalTrain(ratings, this.config.learningRate);

      // Performance metrics güncelle
      await this.updatePerformanceMetrics(ratings);

      // Cache'leri invalidate et
      await this.invalidateUserCaches(batch.map(job => job.userId));

      const duration = Date.now() - startTime;
      
      this.emit('batchProcessed', {
        batchSize: batch.length,
        duration,
        queueSize: this.updateQueue.length,
        metrics: this.metrics
      });

      logger.info('Batch update completed', {
        batchSize: batch.length,
        duration,
        remainingQueue: this.updateQueue.length,
        accuracy: this.metrics.accuracy
      });

    } catch (error) {
      logger.error('Batch update failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        queueSize: this.updateQueue.length
      });
      
      this.emit('batchFailed', { error, queueSize: this.updateQueue.length });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * User prediction cache'ini anında güncelle
   */
  private async updateUserPredictionCache(
    userId: string, 
    movieId: number, 
    rating: number
  ): Promise<void> {
    try {
      const cacheKey = `user-predictions:${userId}`;
      const cached = await this.redis.hget(cacheKey, movieId.toString());
      
      // Yeni rating'i cache'e ekle
      await this.redis.hset(cacheKey, movieId.toString(), rating.toString());
      await this.redis.expire(cacheKey, 3600); // 1 hour TTL

      // User profile cache'ini de güncelle
      await this.updateUserProfileCache(userId, movieId, rating);

    } catch (error) {
      logger.warn('Failed to update user prediction cache', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        movieId
      });
    }
  }

  /**
   * User profile cache güncelleme
   */
  private async updateUserProfileCache(
    userId: string,
    movieId: number, 
    rating: number
  ): Promise<void> {
    const cacheKey = `user-profile:${userId}`;
    
    try {
      const profileData = await this.redis.get(cacheKey);
      
      if (profileData) {
        const profile = JSON.parse(profileData);
        
        // Son rating'i ekle
        profile.lastRating = {
          movieId,
          rating,
          timestamp: new Date().toISOString()
        };
        
        // Rating count'u güncelle
        profile.totalRatings = (profile.totalRatings || 0) + 1;
        
        // Average rating güncelle
        profile.averageRating = this.calculateMovingAverage(
          profile.averageRating || rating,
          rating,
          profile.totalRatings
        );

        // Cache'e geri yaz
        await this.redis.setex(cacheKey, 3600, JSON.stringify(profile));
      }
    } catch (error) {
      logger.warn('Failed to update user profile cache', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
    }
  }

  /**
   * Moving average hesaplama
   */
  private calculateMovingAverage(currentAvg: number, newValue: number, count: number): number {
    return ((currentAvg * (count - 1)) + newValue) / count;
  }

  /**
   * Priority queue sıralama
   */
  private sortQueueByPriority(): void {
    const priorityWeights = { high: 3, medium: 2, low: 1 };
    
    this.updateQueue.sort((a, b) => {
      const weightA = priorityWeights[a.priority];
      const weightB = priorityWeights[b.priority];
      
      if (weightA !== weightB) {
        return weightB - weightA; // Yüksek priority önce
      }
      
      // Same priority ise timestamp'e göre
      return (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0);
    });
  }

  /**
   * Performance metrics güncelleme
   */
  private async updatePerformanceMetrics(ratings: UserRating[]): Promise<void> {
    try {
      // Sample validation set ile accuracy hesapla
      const validationSample = ratings.slice(0, Math.min(10, ratings.length));
      let totalError = 0;
      let validPredictions = 0;

      for (const rating of validationSample) {
        try {
          const prediction = await this.matrixFactorization.predict(rating.userId, rating.movieId);
          const error = Math.abs(prediction - rating.rating);
          totalError += error;
          validPredictions++;
        } catch (error) {
          // Skip failed predictions
        }
      }

      if (validPredictions > 0) {
        const mae = totalError / validPredictions; // Mean Absolute Error
        const accuracy = Math.max(0, 1 - (mae / 5)); // Normalize to 0-1 (assuming 1-10 rating scale)
        
        // Exponential moving average
        this.metrics.accuracy = this.metrics.accuracy === 0 
          ? accuracy 
          : (this.metrics.accuracy * 0.9) + (accuracy * 0.1);
          
        this.metrics.loss = mae;
      }

      this.metrics.updateCount++;
      this.metrics.lastUpdated = new Date();
      this.metrics.sampleSize = ratings.length;

      // Metrics'i Redis'e kaydet
      await this.redis.setex(
        'ml:metrics',
        300, // 5 minutes
        JSON.stringify(this.metrics)
      );

    } catch (error) {
      logger.error('Failed to update performance metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * User cache'lerini invalidate et
   */
  private async invalidateUserCaches(userIds: string[]): Promise<void> {
    const promises = userIds.map(async (userId) => {
      const keys = [
        `user-predictions:${userId}`,
        `recommendations:${userId}:*`,
        `user-profile:${userId}`
      ];
      
      // Pattern match için keys command
      const userKeys = await this.redis.keys(`recommendations:${userId}:*`);
      
      if (userKeys.length > 0) {
        await this.redis.del(...userKeys);
      }
      
      await this.redis.del(`user-predictions:${userId}`);
    });

    await Promise.allSettled(promises);
  }

  /**
   * Periyodik update'ler başlat
   */
  private startPeriodicUpdates(): void {
    this.updateTimer = setInterval(async () => {
      if (this.updateQueue.length > 0) {
        await this.processBatchUpdate();
      }
    }, this.config.updateInterval);
  }

  /**
   * Adaptif learning rate ayarlama
   */
  async adjustLearningRate(): Promise<void> {
    try {
      const recentMetrics = await this.getRecentMetrics();
      
      if (recentMetrics.length >= 5) {
        const accuracyTrend = this.calculateTrend(recentMetrics.map(m => m.accuracy));
        
        if (accuracyTrend < -0.01) {
          // Accuracy düşüyorsa learning rate'i azalt
          this.config.learningRate *= 0.9;
          logger.info('Learning rate decreased due to accuracy decline', {
            newLearningRate: this.config.learningRate
          });
        } else if (accuracyTrend > 0.01 && this.config.learningRate < 0.01) {
          // Accuracy artıyorsa learning rate'i biraz artır
          this.config.learningRate *= 1.05;
          logger.info('Learning rate increased due to accuracy improvement', {
            newLearningRate: this.config.learningRate
          });
        }
      }
    } catch (error) {
      logger.error('Failed to adjust learning rate', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Trend hesaplama (basit linear regression)
   */
  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope;
  }

  /**
   * Son metrics'leri getir
   */
  private async getRecentMetrics(): Promise<ModelPerformanceMetrics[]> {
    try {
      const metricsHistory = await this.redis.lrange('ml:metrics:history', 0, 9);
      return metricsHistory.map(data => JSON.parse(data));
    } catch (error) {
      return [];
    }
  }

  /**
   * Current metrics'leri getir
   */
  getMetrics(): ModelPerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Queue durumunu getir
   */
  getQueueStatus(): {
    queueSize: number;
    isProcessing: boolean;
    config: OnlineLearningConfig;
  } {
    return {
      queueSize: this.updateQueue.length,
      isProcessing: this.isProcessing,
      config: { ...this.config }
    };
  }

  /**
   * Manuel batch processing tetikle
   */
  async triggerBatchUpdate(): Promise<void> {
    if (!this.isProcessing) {
      await this.processBatchUpdate();
    }
  }

  /**
   * Service'i temiz şekilde kapat
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down OnlineLearningService...');
    
    // Timer'ı durdur
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    
    // Kalan queue'yu process et
    if (this.updateQueue.length > 0) {
      logger.info(`Processing remaining ${this.updateQueue.length} items before shutdown`);
      await this.processBatchUpdate();
    }
    
    // Event listeners'ı temizle
    this.removeAllListeners();
    
    logger.info('OnlineLearningService shutdown complete');
  }
}