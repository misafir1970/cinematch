const { query, getClient } = require('../config/database');

class UserDataService {
  // ===== USER PROFILE MANAGEMENT =====

  // Get user profile
  async getUserProfile(userId) {
    const profileResult = await query(
      `SELECT up.preferences, up.settings, up.favorite_genres, up.watch_providers, 
              up.language_preferences, up.created_at, up.updated_at,
              u.email, u.first_name, u.last_name, u.is_verified, u.last_login
       FROM user_profiles up
       JOIN users u ON up.user_id = u.id
       WHERE up.user_id = $1`,
      [userId]
    );

    if (profileResult.rows.length === 0) {
      throw new Error('User profile not found');
    }

    const profile = profileResult.rows[0];

    // Get user statistics
    const statsResult = await query(
      `SELECT 
         (SELECT COUNT(*) FROM user_ratings WHERE user_id = $1) as total_ratings,
         (SELECT COUNT(*) FROM user_watchlist WHERE user_id = $1) as watchlist_count,
         (SELECT AVG(rating) FROM user_ratings WHERE user_id = $1) as avg_rating,
         (SELECT COUNT(DISTINCT movie_genres) FROM user_ratings WHERE user_id = $1) as genres_rated
       `,
      [userId]
    );

    const stats = statsResult.rows[0];

    return {
      user: {
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        isVerified: profile.is_verified,
        lastLogin: profile.last_login
      },
      profile: {
        preferences: profile.preferences || {},
        settings: profile.settings || {},
        favoriteGenres: profile.favorite_genres || [],
        watchProviders: profile.watch_providers || [],
        languagePreferences: profile.language_preferences || ['en'],
        createdAt: profile.created_at,
        updatedAt: profile.updated_at
      },
      statistics: {
        totalRatings: parseInt(stats.total_ratings) || 0,
        watchlistCount: parseInt(stats.watchlist_count) || 0,
        averageRating: parseFloat(stats.avg_rating) || 0,
        genresRated: parseInt(stats.genres_rated) || 0
      }
    };
  }

  // Update user profile
  async updateUserProfile(userId, profileData) {
    const { preferences, settings, favoriteGenres, watchProviders, languagePreferences } = profileData;

    const updateResult = await query(
      `UPDATE user_profiles 
       SET preferences = $2, settings = $3, favorite_genres = $4, 
           watch_providers = $5, language_preferences = $6, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
       RETURNING preferences, settings, favorite_genres, watch_providers, language_preferences, updated_at`,
      [
        userId, 
        JSON.stringify(preferences || {}), 
        JSON.stringify(settings || {}),
        favoriteGenres || [],
        watchProviders || [],
        languagePreferences || ['en']
      ]
    );

    if (updateResult.rows.length === 0) {
      throw new Error('User profile not found');
    }

    return updateResult.rows[0];
  }

  // ===== RATING MANAGEMENT =====

