const express = require('express');
const { body, query, validationResult } = require('express-validator');
const userDataService = require('../services/userDataService');
const { verifyToken } = require('../middleware/auth');
const { requireOnboardingComplete } = require('../middleware/onboarding');
const { 
  standardLimiter, 
  actionLimiter,
  logRateLimit 
} = require('../middleware/rateLimiter');

const router = express.Router();

// Apply authentication to all user routes
router.use(verifyToken);
router.use(logRateLimit);

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// ===== USER PROFILE ENDPOINTS =====

// Get user profile
router.get('/profile', standardLimiter, requireOnboardingComplete, async (req, res) => {
  try {
    const profile = await userDataService.getUserProfile(req.user.id);

    res.json({
      success: true,
      profile
    });

  } catch (error) {
    console.error('Get profile error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'User profile not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to get user profile'
    });
  }
});

// Update user profile
router.put('/profile', 
  standardLimiter,
  [
    body('preferences').optional().isObject(),
    body('settings').optional().isObject(),
    body('favoriteGenres').optional().isArray(),
    body('watchProviders').optional().isArray(),
    body('languagePreferences').optional().isArray()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const profileData = req.body;
      
      const updatedProfile = await userDataService.updateUserProfile(req.user.id, profileData);

      res.json({
        success: true,
        message: 'Profile updated successfully',
        profile: updatedProfile
      });

    } catch (error) {
      console.error('Update profile error:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'User profile not found'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to update profile'
      });
    }
  }
);

// ===== RATING ENDPOINTS =====

// Add or update movie rating
router.post('/ratings',
  actionLimiter,
  [
    body('movieId').isInt({ min: 1 }).withMessage('Valid movie ID is required'),
    body('movieTitle').trim().isLength({ min: 1, max: 500 }).withMessage('Movie title is required'),
    body('rating').isFloat({ min: 0, max: 10 }).withMessage('Rating must be between 0 and 10'),
    body('moviePosterPath').optional().isString(),
    body('movieReleaseDate').optional().isISO8601(),
    body('movieGenres').optional().isArray(),
    body('reviewText').optional().isString(),
    body('isFavorite').optional().isBoolean()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const ratingData = req.body;
      
      const rating = await userDataService.rateMovie(req.user.id, ratingData);

      res.json({
        success: true,
        message: 'Movie rated successfully',
        rating
      });

    } catch (error) {
      console.error('Rate movie error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to rate movie'
      });
    }
  }
);

// Get user ratings
router.get('/ratings',
  standardLimiter,
  [
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
    query('sortBy').optional().isIn(['created_at', 'updated_at', 'rating', 'movie_title']),
    query('sortOrder').optional().isIn(['ASC', 'DESC']),
    query('minRating').optional().isFloat({ min: 0, max: 10 }),
    query('maxRating').optional().isFloat({ min: 0, max: 10 })
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const options = {
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0,
        sortBy: req.query.sortBy || 'created_at',
        sortOrder: req.query.sortOrder || 'DESC',
        minRating: req.query.minRating ? parseFloat(req.query.minRating) : undefined,
        maxRating: req.query.maxRating ? parseFloat(req.query.maxRating) : undefined
      };

      const ratings = await userDataService.getUserRatings(req.user.id, options);

      res.json({
        success: true,
        ratings
      });

    } catch (error) {
      console.error('Get ratings error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get ratings'
      });
    }
  }
);

// Delete rating
router.delete('/ratings/:movieId',
  actionLimiter,
  async (req, res) => {
    try {
      const { movieId } = req.params;
      
      if (!movieId || isNaN(parseInt(movieId))) {
        return res.status(400).json({
          success: false,
          error: 'Valid movie ID is required'
        });
      }

      const deletedRating = await userDataService.deleteRating(req.user.id, parseInt(movieId));

      res.json({
        success: true,
        message: 'Rating deleted successfully',
        rating: deletedRating
      });

    } catch (error) {
      console.error('Delete rating error:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Rating not found'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to delete rating'
      });
    }
  }
);

// ===== WATCHLIST ENDPOINTS =====

