import { EventEmitter } from 'events';
import * as tf from '@tensorflow/tfjs-node';
import { MatrixFactorization, TrainingData } from './matrixFactorization';
import { TrackingService, UserAction } from '../services/trackingService';

interface OnlineLearningConfig {
  batchSize: number;
  learningRate: number;
  decayRate: number;
  updateThreshold: number;
  maxQueueSize: number;
  modelUpdateInterval: number; // in milliseconds
}

interface ModelUpdate {
  userId: string;
  movieId: number;
  rating: number;
  timestamp: Date;
  priority: number;
  processed: boolean;
}

interface LearningMetrics {
  totalUpdates: number;
  batchUpdates: number;
  incrementalUpdates: number;
  averageLoss: number;
  lastUpdateTime: Date;
  queueSize: number;
  processingTime: number;
}

class OnlineLearningService extends EventEmitter {
  private updateQueue: ModelUpdate[] = [];
  private batchQueue: ModelUpdate[] = [];
  private matrixFactorization: MatrixFactorization;
  private trackingService: TrackingService;
  private config: OnlineLearningConfig;
  private isProcessing: boolean = false;
  private metrics: LearningMetrics;
  private redis: any;
  private mongodb: any;

  constructor(
    matrixFactorization: MatrixFactorization,
    trackingService: TrackingService,
    redis: any,
    mongodb: any,
    config: Partial<OnlineLearningConfig> = {}
  ) {
    super();
    
    this.matrixFactorization = matrixFactorization;
    this.trackingService = trackingService;
    this.redis = redis;
    this.mongodb = mongodb;
    
    this.config = {
      batchSize: config.batchSize || 100,
      learningRate: config.learningRate || 0.001,
      decayRate: config.decayRate || 0.95,
      updateThreshold: config.updateThreshold || 10,
      maxQueueSize: config.maxQueueSize || 10000,
      modelUpdateInterval: config.modelUpdateInterval || 5000
    };

    this.metrics = {
      totalUpdates: 0,
      batchUpdates: 0,
      incrementalUpdates: 0,
      averageLoss: 0,
      lastUpdateTime: new Date(),
      queueSize: 0,
      processingTime: 0
    };

    this.startPeriodicProcessing();
  }

  async processNewRating(userId: string, movieId: number, rating: number): Promise<void> {
    try {
      const priority = await this.calculatePriority(userId, movieId, rating);
      
      const update: ModelUpdate = {
        userId,
        movieId,
        rating,
        timestamp: new Date(),
        priority,
        processed: false
      };

      // Add to update queue
      this.updateQueue.push(update);
      this.updateQueue.sort((a, b) => b.priority - a.priority); // Sort by priority
      
      // Trim queue if too large
      if (this.updateQueue.length > this.config.maxQueueSize) {
        this.updateQueue = this.updateQueue.slice(0, this.config.maxQueueSize);
      }

      // Immediate prediction update for high-priority users
      if (priority > 0.8) {
        await this.updateUserEmbedding(userId, movieId, rating);
      }

      // Trigger batch processing if threshold reached
      if (this.updateQueue.length >= this.config.batchSize) {
        await this.processBatch();
      }

      // Emit event for external listeners
      this.emit('rating_processed', { userId, movieId, rating, priority });

    } catch (error) {
      console.error('Error processing new rating:', error);
      this.emit('error', error);
    }
  }

  private async updateUserEmbedding(userId: string, movieId: number, rating: number): Promise<void> {
    try {
      // Perform incremental learning on the matrix factorization model
      await this.matrixFactorization.incrementalTrain(parseInt(userId), movieId, rating);
      
      // Update user embedding cache
      await this.updateUserEmbeddingCache(userId, movieId, rating);
      
      this.metrics.incrementalUpdates++;
      this.emit('embedding_updated', { userId, movieId, rating });

    } catch (error) {
      console.error('Error updating user embedding:', error);
      throw error;
    }
  }

