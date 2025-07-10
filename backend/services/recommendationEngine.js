const MatrixFactorization = require('../ml/matrixFactorization');
const { TrackingService } = require('./trackingService');
const Redis = require('ioredis');

class HybridRecommendationEngine {
  constructor() {
    this.matrixFactorization = new MatrixFactorization();
    this.trackingService = new TrackingService();
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.cacheTimeout = 300; // 5 minutes
  }

  async generateRecommendations(userId, options = {}) {
    try {
      const {
        count = 25,
        excludeRated = true,
        excludeWatchlist = true,
        minScore = 0.5
      } = options;

      // Check cache first
      const cacheKey = `recommendations:${userId}:${count}`;
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get user profile to determine weights
      const userProfile = await this.getUserProfile(userId);
      const weights = this.calculateWeights(userProfile);

      // Get available movies
      const availableMovies = await this.getAvailableMovies(userId, excludeRated, excludeWatchlist);
      
      if (availableMovies.length === 0) {
        return [];
      }

      // Generate content-based scores
      const contentBasedScores = await this.contentBasedRecommendation(userId, availableMovies);
      
      // Generate collaborative filtering scores
      const collaborativeScores = await this.collaborativeFiltering(userId, availableMovies);

      // Combine scores using adaptive weighting
      const hybridScores = this.combineScores(
        contentBasedScores,
        collaborativeScores,
        weights
      );

      // Sort and filter recommendations
      const recommendations = hybridScores
        .filter(item => item.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, count);

      // Cache results
      await this.redis.setex(cacheKey, this.cacheTimeout, JSON.stringify(recommendations));

      return recommendations;
    } catch (error) {
      console.error('Error generating recommendations:', error);
      throw error;
    }
  }

  async contentBasedRecommendation(userId, availableMovies) {
    try {
      // Get user's rating history
      const userRatings = await this.trackingService.getUserActions(userId, 1000, 'rate');
      
      if (userRatings.length === 0) {
        // Cold start: return popularity-based recommendations
        return this.getPopularityBasedScores(availableMovies);
      }

      // Calculate user preferences
      const userPreferences = this.calculateUserPreferences(userRatings);
      
      // Score movies based on content similarity
      const contentScores = availableMovies.map(movie => {
        const score = this.calculateContentSimilarity(movie, userPreferences);
        return {
          movieId: movie.id,
          movie,
          score,
          source: 'content-based'
        };
      });

      return contentScores;
    } catch (error) {
      console.error('Error in content-based recommendation:', error);
      return [];
    }
  }

  async collaborativeFiltering(userId, availableMovies) {
    try {
      // Try to get predictions from matrix factorization model
      const movieIds = availableMovies.map(movie => movie.id);
      const predictions = await this.matrixFactorization.predict(userId, movieIds);
      
      if (predictions.length === 0) {
        // Fallback to user-based collaborative filtering
        return this.userBasedCollaborativeFiltering(userId, availableMovies);
      }

      // Convert predictions to recommendation format
      const collaborativeScores = predictions.map(pred => {
        const movie = availableMovies.find(m => m.id === pred.movieId);
        return {
          movieId: pred.movieId,
          movie,
          score: this.normalizeScore(pred.score), // Normalize to 0-1 range
          source: 'collaborative-matrix'
        };
      });

      return collaborativeScores;
    } catch (error) {
      console.error('Error in collaborative filtering:', error);
      return this.userBasedCollaborativeFiltering(userId, availableMovies);
    }
  }

  async userBasedCollaborativeFiltering(userId, availableMovies) {
    try {
      // Find similar users
      const similarUsers = await this.findSimilarUsers(userId);
      
      if (similarUsers.length === 0) {
        return this.getPopularityBasedScores(availableMovies);
      }

      // Calculate scores based on similar users' ratings
      const collaborativeScores = await Promise.all(
        availableMovies.map(async movie => {
          const score = await this.calculateCollaborativeScore(movie.id, similarUsers);
          return {
            movieId: movie.id,
            movie,
            score,
            source: 'collaborative-user'
          };
        })
      );

      return collaborativeScores;
    } catch (error) {
      console.error('Error in user-based collaborative filtering:', error);
      return [];
    }
  }

