const mongoose = require('mongoose');
const Redis = require('ioredis');

// User Action Schema
const userActionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  movieId: { type: Number, required: true, index: true },
  actionType: { 
    type: String, 
    required: true, 
    enum: ['click', 'view', 'rate', 'watchTime', 'add_watchlist', 'remove_watchlist'] 
  },
  value: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
  sessionId: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed }
});

userActionSchema.index({ userId: 1, timestamp: -1 });
userActionSchema.index({ movieId: 1, actionType: 1 });

const UserAction = mongoose.model('UserAction', userActionSchema);

class TrackingService {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.updateThreshold = 100; // Trigger model update after 100 new actions
  }

  async recordAction(action) {
    try {
      // Validate action
      const validatedAction = this.validateAction(action);
      
      // Save to MongoDB
      const savedAction = await UserAction.create(validatedAction);
      
      // Add to Redis for real-time processing
      await this.redis.lpush(
        `user:${action.userId}:actions`, 
        JSON.stringify(validatedAction)
      );
      
      // Keep only last 1000 actions per user in Redis
      await this.redis.ltrim(`user:${action.userId}:actions`, 0, 999);
      
      // Update global action counter
      const actionCount = await this.redis.incr('total_actions_count');
      
      // Trigger model update if threshold reached
      if (actionCount % this.updateThreshold === 0) {
        this.triggerModelUpdate(action.userId);
      }
      
      return savedAction;
    } catch (error) {
      console.error('Error recording action:', error);
      throw error;
    }
  }

  validateAction(action) {
    const { userId, movieId, actionType, value } = action;
    
    if (!userId || !movieId || !actionType || value === undefined) {
      throw new Error('Missing required action fields');
    }
    
    if (!['click', 'view', 'rate', 'watchTime', 'add_watchlist', 'remove_watchlist'].includes(actionType)) {
      throw new Error('Invalid action type');
    }
    
    // Validate rating values
    if (actionType === 'rate' && (value < 1 || value > 10)) {
      throw new Error('Rating must be between 1 and 10');
    }
    
    return {
      ...action,
      timestamp: action.timestamp || new Date(),
      sessionId: action.sessionId || this.generateSessionId()
    };
  }

  generateSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  async getUserActions(userId, limit = 100, actionType = null) {
    try {
      const query = { userId };
      if (actionType) {
        query.actionType = actionType;
      }
      
      return await UserAction.find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
    } catch (error) {
      console.error('Error fetching user actions:', error);
      throw error;
    }
  }

  async getRecentActions(userId, hours = 24) {
    try {
      const cachedActions = await this.redis.lrange(`user:${userId}:actions`, 0, -1);
      return cachedActions.map(action => JSON.parse(action));
    } catch (error) {
      console.error('Error fetching recent actions:', error);
      throw error;
    }
  }

  async getMovieInteractions(movieId, actionType = null) {
    try {
      const query = { movieId };
      if (actionType) {
        query.actionType = actionType;
      }
      
      return await UserAction.find(query)
        .sort({ timestamp: -1 })
        .lean();
    } catch (error) {
      console.error('Error fetching movie interactions:', error);
      throw error;
    }
  }

  async triggerModelUpdate(userId) {
    try {
      // Add to model update queue
      await this.redis.lpush('model_update_queue', JSON.stringify({
        userId,
        timestamp: new Date(),
        type: 'incremental_update'
      }));
      
      console.log(`Triggered model update for user: ${userId}`);
    } catch (error) {
      console.error('Error triggering model update:', error);
    }
  }

  async getActionStats() {
    try {
      const totalActions = await this.redis.get('total_actions_count') || 0;
      const recentActions = await UserAction.countDocuments({
        timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });
      
      const actionsByType = await UserAction.aggregate([
        {
          $group: {
            _id: '$actionType',
            count: { $sum: 1 }
          }
        }
      ]);
      
      return {
        totalActions: parseInt(totalActions),
        recentActions,
        actionsByType
      };
    } catch (error) {
      console.error('Error fetching action stats:', error);
      throw error;
    }
  }
}

module.exports = { TrackingService, UserAction };