  private async processBatch(): Promise<void> {
    if (this.isProcessing || this.updateQueue.length === 0) {
      return;
    }

    try {
      this.isProcessing = true;
      const startTime = Date.now();

      // Get batch of updates
      const batch = this.updateQueue.splice(0, this.config.batchSize);
      this.batchQueue.push(...batch);

      // Prepare training data
      const trainingData = this.prepareBatchTrainingData(batch);
      
      if (trainingData.userIds.length > 0) {
        // Update model with batch
        await this.batchUpdateModel(trainingData);
        
        // Mark updates as processed
        batch.forEach(update => update.processed = true);
        
        // Update metrics
        this.metrics.batchUpdates++;
        this.metrics.totalUpdates += batch.length;
        this.metrics.lastUpdateTime = new Date();
        this.metrics.processingTime = Date.now() - startTime;
        this.metrics.queueSize = this.updateQueue.length;

        // Store processed batch for analytics
        await this.storeBatchMetrics(batch, startTime);

        this.emit('batch_processed', { 
          batchSize: batch.length, 
          processingTime: this.metrics.processingTime 
        });
      }

    } catch (error) {
      console.error('Error processing batch:', error);
      this.emit('batch_error', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async batchUpdateModel(trainingData: TrainingData): Promise<void> {
    try {
      // Prepare tensors for training
      const userIds = tf.tensor2d(trainingData.userIds.map(id => [id]), [trainingData.userIds.length, 1]);
      const movieIds = tf.tensor2d(trainingData.movieIds.map(id => [id]), [trainingData.movieIds.length, 1]);
      const ratings = tf.tensor1d(trainingData.ratings);

      // Get current model for incremental training
      const model = this.matrixFactorization['model'];
      if (!model) {
        throw new Error('Matrix factorization model not initialized');
      }

      // Perform incremental training with adaptive learning rate
      const adaptiveLearningRate = this.config.learningRate * Math.pow(this.config.decayRate, this.metrics.batchUpdates);
      
      model.compile({
        optimizer: tf.train.adam(adaptiveLearningRate),
        loss: 'meanSquaredError',
        metrics: ['mae']
      });

      // Train on batch
      const history = await model.fit([userIds, movieIds], ratings, {
        epochs: 1,
        batchSize: Math.min(32, trainingData.userIds.length),
        verbose: 0
      });

      // Update average loss
      const batchLoss = Array.isArray(history.history.loss) 
        ? history.history.loss[0] 
        : history.history.loss;
      
      this.metrics.averageLoss = (this.metrics.averageLoss * this.metrics.batchUpdates + batchLoss) / (this.metrics.batchUpdates + 1);

      // Clean up tensors
      userIds.dispose();
      movieIds.dispose();
      ratings.dispose();

    } catch (error) {
      console.error('Error in batch model update:', error);
      throw error;
    }
  }

  private prepareBatchTrainingData(batch: ModelUpdate[]): TrainingData {
    const userIds: number[] = [];
    const movieIds: number[] = [];
    const ratings: number[] = [];

    batch.forEach(update => {
      userIds.push(parseInt(update.userId));
      movieIds.push(update.movieId);
      ratings.push(update.rating);
    });

    return { userIds, movieIds, ratings };
  }

  private async calculatePriority(userId: string, movieId: number, rating: number): Promise<number> {
    try {
      // Factors that increase priority:
      // 1. User activity level
      // 2. Rating deviation from average
      // 3. Movie popularity
      // 4. Recency of action

      const userActions = await this.trackingService.getUserActions(userId, 100);
      const userActivityScore = Math.min(userActions.length / 100, 1);
      
      // Calculate rating deviation (higher deviation = higher priority)
      const userRatings = userActions
        .filter(action => action.actionType === 'rate')
        .map(action => action.value);
      
      const avgUserRating = userRatings.length > 0 
        ? userRatings.reduce((sum, r) => sum + r, 0) / userRatings.length 
        : 5;
      
      const ratingDeviationScore = Math.abs(rating - avgUserRating) / 5;

      // Movie popularity (from cache or database)
      const moviePopularityScore = await this.getMoviePopularityScore(movieId);

      // Recency score (always 1 for new ratings)
      const recencyScore = 1;

      // Combined priority score
      const priority = (
        userActivityScore * 0.3 +
        ratingDeviationScore * 0.3 +
        moviePopularityScore * 0.2 +
        recencyScore * 0.2
      );

      return Math.min(Math.max(priority, 0), 1);

    } catch (error) {
      console.error('Error calculating priority:', error);
      return 0.5; // Default priority
    }
  }

  private async getMoviePopularityScore(movieId: number): Promise<number> {
    try {
      // Try to get from cache first
      const cached = await this.redis.hget('movie_popularity', movieId.toString());
      if (cached) {
        return parseFloat(cached);
      }

      // Calculate popularity based on rating count and average
      const movieStats = await this.mongodb.collection('movie_stats').findOne({ movieId });
      if (movieStats) {
        const popularityScore = Math.log(movieStats.ratingCount + 1) / Math.log(10000); // Log scale
        
        // Cache for future use
        await this.redis.hset('movie_popularity', movieId.toString(), popularityScore.toString());
        await this.redis.expire('movie_popularity', 3600); // 1 hour TTL
        
        return Math.min(popularityScore, 1);
      }

      return 0.5; // Default if no stats available
    } catch (error) {
      console.error('Error getting movie popularity:', error);
      return 0.5;
    }
  }

  private async updateUserEmbeddingCache(userId: string, movieId: number, rating: number): Promise<void> {
    try {
      // Update user's recent ratings cache
      const recentRatingsKey = `user_recent_ratings:${userId}`;
      await this.redis.lpush(recentRatingsKey, JSON.stringify({ movieId, rating, timestamp: new Date() }));
      await this.redis.ltrim(recentRatingsKey, 0, 99); // Keep last 100 ratings
      await this.redis.expire(recentRatingsKey, 86400); // 24 hours TTL

      // Invalidate user's recommendation cache
      await this.redis.del(`recommendations:${userId}:*`);

    } catch (error) {
      console.error('Error updating user embedding cache:', error);
    }
  }

  private async storeBatchMetrics(batch: ModelUpdate[], startTime: number): Promise<void> {
    try {
      const batchMetrics = {
        batchId: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        size: batch.length,
        processingTime: Date.now() - startTime,
        averagePriority: batch.reduce((sum, update) => sum + update.priority, 0) / batch.length,
        timestamp: new Date(),
        userCount: new Set(batch.map(update => update.userId)).size,
        movieCount: new Set(batch.map(update => update.movieId)).size
      };

      await this.mongodb.collection('batch_metrics').insertOne(batchMetrics);
      
      // Update Redis metrics
      await this.redis.hset('online_learning_metrics', {
        last_batch_size: batch.length,
        last_processing_time: Date.now() - startTime,
        total_batches_processed: await this.redis.hincrby('online_learning_metrics', 'total_batches_processed', 1),
        last_batch_timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error storing batch metrics:', error);
    }
  }

  private startPeriodicProcessing(): void {
    setInterval(async () => {
      if (!this.isProcessing && this.updateQueue.length > 0) {
        await this.processBatch();
      }
    }, this.config.modelUpdateInterval);
  }

  async getMetrics(): Promise<LearningMetrics> {
    this.metrics.queueSize = this.updateQueue.length;
    return { ...this.metrics };
  }

  async getQueueStatus(): Promise<{
    queueSize: number;
    processingStatus: boolean;
    highPriorityCount: number;
    oldestUpdateAge: number;
  }> {
    const highPriorityCount = this.updateQueue.filter(update => update.priority > 0.7).length;
    const oldestUpdate = this.updateQueue.length > 0 
      ? this.updateQueue[this.updateQueue.length - 1]
      : null;
    
    const oldestUpdateAge = oldestUpdate 
      ? Date.now() - oldestUpdate.timestamp.getTime()
      : 0;

    return {
      queueSize: this.updateQueue.length,
      processingStatus: this.isProcessing,
      highPriorityCount,
      oldestUpdateAge
    };
  }

  async forceProcessQueue(): Promise<void> {
    if (!this.isProcessing) {
      await this.processBatch();
    }
  }

  async clearQueue(): Promise<void> {
    this.updateQueue = [];
    this.batchQueue = [];
  }

  dispose(): void {
    this.removeAllListeners();
    this.clearQueue();
  }
}

export { OnlineLearningService, OnlineLearningConfig, ModelUpdate, LearningMetrics };