// Add movie to watchlist
router.post('/watchlist',
  actionLimiter,
  [
    body('movieId').isInt({ min: 1 }).withMessage('Valid movie ID is required'),
    body('movieTitle').trim().isLength({ min: 1, max: 500 }).withMessage('Movie title is required'),
    body('moviePosterPath').optional().isString(),
    body('movieReleaseDate').optional().isISO8601(),
    body('movieGenres').optional().isArray(),
    body('status').optional().isIn(['to_watch', 'watched', 'skipped', 'favorite']),
    body('notes').optional().isString()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const movieData = req.body;
      
      const watchlistItem = await userDataService.addToWatchlist(req.user.id, movieData);

      res.json({
        success: true,
        message: 'Movie added to watchlist',
        watchlistItem
      });

    } catch (error) {
      console.error('Add to watchlist error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add movie to watchlist'
      });
    }
  }
);

// Get user watchlist
router.get('/watchlist',
  standardLimiter,
  requireOnboardingComplete,
  [
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
    query('status').optional().isIn(['to_watch', 'watched', 'skipped', 'favorite']),
    query('sortBy').optional().isIn(['added_at', 'watched_at', 'movie_title']),
    query('sortOrder').optional().isIn(['ASC', 'DESC'])
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const options = {
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0,
        status: req.query.status || undefined,
        sortBy: req.query.sortBy || 'added_at',
        sortOrder: req.query.sortOrder || 'DESC'
      };

      const watchlist = await userDataService.getUserWatchlist(req.user.id, options);

      res.json({
        success: true,
        watchlist
      });

    } catch (error) {
      console.error('Get watchlist error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get watchlist'
      });
    }
  }
);

// Update watchlist item
router.put('/watchlist/:movieId',
  actionLimiter,
  [
    body('status').optional().isIn(['to_watch', 'watched', 'skipped', 'favorite']),
    body('notes').optional().isString(),
    body('watchedAt').optional().isISO8601()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { movieId } = req.params;
      const updateData = req.body;
      
      if (!movieId || isNaN(parseInt(movieId))) {
        return res.status(400).json({
          success: false,
          error: 'Valid movie ID is required'
        });
      }

      const updatedItem = await userDataService.updateWatchlistItem(req.user.id, parseInt(movieId), updateData);

      res.json({
        success: true,
        message: 'Watchlist item updated successfully',
        watchlistItem: updatedItem
      });

    } catch (error) {
      console.error('Update watchlist error:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Watchlist item not found'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to update watchlist item'
      });
    }
  }
);

// Remove from watchlist
router.delete('/watchlist/:movieId',
  actionLimiter,
  async (req, res) => {
    try {
      const { movieId } = req.params;
      
      if (!movieId || isNaN(parseInt(movieId))) {
        return res.status(400).json({
          success: false,
          error: 'Valid movie ID is required'
        });
      }

      const removedItem = await userDataService.removeFromWatchlist(req.user.id, parseInt(movieId));

      res.json({
        success: true,
        message: 'Movie removed from watchlist',
        watchlistItem: removedItem
      });

    } catch (error) {
      console.error('Remove from watchlist error:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Watchlist item not found'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to remove movie from watchlist'
      });
    }
  }
);

// ===== USER ACTIONS ENDPOINTS =====

// Record user action
router.post('/actions',
  actionLimiter,
  [
    body('actionType').trim().isLength({ min: 1, max: 50 }).withMessage('Action type is required'),
    body('movieId').optional().isInt({ min: 1 }),
    body('movieTitle').optional().trim().isLength({ max: 500 }),
    body('value').optional().isNumeric(),
    body('metadata').optional().isObject(),
    body('sessionId').optional().isString()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const actionData = {
        ...req.body,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      };
      
      const action = await userDataService.recordAction(req.user.id, actionData);

      res.json({
        success: true,
        message: 'Action recorded successfully',
        action
      });

    } catch (error) {
      console.error('Record action error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to record action'
      });
    }
  }
);

