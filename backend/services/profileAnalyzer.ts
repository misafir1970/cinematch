import { TrackingService, UserAction } from './trackingService';

interface ProfileInsights {
  favoriteGenres: { genre: string; score: number }[];
  favoriteActors: { name: string; count: number }[];
  favoriteDirectors: { name: string; count: number }[];
  watchingPatterns: {
    timeOfDay: { [hour: string]: number };
    dayOfWeek: { [day: string]: number };
    seasonality: { [season: string]: number };
    avgSessionLength: number;
    peakHours: string[];
  };
  moodProfile: {
    action: number;
    drama: number;
    comedy: number;
    romance: number;
    thriller: number;
    horror: number;
    documentary: number;
    scifi: number;
  };
  ratingPatterns: {
    averageRating: number;
    ratingDistribution: { [rating: string]: number };
    ratingTrend: 'increasing' | 'decreasing' | 'stable';
    harshness: number; // How harsh the user is compared to average
  };
  engagementLevel: {
    level: 'low' | 'medium' | 'high' | 'very_high';
    score: number;
    factors: string[];
  };
  recommendations: {
    exploreNewGenres: string[];
    revisitOldFavorites: any[];
    basedOnMood: any[];
  };
}

interface UserBehavior {
  viewingHistory: UserAction[];
  ratingHistory: UserAction[];
  searchHistory: UserAction[];
  watchlistActions: UserAction[];
  clickPatterns: UserAction[];
}

interface MoodClassification {
  primaryMood: string;
  moodScores: { [mood: string]: number };
  confidence: number;
  factors: string[];
}

class ProfileAnalyzer {
  private trackingService: TrackingService;
  private redis: any;
  private mongodb: any;
  private moodClassifier: MoodClassifier;

  constructor(trackingService: TrackingService, redis: any, mongodb: any) {
    this.trackingService = trackingService;
    this.redis = redis;
    this.mongodb = mongodb;
    this.moodClassifier = new MoodClassifier();
  }

  async generateInsights(userId: string): Promise<ProfileInsights> {
    try {
      // Check cache first
      const cacheKey = `profile_insights:${userId}`;
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Gather user behavior data
      const userBehavior = await this.gatherUserBehavior(userId);
      
      // Generate different insights
      const [
        favoriteGenres,
        favoriteActors,
        favoriteDirectors,
        watchingPatterns,
        moodProfile,
        ratingPatterns,
        engagementLevel
      ] = await Promise.all([
        this.analyzeGenrePreferences(userBehavior),
        this.analyzeActorPreferences(userBehavior),
        this.analyzeDirectorPreferences(userBehavior),
        this.analyzeTemporalPatterns(userBehavior),
        this.analyzeMoodProfile(userBehavior),
        this.analyzeRatingPatterns(userBehavior),
        this.analyzeEngagementLevel(userBehavior)
      ]);

      // Generate personalized recommendations
      const recommendations = await this.generatePersonalizedRecommendations(
        userId,
        { favoriteGenres, moodProfile, ratingPatterns, engagementLevel }
      );

      const insights: ProfileInsights = {
        favoriteGenres,
        favoriteActors,
        favoriteDirectors,
        watchingPatterns,
        moodProfile,
        ratingPatterns,
        engagementLevel,
        recommendations
      };

      // Cache insights for 1 hour
      await this.redis.setex(cacheKey, 3600, JSON.stringify(insights));

      return insights;

    } catch (error) {
      console.error('Error generating profile insights:', error);
      throw error;
    }
  }

  private async gatherUserBehavior(userId: string): Promise<UserBehavior> {
    try {
      // Get comprehensive user actions
      const [
        viewingHistory,
        ratingHistory,
        searchHistory,
        watchlistActions,
        clickPatterns
      ] = await Promise.all([
        this.trackingService.getUserActions(userId, 1000, 'view'),
        this.trackingService.getUserActions(userId, 1000, 'rate'),
        this.trackingService.getUserActions(userId, 500, 'search'),
        this.trackingService.getUserActions(userId, 200, 'add_watchlist'),
        this.trackingService.getUserActions(userId, 500, 'click')
      ]);

      return {
        viewingHistory,
        ratingHistory,
        searchHistory,
        watchlistActions,
        clickPatterns
      };

    } catch (error) {
      console.error('Error gathering user behavior:', error);
      throw error;
    }
  }

