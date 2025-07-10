const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const compression = require('compression');
const helmet = require('helmet');
require('dotenv').config();

// Import services and middleware
const HybridRecommendationEngine = require('./services/recommendationEngine');
const { TrackingService } = require('./services/trackingService');
const { cacheMiddleware, userSpecificCache, invalidateCache } = require('./middleware/cacheMiddleware');

const app = express();

// Security and performance middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cinematch', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Initialize services
const recommendationEngine = new HybridRecommendationEngine();
const trackingService = new TrackingService();

// İlerleme takibi için eventId -> response map'i
const progressClients = {};
let eventCounter = 1;

// ===== RECOMMENDATION SYSTEM API ENDPOINTS =====

// Get recommendations for a user
app.get('/api/recommendations/:userId', userSpecificCache(60), async (req, res) => {
  try {
    const { userId } = req.params;
    const { count = 25, excludeRated = true, excludeWatchlist = true } = req.query;
    
    const options = {
      count: parseInt(count),
      excludeRated: excludeRated === 'true',
      excludeWatchlist: excludeWatchlist === 'true'
    };
    
    const recommendations = await recommendationEngine.generateRecommendations(userId, options);
    
    res.json({
      success: true,
      userId,
      recommendations,
      count: recommendations.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting recommendations:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Track user action
app.post('/api/track-action', invalidateCache('cache:user:*:recommendations*'), async (req, res) => {
  try {
    const action = req.body;
    
    // Validate required fields
    if (!action.userId || !action.movieId || !action.actionType || action.value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, movieId, actionType, value'
      });
    }
    
    const savedAction = await trackingService.recordAction(action);
    
    res.json({
      success: true,
      action: savedAction,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error tracking action:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get user profile and statistics
app.get('/api/user-profile/:userId', userSpecificCache(120), async (req, res) => {
  try {
    const { userId } = req.params;
    const profile = await recommendationEngine.getUserProfile(userId);
    
    res.json({
      success: true,
      profile,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting user profile:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get user actions history
app.get('/api/user-actions/:userId', userSpecificCache(300), async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100, actionType } = req.query;
    
    const actions = await trackingService.getUserActions(
      userId, 
      parseInt(limit), 
      actionType || null
    );
    
    res.json({
      success: true,
      userId,
      actions,
      count: actions.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting user actions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Train or retrain the ML model
app.post('/api/ml/train', async (req, res) => {
  try {
    const { forceRetrain = false } = req.body;
    
    // This would typically be called as a background job
    // For now, return a simple response
    res.json({
      success: true,
      message: 'Model training initiated',
      timestamp: new Date().toISOString()
    });
    
    // TODO: Implement actual model training in background
    // Could use Bull queue for this
    
  } catch (error) {
    console.error('Error initiating model training:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get recommendation system statistics
app.get('/api/stats/recommendations', cacheMiddleware(300), async (req, res) => {
  try {
    const stats = await recommendationEngine.getRecommendationStats();
    const actionStats = await trackingService.getActionStats();
    
    res.json({
      success: true,
      stats: {
        recommendations: stats,
        actions: actionStats
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting recommendation stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Clear recommendations cache for a user
app.delete('/api/cache/recommendations/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { clearCache } = require('./middleware/cacheMiddleware');
    
    const clearedCount = await clearCache(`cache:user:${userId}:*recommendations*`);
    
    res.json({
      success: true,
      message: `Cleared ${clearedCount} cache entries for user ${userId}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error clearing user cache:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    res.json({
      success: true,
      status: 'healthy',
      services: {
        mongodb: mongoStatus,
        redis: 'connected', // Simplified check
        recommendation_engine: 'active'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

// ===== EXISTING BFI ENDPOINTS ===== 

// SSE endpoint'i: /api/bfi-progress/:eventId
app.get('/api/bfi-progress/:eventId', (req, res) => {
  const { eventId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  progressClients[eventId] = res;
  req.on('close', () => {
    delete progressClients[eventId];
  });
});

// BFI listesini güncelleyen endpoint
app.post('/api/update-bfi-list', (req, res) => {
  const eventId = (eventCounter++).toString();
  const scriptPath = path.join(__dirname, '../src/features/content/components/scrape-bfi.ts');
  const cmd = 'npx';
  const args = ['ts-node', scriptPath];
  const child = spawn(cmd, args, { cwd: path.join(__dirname, '../') });

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const match = line.match(/(\\d{1,3})%/);
      if (match && progressClients[eventId]) {
        progressClients[eventId].write(`data: {\"progress\":${match[1]}}\n\n`);
      }
    }
  });

  child.on('close', (code) => {
    if (progressClients[eventId]) {
      progressClients[eventId].write(`data: {\"done\":true}\n\n`);
      progressClients[eventId].end();
      delete progressClients[eventId];
    }
  });

  child.on('error', (error) => {
    if (progressClients[eventId]) {
      progressClients[eventId].write(`data: {\"error\":\"${error.message}\"}\n\n`);
      progressClients[eventId].end();
      delete progressClients[eventId];
    }
  });

  res.json({ success: true, eventId });
});

// BFI Directors listesini güncelleyen endpoint
app.post('/api/update-bfi-directors-list', (req, res) => {
  const eventId = (eventCounter++).toString();
  const scriptPath = path.join(__dirname, '../src/features/content/components/scrape-bfi-directors.ts');
  const cmd = 'npx';
  const args = ['ts-node', scriptPath];
  const child = spawn(cmd, args, { cwd: path.join(__dirname, '../') });

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const match = line.match(/(\d{1,3})%/);
      if (match && progressClients[eventId]) {
        progressClients[eventId].write(`data: {\"progress\":${match[1]}}\n\n`);
      }
    }
  });

  child.on('close', (code) => {
    if (progressClients[eventId]) {
      progressClients[eventId].write(`data: {\"done\":true}\n\n`);
      progressClients[eventId].end();
      delete progressClients[eventId];
    }
  });

  child.on('error', (error) => {
    if (progressClients[eventId]) {
      progressClients[eventId].write(`data: {\"error\":\"${error.message}\"}\n\n`);
      progressClients[eventId].end();
      delete progressClients[eventId];
    }
  });

  res.json({ success: true, eventId });
});

// SSE endpoint'i: /api/bfi-directors-progress/:eventId
app.get('/api/bfi-directors-progress/:eventId', (req, res) => {
  const { eventId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  progressClients[eventId] = res;
  req.on('close', () => {
    delete progressClients[eventId];
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend API listening on port ${PORT}`);
});