  // Add or update movie rating
  async rateMovie(userId, ratingData) {
    const { movieId, movieTitle, moviePosterPath, movieReleaseDate, movieGenres, rating, reviewText, isFavorite } = ratingData;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Insert or update rating
      const ratingResult = await client.query(
        `INSERT INTO user_ratings 
         (user_id, movie_id, movie_title, movie_poster_path, movie_release_date, 
          movie_genres, rating, review_text, is_favorite, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, movie_id) 
         DO UPDATE SET 
           rating = EXCLUDED.rating,
           review_text = EXCLUDED.review_text,
           is_favorite = EXCLUDED.is_favorite,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [userId, movieId, movieTitle, moviePosterPath, movieReleaseDate, movieGenres || [], rating, reviewText, isFavorite || false]
      );

      // Record user action
      await client.query(
        `INSERT INTO user_actions 
         (user_id, action_type, movie_id, movie_title, value, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [userId, 'rate', movieId, movieTitle, rating, JSON.stringify({ reviewText, isFavorite })]
      );

      await client.query('COMMIT');
      return ratingResult.rows[0];

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get user ratings
  async getUserRatings(userId, options = {}) {
    const { limit = 50, offset = 0, sortBy = 'created_at', sortOrder = 'DESC', minRating, maxRating } = options;

    let whereClause = 'WHERE user_id = $1';
    let params = [userId];
    let paramIndex = 2;

    if (minRating !== undefined) {
      whereClause += ` AND rating >= $${paramIndex}`;
      params.push(minRating);
      paramIndex++;
    }

    if (maxRating !== undefined) {
      whereClause += ` AND rating <= $${paramIndex}`;
      params.push(maxRating);
      paramIndex++;
    }

    const validSortColumns = ['created_at', 'updated_at', 'rating', 'movie_title'];
    const orderBy = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const ratingsResult = await query(
      `SELECT * FROM user_ratings 
       ${whereClause}
       ORDER BY ${orderBy} ${order}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM user_ratings ${whereClause}`,
      params.slice(0, -2) // Remove limit and offset
    );

    return {
      ratings: ratingsResult.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset
    };
  }

  // Delete user rating
  async deleteRating(userId, movieId) {
    const deleteResult = await query(
      'DELETE FROM user_ratings WHERE user_id = $1 AND movie_id = $2 RETURNING *',
      [userId, movieId]
    );

    if (deleteResult.rows.length === 0) {
      throw new Error('Rating not found');
    }

    // Record user action
    await query(
      `INSERT INTO user_actions 
       (user_id, action_type, movie_id, value, created_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [userId, 'rating_deleted', movieId, 0]
    );

    return deleteResult.rows[0];
  }

  // ===== WATCHLIST MANAGEMENT =====

  // Add movie to watchlist
  async addToWatchlist(userId, movieData) {
    const { movieId, movieTitle, moviePosterPath, movieReleaseDate, movieGenres, status = 'to_watch', notes } = movieData;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const watchlistResult = await client.query(
        `INSERT INTO user_watchlist 
         (user_id, movie_id, movie_title, movie_poster_path, movie_release_date, 
          movie_genres, status, notes, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, movie_id) 
         DO UPDATE SET 
           status = EXCLUDED.status,
           notes = EXCLUDED.notes,
           added_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [userId, movieId, movieTitle, moviePosterPath, movieReleaseDate, movieGenres || [], status, notes]
      );

      // Record user action
      await client.query(
        `INSERT INTO user_actions 
         (user_id, action_type, movie_id, movie_title, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [userId, 'watchlist_add', movieId, movieTitle, JSON.stringify({ status, notes })]
      );

      await client.query('COMMIT');
      return watchlistResult.rows[0];

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get user watchlist
  async getUserWatchlist(userId, options = {}) {
    const { limit = 50, offset = 0, status, sortBy = 'added_at', sortOrder = 'DESC' } = options;

    let whereClause = 'WHERE user_id = $1';
    let params = [userId];
    let paramIndex = 2;

    if (status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    const validSortColumns = ['added_at', 'watched_at', 'movie_title'];
    const orderBy = validSortColumns.includes(sortBy) ? sortBy : 'added_at';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const watchlistResult = await query(
      `SELECT * FROM user_watchlist 
       ${whereClause}
       ORDER BY ${orderBy} ${order}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM user_watchlist ${whereClause}`,
      params.slice(0, -2)
    );

    return {
      watchlist: watchlistResult.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset
    };
  }

  // Update watchlist item
  async updateWatchlistItem(userId, movieId, updateData) {
    const { status, notes, watchedAt } = updateData;

    const updateResult = await query(
      `UPDATE user_watchlist 
       SET status = COALESCE($3, status), 
           notes = COALESCE($4, notes),
           watched_at = COALESCE($5, watched_at)
       WHERE user_id = $1 AND movie_id = $2
       RETURNING *`,
      [userId, movieId, status, notes, watchedAt]
    );

    if (updateResult.rows.length === 0) {
      throw new Error('Watchlist item not found');
    }

    // Record user action
    await query(
      `INSERT INTO user_actions 
       (user_id, action_type, movie_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [userId, 'watchlist_update', movieId, JSON.stringify(updateData)]
    );

    return updateResult.rows[0];
  }

  // Remove from watchlist
  async removeFromWatchlist(userId, movieId) {
    const deleteResult = await query(
      'DELETE FROM user_watchlist WHERE user_id = $1 AND movie_id = $2 RETURNING *',
      [userId, movieId]
    );

    if (deleteResult.rows.length === 0) {
      throw new Error('Watchlist item not found');
    }

    // Record user action
    await query(
      `INSERT INTO user_actions 
       (user_id, action_type, movie_id, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [userId, 'watchlist_remove', movieId]
    );

    return deleteResult.rows[0];
  }

  // ===== USER ACTIONS =====

  // Record user action
  async recordAction(userId, actionData) {
    const { actionType, movieId, movieTitle, value, metadata, sessionId, ipAddress, userAgent } = actionData;

    const actionResult = await query(
      `INSERT INTO user_actions 
       (user_id, action_type, movie_id, movie_title, value, metadata, 
        session_id, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, actionType, movieId, movieTitle, value, JSON.stringify(metadata || {}), sessionId, ipAddress, userAgent]
    );

    return actionResult.rows[0];
  }

  // Get user actions
  async getUserActions(userId, options = {}) {
    const { limit = 100, offset = 0, actionType, startDate, endDate } = options;

    let whereClause = 'WHERE user_id = $1';
    let params = [userId];
    let paramIndex = 2;

    if (actionType) {
      whereClause += ` AND action_type = $${paramIndex}`;
      params.push(actionType);
      paramIndex++;
    }

    if (startDate) {
      whereClause += ` AND created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereClause += ` AND created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    const actionsResult = await query(
      `SELECT * FROM user_actions 
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      actions: actionsResult.rows,
      total: actionsResult.rows.length,
      limit,
      offset
    };
  }

  // ===== ANALYTICS =====

  // Get user analytics
  async getUserAnalytics(userId) {
    // Rating distribution
    const ratingDistResult = await query(
      `SELECT rating, COUNT(*) as count 
       FROM user_ratings 
       WHERE user_id = $1 
       GROUP BY rating 
       ORDER BY rating`,
      [userId]
    );

    // Genre preferences
    const genreStatsResult = await query(
      `SELECT unnest(movie_genres) as genre, COUNT(*) as count, AVG(rating) as avg_rating
       FROM user_ratings 
       WHERE user_id = $1 
       GROUP BY genre 
       ORDER BY count DESC`,
      [userId]
    );

    // Activity over time
    const activityResult = await query(
      `SELECT DATE(created_at) as date, COUNT(*) as action_count
       FROM user_actions 
       WHERE user_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY DATE(created_at) 
       ORDER BY date`,
      [userId]
    );

    // Watchlist status distribution
    const watchlistStatsResult = await query(
      `SELECT status, COUNT(*) as count 
       FROM user_watchlist 
       WHERE user_id = $1 
       GROUP BY status`,
      [userId]
    );

    return {
      ratingDistribution: ratingDistResult.rows,
      genrePreferences: genreStatsResult.rows,
      activityTimeline: activityResult.rows,
      watchlistStats: watchlistStatsResult.rows
    };
  }

  // ===== RECOMMENDATIONS DATA =====

  // Get data for recommendation engine
  async getRecommendationData(userId) {
    // User ratings
    const ratingsResult = await query(
      `SELECT movie_id, rating, movie_genres, created_at
       FROM user_ratings 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    // User profile
    const profileResult = await query(
      `SELECT preferences, favorite_genres, language_preferences
       FROM user_profiles 
       WHERE user_id = $1`,
      [userId]
    );

    // Recent actions
    const actionsResult = await query(
      `SELECT action_type, movie_id, value, created_at
       FROM user_actions 
       WHERE user_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
       ORDER BY created_at DESC`,
      [userId]
    );

    return {
      ratings: ratingsResult.rows,
      profile: profileResult.rows[0] || {},
      recentActions: actionsResult.rows
    };
  }

  // Save recommendation cache
  async saveRecommendationCache(userId, recommendations, cacheKey, expiresAt) {
    await query(
      `INSERT INTO recommendation_cache 
       (user_id, recommendations, cache_key, expires_at, created_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, cache_key)
       DO UPDATE SET 
         recommendations = EXCLUDED.recommendations,
         expires_at = EXCLUDED.expires_at,
         created_at = CURRENT_TIMESTAMP`,
      [userId, JSON.stringify(recommendations), cacheKey, expiresAt]
    );
  }

  // Get recommendation cache
  async getRecommendationCache(userId, cacheKey) {
    const cacheResult = await query(
      `SELECT recommendations, expires_at 
       FROM recommendation_cache 
       WHERE user_id = $1 AND cache_key = $2 AND expires_at > CURRENT_TIMESTAMP`,
      [userId, cacheKey]
    );

    if (cacheResult.rows.length === 0) {
      return null;
    }

    return cacheResult.rows[0].recommendations;
  }
}

module.exports = new UserDataService();