  calculateWeights(userProfile) {
    const ratingCount = userProfile.ratingCount || 0;
    const timeActive = userProfile.timeActive || 0; // days since first rating
    const engagement = userProfile.engagement || 0; // average actions per session

    // Adaptive weighting based on user data
    if (ratingCount < 10) {
      // Cold start: rely more on content-based
      return { 
        content: 0.8, 
        collaborative: 0.2,
        popularity: 0.3
      };
    } else if (ratingCount < 50) {
      // Building profile: balanced approach
      return { 
        content: 0.6, 
        collaborative: 0.4,
        popularity: 0.1
      };
    } else {
      // Experienced user: rely more on collaborative
      const collaborativeWeight = Math.min(0.8, 0.5 + (ratingCount / 200));
      return { 
        content: 1 - collaborativeWeight, 
        collaborative: collaborativeWeight,
        popularity: 0.05
      };
    }
  }

  combineScores(contentScores, collaborativeScores, weights) {
    const movieScoreMap = new Map();

    // Add content-based scores
    contentScores.forEach(item => {
      movieScoreMap.set(item.movieId, {
        ...item,
        contentScore: item.score,
        collaborativeScore: 0
      });
    });

    // Add collaborative scores
    collaborativeScores.forEach(item => {
      if (movieScoreMap.has(item.movieId)) {
        const existing = movieScoreMap.get(item.movieId);
        existing.collaborativeScore = item.score;
      } else {
        movieScoreMap.set(item.movieId, {
          ...item,
          contentScore: 0,
          collaborativeScore: item.score
        });
      }
    });

    // Calculate hybrid scores
    const hybridScores = Array.from(movieScoreMap.values()).map(item => {
      const hybridScore = (
        (item.contentScore * weights.content) +
        (item.collaborativeScore * weights.collaborative)
      );

      return {
        ...item,
        score: hybridScore,
        weights: weights,
        source: 'hybrid'
      };
    });

    return hybridScores;
  }

  async getUserProfile(userId) {
    try {
      // Get user rating history
      const ratings = await this.trackingService.getUserActions(userId, 1000, 'rate');
      
      // Calculate profile metrics
      const ratingCount = ratings.length;
      const avgRating = ratings.length > 0 
        ? ratings.reduce((sum, r) => sum + r.value, 0) / ratings.length 
        : 0;
      
      const firstRating = ratings.length > 0 
        ? Math.min(...ratings.map(r => new Date(r.timestamp).getTime()))
        : Date.now();
      
      const timeActive = Math.floor((Date.now() - firstRating) / (1000 * 60 * 60 * 24));
      
      // Get all user actions for engagement calculation
      const allActions = await this.trackingService.getUserActions(userId, 1000);
      const sessions = this.groupActionsBySessions(allActions);
      const engagement = sessions.length > 0 
        ? allActions.length / sessions.length 
        : 0;

      return {
        userId,
        ratingCount,
        avgRating,
        timeActive,
        engagement,
        genres: this.calculateGenrePreferences(ratings),
        lastActive: ratings.length > 0 
          ? Math.max(...ratings.map(r => new Date(r.timestamp).getTime()))
          : null
      };
    } catch (error) {
      console.error('Error getting user profile:', error);
      return { userId, ratingCount: 0 };
    }
  }

  calculateUserPreferences(ratings) {
    // This would integrate with movie metadata to calculate preferences
    // For now, return a simplified version
    const genrePreferences = {};
    const directorPreferences = {};
    const actorPreferences = {};
    
    // This would be expanded with actual movie metadata
    ratings.forEach(rating => {
      // Placeholder for genre/director/actor preference calculation
      // Would require movie metadata integration
    });

    return {
      genres: genrePreferences,
      directors: directorPreferences,
      actors: actorPreferences,
      avgRating: ratings.reduce((sum, r) => sum + r.value, 0) / ratings.length,
      ratingVariance: this.calculateRatingVariance(ratings)
    };
  }

  calculateContentSimilarity(movie, userPreferences) {
    // Placeholder for content-based similarity calculation
    // Would require movie metadata (genres, directors, actors, etc.)
    
    // For now, return a random score between 0.3 and 0.9
    // In real implementation, this would calculate similarity based on:
    // - Genre overlap
    // - Director/actor preferences
    // - Release year preferences
    // - Runtime preferences
    // - Rating patterns
    
    return Math.random() * 0.6 + 0.3;
  }