  private async analyzeGenrePreferences(userBehavior: UserBehavior): Promise<{ genre: string; score: number }[]> {
    try {
      const genreScores = new Map<string, number>();
      const genreWeights = new Map<string, number>();

      // Analyze from ratings (highest weight)
      for (const rating of userBehavior.ratingHistory) {
        const movieGenres = await this.getMovieGenres(rating.movieId);
        const weight = rating.value / 10; // Normalize rating to 0-1

        movieGenres.forEach(genre => {
          genreScores.set(genre, (genreScores.get(genre) || 0) + weight * 0.6);
          genreWeights.set(genre, (genreWeights.get(genre) || 0) + 0.6);
        });
      }

      // Analyze from viewing time (medium weight)
      for (const view of userBehavior.viewingHistory) {
        if (view.value > 300) { // 5+ minutes viewing
          const movieGenres = await this.getMovieGenres(view.movieId);
          const weight = Math.min(view.value / 3600, 1); // Normalize to hours, max 1

          movieGenres.forEach(genre => {
            genreScores.set(genre, (genreScores.get(genre) || 0) + weight * 0.3);
            genreWeights.set(genre, (genreWeights.get(genre) || 0) + 0.3);
          });
        }
      }

      // Analyze from watchlist adds (lower weight but positive signal)
      for (const watchlist of userBehavior.watchlistActions) {
        const movieGenres = await this.getMovieGenres(watchlist.movieId);

        movieGenres.forEach(genre => {
          genreScores.set(genre, (genreScores.get(genre) || 0) + 0.1);
          genreWeights.set(genre, (genreWeights.get(genre) || 0) + 0.1);
        });
      }

      // Calculate final scores
      const genrePreferences: { genre: string; score: number }[] = [];
      
      genreScores.forEach((totalScore, genre) => {
        const totalWeight = genreWeights.get(genre) || 1;
        const normalizedScore = totalScore / totalWeight;
        genrePreferences.push({ genre, score: normalizedScore });
      });

      return genrePreferences
        .sort((a, b) => b.score - a.score)
        .slice(0, 10); // Top 10 genres

    } catch (error) {
      console.error('Error analyzing genre preferences:', error);
      return [];
    }
  }

  private async analyzeActorPreferences(userBehavior: UserBehavior): Promise<{ name: string; count: number }[]> {
    try {
      const actorCounts = new Map<string, number>();

      // Analyze highly rated movies
      const highlyRatedMovies = userBehavior.ratingHistory
        .filter(rating => rating.value >= 7)
        .map(rating => rating.movieId);

      for (const movieId of highlyRatedMovies) {
        const actors = await this.getMovieActors(movieId);
        actors.slice(0, 5).forEach((actor, index) => { // Top 5 actors, weight by billing
          const weight = 1 - (index * 0.1); // First actor gets full weight, others get less
          actorCounts.set(actor, (actorCounts.get(actor) || 0) + weight);
        });
      }

      return Array.from(actorCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15); // Top 15 actors

    } catch (error) {
      console.error('Error analyzing actor preferences:', error);
      return [];
    }
  }

  private async analyzeDirectorPreferences(userBehavior: UserBehavior): Promise<{ name: string; count: number }[]> {
    try {
      const directorCounts = new Map<string, number>();

      // Analyze highly rated movies
      const highlyRatedMovies = userBehavior.ratingHistory
        .filter(rating => rating.value >= 7)
        .map(rating => rating.movieId);

      for (const movieId of highlyRatedMovies) {
        const directors = await this.getMovieDirectors(movieId);
        directors.forEach(director => {
          directorCounts.set(director, (directorCounts.get(director) || 0) + 1);
        });
      }

      return Array.from(directorCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10); // Top 10 directors

    } catch (error) {
      console.error('Error analyzing director preferences:', error);
      return [];
    }
  }