// Get user actions
router.get('/actions',
  standardLimiter,
  requireOnboardingComplete,
  [
    query('limit').optional().isInt({ min: 1, max: 500 }),
    query('offset').optional().isInt({ min: 0 }),
    query('actionType').optional().isString(),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const options = {
        limit: parseInt(req.query.limit) || 100,
        offset: parseInt(req.query.offset) || 0,
        actionType: req.query.actionType || undefined,
        startDate: req.query.startDate || undefined,
        endDate: req.query.endDate || undefined
      };

      const actions = await userDataService.getUserActions(req.user.id, options);

      res.json({
        success: true,
        actions
      });

    } catch (error) {
      console.error('Get actions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user actions'
      });
    }
  }
);

// ===== ANALYTICS ENDPOINTS =====

// Get user analytics
router.get('/analytics', standardLimiter, requireOnboardingComplete, async (req, res) => {
  try {
    const analytics = await userDataService.getUserAnalytics(req.user.id);

    res.json({
      success: true,
      analytics
    });

  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user analytics'
    });
  }
});

// ===== RECOMMENDATIONS DATA ENDPOINTS =====

// Get data for recommendation engine
router.get('/recommendation-data', standardLimiter, requireOnboardingComplete, async (req, res) => {
  try {
    const data = await userDataService.getRecommendationData(req.user.id);

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('Get recommendation data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recommendation data'
    });
  }
});

// Get recommendation cache
router.get('/recommendation-cache/:cacheKey', standardLimiter, async (req, res) => {
  try {
    const { cacheKey } = req.params;
    
    const cachedRecommendations = await userDataService.getRecommendationCache(req.user.id, cacheKey);

    if (!cachedRecommendations) {
      return res.status(404).json({
        success: false,
        error: 'No cached recommendations found'
      });
    }

    res.json({
      success: true,
      recommendations: cachedRecommendations
    });

  } catch (error) {
    console.error('Get recommendation cache error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cached recommendations'
    });
  }
});

// Save recommendation cache
router.post('/recommendation-cache',
  standardLimiter,
  [
    body('cacheKey').trim().isLength({ min: 1, max: 255 }).withMessage('Cache key is required'),
    body('recommendations').isArray().withMessage('Recommendations must be an array'),
    body('expiresAt').isISO8601().withMessage('Valid expiration date is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { cacheKey, recommendations, expiresAt } = req.body;
      
      await userDataService.saveRecommendationCache(req.user.id, recommendations, cacheKey, expiresAt);

      res.json({
        success: true,
        message: 'Recommendations cached successfully'
      });

    } catch (error) {
      console.error('Save recommendation cache error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cache recommendations'
      });
    }
  }
);

// ===== BULK OPERATIONS =====

// Bulk rate movies
router.post('/ratings/bulk',
  actionLimiter,
  [
    body('ratings').isArray({ min: 1, max: 50 }).withMessage('Ratings array is required (max 50)'),
    body('ratings.*.movieId').isInt({ min: 1 }),
    body('ratings.*.movieTitle').trim().isLength({ min: 1, max: 500 }),
    body('ratings.*.rating').isFloat({ min: 0, max: 10 })
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { ratings } = req.body;
      const results = [];
      const errors = [];

      for (const ratingData of ratings) {
        try {
          const rating = await userDataService.rateMovie(req.user.id, ratingData);
          results.push(rating);
        } catch (error) {
          errors.push({
            movieId: ratingData.movieId,
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        message: `Processed ${results.length} ratings successfully`,
        results,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (error) {
      console.error('Bulk rate movies error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process bulk ratings'
      });
    }
  }
);

// Export user data (GDPR compliance)
router.get('/export', standardLimiter, async (req, res) => {
  try {
    const [profile, ratings, watchlist, actions] = await Promise.all([
      userDataService.getUserProfile(req.user.id),
      userDataService.getUserRatings(req.user.id, { limit: 10000 }),
      userDataService.getUserWatchlist(req.user.id, { limit: 10000 }),
      userDataService.getUserActions(req.user.id, { limit: 10000 })
    ]);

    const exportData = {
      exportDate: new Date().toISOString(),
      profile,
      ratings: ratings.ratings,
      watchlist: watchlist.watchlist,
      actions: actions.actions
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="cinematch_user_data.json"');
    res.json(exportData);

  } catch (error) {
    console.error('Export user data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export user data'
    });
  }
});

module.exports = router;