  async findSimilarUsers(userId, limit = 10) {
    try {
      // Get user's ratings
      const userRatings = await this.trackingService.getUserActions(userId, 1000, 'rate');
      
      if (userRatings.length === 0) {
        return [];
      }

      const userMovieRatings = new Map(
        userRatings.map(r => [r.movieId, r.value])
      );

      // This would be optimized with proper indexing in a real implementation
      // For now, return a simplified similar users list
      const similarUsers = [];
      
      // Placeholder implementation
      // In real system, would use cosine similarity or Pearson correlation
      
      return similarUsers;
    } catch (error) {
      console.error('Error finding similar users:', error);
      return [];
    }
  }

  async calculateCollaborativeScore(movieId, similarUsers) {
    if (similarUsers.length === 0) {
      return 0;
    }

    // Calculate weighted average rating from similar users
    let totalWeight = 0;
    let weightedSum = 0;

    for (const user of similarUsers) {
      const userActions = await this.trackingService.getUserActions(user.userId, 1000, 'rate');
      const movieRating = userActions.find(a => a.movieId === movieId);
      
      if (movieRating) {
        weightedSum += movieRating.value * user.similarity;
        totalWeight += user.similarity;
      }
    }

    return totalWeight > 0 ? this.normalizeScore(weightedSum / totalWeight) : 0;
  }

  getPopularityBasedScores(movies) {
    // Return scores based on movie popularity
    return movies.map(movie => ({
      movieId: movie.id,
      movie,
      score: Math.random() * 0.5 + 0.3, // Placeholder popularity score
      source: 'popularity'
    }));
  }

  async getAvailableMovies(userId, excludeRated = true, excludeWatchlist = true) {
    try {
      // This would fetch from your movie database
      // For now, return a placeholder list
      const allMovies = []; // Would fetch from database
      
      if (!excludeRated && !excludeWatchlist) {
        return allMovies;
      }

      let excludedMovieIds = new Set();

      if (excludeRated) {
        const ratings = await this.trackingService.getUserActions(userId, 1000, 'rate');
        ratings.forEach(rating => excludedMovieIds.add(rating.movieId));
      }

      if (excludeWatchlist) {
        const watchlistActions = await this.trackingService.getUserActions(userId, 1000, 'add_watchlist');
        watchlistActions.forEach(action => excludedMovieIds.add(action.movieId));
      }

      return allMovies.filter(movie => !excludedMovieIds.has(movie.id));
    } catch (error) {
      console.error('Error getting available movies:', error);
      return [];
    }
  }

  normalizeScore(score) {
    // Normalize score to 0-1 range
    if (score < 1) return 0;
    if (score > 10) return 1;
    return (score - 1) / 9;
  }

  calculateRatingVariance(ratings) {
    if (ratings.length < 2) return 0;
    
    const mean = ratings.reduce((sum, r) => sum + r.value, 0) / ratings.length;
    const variance = ratings.reduce((sum, r) => sum + Math.pow(r.value - mean, 2), 0) / ratings.length;
    
    return variance;
  }

  calculateGenrePreferences(ratings) {
    // Placeholder for genre preference calculation
    // Would require movie metadata
    return {};
  }

  groupActionsBySessions(actions, sessionTimeout = 30 * 60 * 1000) {
    // Group actions by sessions (30 minute timeout)
    const sessions = [];
    let currentSession = [];
    
    actions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    for (const action of actions) {
      const actionTime = new Date(action.timestamp).getTime();
      
      if (currentSession.length === 0) {
        currentSession.push(action);
      } else {
        const lastActionTime = new Date(currentSession[currentSession.length - 1].timestamp).getTime();
        
        if (actionTime - lastActionTime <= sessionTimeout) {
          currentSession.push(action);
        } else {
          sessions.push(currentSession);
          currentSession = [action];
        }
      }
    }
    
    if (currentSession.length > 0) {
      sessions.push(currentSession);
    }
    
    return sessions;
  }

  async getRecommendationStats() {
    try {
      const stats = await this.redis.hgetall('recommendation_stats');
      return {
        totalRecommendations: parseInt(stats.total_recommendations || 0),
        cacheHitRate: parseFloat(stats.cache_hit_rate || 0),
        avgResponseTime: parseFloat(stats.avg_response_time || 0),
        modelAccuracy: parseFloat(stats.model_accuracy || 0)
      };
    } catch (error) {
      console.error('Error getting recommendation stats:', error);
      return {};
    }
  }
}

module.exports = HybridRecommendationEngine;