  private async analyzeTemporalPatterns(userBehavior: UserBehavior): Promise<ProfileInsights['watchingPatterns']> {
    try {
      const allActions = [
        ...userBehavior.viewingHistory,
        ...userBehavior.ratingHistory,
        ...userBehavior.clickPatterns
      ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const timeOfDay: { [hour: string]: number } = {};
      const dayOfWeek: { [day: string]: number } = {};
      const seasonality: { [season: string]: number } = {};
      const sessionLengths: number[] = [];

      // Analyze time patterns
      allActions.forEach(action => {
        const date = new Date(action.timestamp);
        const hour = date.getHours();
        const day = date.getDay(); // 0 = Sunday
        const month = date.getMonth();
        
        // Time of day
        timeOfDay[hour] = (timeOfDay[hour] || 0) + 1;
        
        // Day of week
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        dayOfWeek[dayNames[day]] = (dayOfWeek[dayNames[day]] || 0) + 1;
        
        // Seasonality
        const season = this.getSeasonFromMonth(month);
        seasonality[season] = (seasonality[season] || 0) + 1;
      });

      // Calculate session lengths
      const sessions = this.groupActionsBySessions(allActions);
      sessions.forEach(session => {
        if (session.length > 1) {
          const sessionStart = new Date(session[0].timestamp).getTime();
          const sessionEnd = new Date(session[session.length - 1].timestamp).getTime();
          sessionLengths.push((sessionEnd - sessionStart) / (1000 * 60)); // in minutes
        }
      });

      const avgSessionLength = sessionLengths.length > 0
        ? sessionLengths.reduce((sum, length) => sum + length, 0) / sessionLengths.length
        : 0;

      // Find peak hours (top 3)
      const peakHours = Object.entries(timeOfDay)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([hour]) => `${hour}:00`);

      return {
        timeOfDay,
        dayOfWeek,
        seasonality,
        avgSessionLength,
        peakHours
      };

    } catch (error) {
      console.error('Error analyzing temporal patterns:', error);
      return {
        timeOfDay: {},
        dayOfWeek: {},
        seasonality: {},
        avgSessionLength: 0,
        peakHours: []
      };
    }
  }

  private async analyzeMoodProfile(userBehavior: UserBehavior): Promise<ProfileInsights['moodProfile']> {
    try {
      const moodScores = {
        action: 0,
        drama: 0,
        comedy: 0,
        romance: 0,
        thriller: 0,
        horror: 0,
        documentary: 0,
        scifi: 0
      };

      // Analyze from ratings
      for (const rating of userBehavior.ratingHistory) {
        const movieGenres = await this.getMovieGenres(rating.movieId);
        const weight = rating.value / 10; // Normalize rating

        movieGenres.forEach(genre => {
          const moodGenre = this.mapGenreToMood(genre);
          if (moodGenre && moodScores.hasOwnProperty(moodGenre)) {
            moodScores[moodGenre as keyof typeof moodScores] += weight;
          }
        });
      }

      // Normalize scores
      const totalScore = Object.values(moodScores).reduce((sum, score) => sum + score, 0);
      if (totalScore > 0) {
        Object.keys(moodScores).forEach(mood => {
          moodScores[mood as keyof typeof moodScores] = 
            moodScores[mood as keyof typeof moodScores] / totalScore;
        });
      }

      return moodScores;

    } catch (error) {
      console.error('Error analyzing mood profile:', error);
      return {
        action: 0.125,
        drama: 0.125,
        comedy: 0.125,
        romance: 0.125,
        thriller: 0.125,
        horror: 0.125,
        documentary: 0.125,
        scifi: 0.125
      };
    }
  }

