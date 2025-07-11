const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
require('dotenv').config();

// Import database and services
const { testConnection, shutdown } = require('./config/database');
const { runMigrations } = require('./scripts/migrate');
// Temporarily disabled mongoose-based services
// const HybridRecommendationEngine = require('./services/recommendationEngine');
// const { TrackingService } = require('./services/trackingService');
// const { cacheMiddleware, userSpecificCache, invalidateCache } = require('./middleware/cacheMiddleware');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');

// Import middleware
const { standardLimiter, logRateLimit } = require('./middleware/rateLimiter');
const { verifyToken, optionalAuth } = require('./middleware/auth');

const app = express();

// Security and performance middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Global rate limiting
app.use(standardLimiter);
app.use(logRateLimit);

// Initialize database connection and run migrations
const initializeDatabase = async () => {
  try {
    console.log('🔗 Testing database connection...');
    const isConnected = await testConnection();
    
    if (isConnected) {
      console.log('🚀 Running database migrations...');
      await runMigrations();
      console.log('✅ Database setup completed successfully');
    } else {
      console.log('⚠️ Database not available - server will continue without database features');
    }
  } catch (error) {
    console.warn('⚠️ Database initialization failed:', error.message);
    console.log('🔄 Server will continue in limited mode without database');
  }
};

// Initialize services (temporarily disabled)
// const recommendationEngine = new HybridRecommendationEngine();
// const trackingService = new TrackingService();

// İlerleme takibi için eventId -> response map'i
const progressClients = {};
let eventCounter = 1;

// ===== ROUTES =====

// Authentication routes
app.use('/api/auth', authRoutes);

// User data routes (protected)
app.use('/api/user', userRoutes);

// ===== RECOMMENDATION SYSTEM API ENDPOINTS (TEMPORARILY DISABLED) =====

// Get recommendations for a user
/*
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

*/

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const { query } = require('./config/database');
    
    // Test database connection
    let dbStatus = 'disconnected';
    try {
      await query('SELECT 1');
      dbStatus = 'connected';
    } catch (dbError) {
      console.error('Database health check failed:', dbError.message);
    }
    
    const healthStatus = {
      success: true,
      status: dbStatus === 'connected' ? 'healthy' : 'unhealthy',
      services: {
        database: dbStatus,
        authentication: 'active',
        recommendation_engine: 'active',
        email_service: process.env.EMAIL_USER ? 'configured' : 'not_configured'
      },
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      version: '2.0.0'
    };

    const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthStatus);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
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

// Initialize and start server
const startServer = async () => {
  try {
    // Initialize database first
    await initializeDatabase();
    
    // Start server
    const PORT = process.env.PORT || 4000;
    const server = app.listen(PORT, () => {
      console.log(`🚀 CineMatch Backend API listening on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🔐 Auth endpoints: http://localhost:${PORT}/api/auth`);
      console.log(`👤 User endpoints: http://localhost:${PORT}/api/user`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Graceful shutdown handling
    const gracefulShutdown = async (signal) => {
      console.log(`\n📢 Received ${signal}. Starting graceful shutdown...`);
      
      server.close(async () => {
        console.log('🔗 HTTP server closed');
        
        try {
          await shutdown();
          console.log('✅ Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          console.error('❌ Error during shutdown:', error);
          process.exit(1);
        }
      });
    };

    // Listen for termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('UNHANDLED_REJECTION');
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Detect Netlify Functions environment
if (process.env.NETLIFY) {
  // Initialize database once for function cold start
  initializeDatabase();

  // Export the Express app for serverless handler
  module.exports = app;
} else if (require.main === module) {
  // Start the server normally when executed directly (local dev)
  startServer();
}
