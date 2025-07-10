interface UserAction {
  userId: string;
  movieId: number;
  actionType: 'click' | 'view' | 'rate' | 'watchTime' | 'add_watchlist' | 'remove_watchlist';
  value: number;
  timestamp: Date;
  sessionId: string;
  metadata?: {
    deviceType?: string;
    location?: string;
    referrer?: string;
  };
}

interface ActionBatch {
  actions: UserAction[];
  batchId: string;
  timestamp: Date;
}

class TrackingService {
  private redis: any;
  private mongodb: any;
  private batchSize = 100;
  private batchTimeout = 5000; // 5 seconds
  private pendingActions: UserAction[] = [];
  private batchTimer: NodeJS.Timeout | null = null;

  constructor(redis: any, mongodb: any) {
    this.redis = redis;
    this.mongodb = mongodb;
  }

  async recordAction(action: UserAction): Promise<void> {
    try {
      // Validate action
      if (!this.validateAction(action)) {
        throw new Error('Invalid action format');
      }

      // Add timestamp if not present
      if (!action.timestamp) {
        action.timestamp = new Date();
      }

      // Add to pending batch
      this.pendingActions.push(action);

      // Store in MongoDB for persistence
      await this.mongodb.collection('user_actions').insertOne(action);
      
      // Store in Redis for real-time access
      await this.redis.lpush(`user:${action.userId}:actions`, JSON.stringify(action));
      await this.redis.expire(`user:${action.userId}:actions`, 86400); // 24 hours

      // Update user session data
      await this.updateUserSession(action);
      
      // Trigger model update for significant actions
      if (this.isSignificantAction(action)) {
        await this.triggerModelUpdate(action.userId);
      }

      // Process batch if full
      if (this.pendingActions.length >= this.batchSize) {
        await this.processBatch();
      } else if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.processBatch(), this.batchTimeout);
      }

    } catch (error) {
      console.error('Error recording action:', error);
      throw error;
    }
  }

  async recordActions(actions: UserAction[]): Promise<void> {
    try {
      const validActions = actions.filter(action => this.validateAction(action));
      
      if (validActions.length === 0) {
        return;
      }

      // Batch insert to MongoDB
      await this.mongodb.collection('user_actions').insertMany(validActions);

      // Batch update Redis
      const pipeline = this.redis.pipeline();
      validActions.forEach(action => {
        pipeline.lpush(`user:${action.userId}:actions`, JSON.stringify(action));
        pipeline.expire(`user:${action.userId}:actions`, 86400);
      });
      await pipeline.exec();

      // Update real-time metrics
      await this.updateRealTimeMetrics(validActions);

    } catch (error) {
      console.error('Error recording batch actions:', error);
      throw error;
    }
  }

  async getUserActions(userId: string, limit: number = 100, actionType?: string): Promise<UserAction[]> {
    try {
      const query: any = { userId };
      if (actionType) {
        query.actionType = actionType;
      }

      const actions = await this.mongodb
        .collection('user_actions')
        .find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return actions;
    } catch (error) {
      console.error('Error getting user actions:', error);
      return [];
    }
  }

  async getUserActionsStream(userId: string, fromTimestamp: Date): Promise<UserAction[]> {
    try {
      // Get recent actions from Redis first (faster)
      const redisActions = await this.redis.lrange(`user:${userId}:actions`, 0, -1);
      const recentActions = redisActions
        .map((action: string) => JSON.parse(action))
        .filter((action: UserAction) => new Date(action.timestamp) > fromTimestamp);

      if (recentActions.length > 0) {
        return recentActions;
      }

      // Fallback to MongoDB for older data
      const actions = await this.mongodb
        .collection('user_actions')
        .find({
          userId,
          timestamp: { $gt: fromTimestamp }
        })
        .sort({ timestamp: -1 })
        .toArray();

      return actions;
    } catch (error) {
      console.error('Error getting user actions stream:', error);
      return [];
    }
  }

  private async processBatch(): Promise<void> {
    if (this.pendingActions.length === 0) {
      return;
    }

    try {
      const batch: ActionBatch = {
        actions: [...this.pendingActions],
        batchId: this.generateBatchId(),
        timestamp: new Date()
      };

      // Clear pending actions
      this.pendingActions = [];
      
      // Clear timer
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }

      // Process batch for ML pipeline
      await this.processBatchForML(batch);

      // Update analytics
      await this.updateBatchAnalytics(batch);

    } catch (error) {
      console.error('Error processing batch:', error);
    }
  }

  private async updateUserSession(action: UserAction): Promise<void> {
    try {
      const sessionKey = `session:${action.sessionId}`;
      
      // Update session data
      await this.redis.hset(sessionKey, {
        userId: action.userId,
        lastAction: action.actionType,
        lastTimestamp: action.timestamp.toISOString(),
        actionCount: await this.redis.hincrby(sessionKey, 'actionCount', 1)
      });
      
      await this.redis.expire(sessionKey, 1800); // 30 minutes
    } catch (error) {
      console.error('Error updating user session:', error);
    }
  }

  private async triggerModelUpdate(userId: string): Promise<void> {
    try {
      // Add to model update queue
      await this.redis.lpush('model_update_queue', JSON.stringify({
        userId,
        timestamp: new Date(),
        priority: this.calculateUpdatePriority(userId)
      }));
    } catch (error) {
      console.error('Error triggering model update:', error);
    }
  }

  private async processBatchForML(batch: ActionBatch): Promise<void> {
    try {
      // Send batch to ML processing queue
      await this.redis.lpush('ml_processing_queue', JSON.stringify(batch));
    } catch (error) {
      console.error('Error processing batch for ML:', error);
    }
  }

  private async updateRealTimeMetrics(actions: UserAction[]): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      
      actions.forEach(action => {
        // Update action type counters
        pipeline.hincrby('metrics:action_types', action.actionType, 1);
        
        // Update user activity counters
        pipeline.hincrby('metrics:user_activity', action.userId, 1);
        
        // Update hourly metrics
        const hour = new Date(action.timestamp).getHours();
        pipeline.hincrby('metrics:hourly_activity', hour.toString(), 1);
      });

      await pipeline.exec();
    } catch (error) {
      console.error('Error updating real-time metrics:', error);
    }
  }

  private async updateBatchAnalytics(batch: ActionBatch): Promise<void> {
    try {
      // Update batch processing metrics
      await this.redis.hset('analytics:batch_processing', {
        lastBatchId: batch.batchId,
        lastBatchSize: batch.actions.length,
        lastBatchTimestamp: batch.timestamp.toISOString(),
        totalBatches: await this.redis.hincrby('analytics:batch_processing', 'totalBatches', 1)
      });
    } catch (error) {
      console.error('Error updating batch analytics:', error);
    }
  }

  private validateAction(action: UserAction): boolean {
    return !!(
      action.userId &&
      action.movieId &&
      action.actionType &&
      typeof action.value === 'number' &&
      ['click', 'view', 'rate', 'watchTime', 'add_watchlist', 'remove_watchlist'].includes(action.actionType)
    );
  }

  private isSignificantAction(action: UserAction): boolean {
    return ['rate', 'add_watchlist'].includes(action.actionType) || 
           (action.actionType === 'watchTime' && action.value > 300); // 5+ minutes
  }

  private calculateUpdatePriority(userId: string): number {
    // Higher priority for more active users
    // This could be enhanced with more sophisticated logic
    return Math.random(); // Placeholder
  }

  private generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async getTrackingStats(): Promise<any> {
    try {
      const stats = await this.redis.hmget(
        'analytics:batch_processing',
        'totalBatches',
        'lastBatchSize',
        'lastBatchTimestamp'
      );

      const actionTypes = await this.redis.hgetall('metrics:action_types');
      const hourlyActivity = await this.redis.hgetall('metrics:hourly_activity');

      return {
        batches: {
          total: parseInt(stats[0]) || 0,
          lastSize: parseInt(stats[1]) || 0,
          lastTimestamp: stats[2]
        },
        actionTypes,
        hourlyActivity
      };
    } catch (error) {
      console.error('Error getting tracking stats:', error);
      return {};
    }
  }
}

export { TrackingService, UserAction, ActionBatch };