  private async analyzeRatingPatterns(userBehavior: UserBehavior): Promise<ProfileInsights['ratingPatterns']> {
    try {
      const ratings = userBehavior.ratingHistory.map(r => r.value);
      
      if (ratings.length === 0) {
        return {
          averageRating: 0,
          ratingDistribution: {},
          ratingTrend: 'stable',
          harshness: 0
        };
      }

      const averageRating = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
      
      // Rating distribution
      const ratingDistribution: { [rating: string]: number } = {};
      ratings.forEach(rating => {
        const roundedRating = Math.round(rating).toString();
        ratingDistribution[roundedRating] = (ratingDistribution[roundedRating] || 0) + 1;
      });

      // Rating trend (comparing first half vs second half)
      let ratingTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
      if (ratings.length >= 10) {
        const firstHalf = ratings.slice(0, Math.floor(ratings.length / 2));
        const secondHalf = ratings.slice(Math.floor(ratings.length / 2));
        
        const firstAvg = firstHalf.reduce((sum, r) => sum + r, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, r) => sum + r, 0) / secondHalf.length;
        
        const difference = secondAvg - firstAvg;
        if (Math.abs(difference) > 0.5) {
          ratingTrend = difference > 0 ? 'increasing' : 'decreasing';
        }
      }

      // Harshness calculation (compare to global average)
      const globalAverageRating = 6.5; // Assume global average
      const harshness = Math.max(0, (globalAverageRating - averageRating) / globalAverageRating);

      return {
        averageRating,
        ratingDistribution,
        ratingTrend,
        harshness
      };

    } catch (error) {
      console.error('Error analyzing rating patterns:', error);
      return {
        averageRating: 0,
        ratingDistribution: {},
        ratingTrend: 'stable',
        harshness: 0
      };
    }
  }

  private async analyzeEngagementLevel(userBehavior: UserBehavior): Promise<ProfileInsights['engagementLevel']> {
    try {
      const factors: string[] = [];
      let score = 0;

      // Rating frequency
      const ratingCount = userBehavior.ratingHistory.length;
      if (ratingCount > 100) {
        score += 0.3;
        factors.push('High rating activity');
      } else if (ratingCount > 20) {
        score += 0.2;
        factors.push('Moderate rating activity');
      }

      // Viewing time
      const totalViewingTime = userBehavior.viewingHistory
        .reduce((sum, view) => sum + view.value, 0);
      if (totalViewingTime > 36000) { // 10+ hours
        score += 0.3;
        factors.push('Extensive viewing time');
      } else if (totalViewingTime > 7200) { // 2+ hours
        score += 0.2;
        factors.push('Good viewing time');
      }

      // Search activity
      if (userBehavior.searchHistory.length > 50) {
        score += 0.2;
        factors.push('Active searcher');
      }

      // Watchlist management
      if (userBehavior.watchlistActions.length > 20) {
        score += 0.2;
        factors.push('Active watchlist management');
      }

      // Determine level
      let level: 'low' | 'medium' | 'high' | 'very_high';
      if (score >= 0.8) level = 'very_high';
      else if (score >= 0.6) level = 'high';
      else if (score >= 0.3) level = 'medium';
      else level = 'low';

      return { level, score, factors };

    } catch (error) {
      console.error('Error analyzing engagement level:', error);
      return { level: 'low', score: 0, factors: [] };
    }
  }

  private async generatePersonalizedRecommendations(
    userId: string,
    insights: Partial<ProfileInsights>
  ): Promise<ProfileInsights['recommendations']> {
    try {
      // Explore new genres (genres with low scores but potential)
      const exploreNewGenres = insights.favoriteGenres
        ?.filter(genre => genre.score < 0.3)
        .slice(0, 3)
        .map(genre => genre.genre) || [];

      // These would be implemented with actual movie data
      const revisitOldFavorites: any[] = [];
      const basedOnMood: any[] = [];

      return {
        exploreNewGenres,
        revisitOldFavorites,
        basedOnMood
      };

    } catch (error) {
      console.error('Error generating personalized recommendations:', error);
      return {
        exploreNewGenres: [],
        revisitOldFavorites: [],
        basedOnMood: []
      };
    }
  }

  // Helper methods
  private async getMovieGenres(movieId: number): Promise<string[]> {
    // This would integrate with movie metadata service
    // For now, return empty array
    return [];
  }

  private async getMovieActors(movieId: number): Promise<string[]> {
    // This would integrate with movie metadata service
    return [];
  }

  private async getMovieDirectors(movieId: number): Promise<string[]> {
    // This would integrate with movie metadata service
    return [];
  }

  private getSeasonFromMonth(month: number): string {
    if (month >= 2 && month <= 4) return 'Spring';
    if (month >= 5 && month <= 7) return 'Summer';
    if (month >= 8 && month <= 10) return 'Fall';
    return 'Winter';
  }

  private groupActionsBySessions(actions: UserAction[], sessionTimeout = 30 * 60 * 1000): UserAction[][] {
    const sessions: UserAction[][] = [];
    let currentSession: UserAction[] = [];
    
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

  private mapGenreToMood(genre: string): string | null {
    const mapping: { [key: string]: string } = {
      'Action': 'action',
      'Adventure': 'action',
      'Drama': 'drama',
      'Comedy': 'comedy',
      'Romance': 'romance',
      'Thriller': 'thriller',
      'Horror': 'horror',
      'Documentary': 'documentary',
      'Science Fiction': 'scifi',
      'Fantasy': 'scifi'
    };
    
    return mapping[genre] || null;
  }
}

// Mood classifier using simple heuristics
class MoodClassifier {
  predict(actions: UserAction[]): MoodClassification {
    // Simplified mood classification
    const moodScores = {
      happy: 0,
      sad: 0,
      excited: 0,
      relaxed: 0,
      adventurous: 0
    };

    // This would be a proper ML model in production
    const primaryMood = 'neutral';
    const confidence = 0.5;
    const factors = ['Based on viewing patterns'];

    return {
      primaryMood,
      moodScores,
      confidence,
      factors
    };
  }
}

export { ProfileAnalyzer, ProfileInsights, UserBehavior, MoodClassification };