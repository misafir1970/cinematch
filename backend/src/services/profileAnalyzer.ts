import { UserAction, UserProfile, UserRating, Movie, Genre } from '@/types';
import { logger } from '@/utils/logger';
import Redis from 'ioredis';

interface ProfileInsights {
  favoriteGenres: { genre: string; score: number; confidence: number }[];
  favoriteActors: { actorId: number; name: string; count: number; avgRating: number }[];
  favoriteDirectors: { directorId: number; name: string; count: number; avgRating: number }[];
  watchingPatterns: {
    timeOfDay: { hour: number; count: number; percentage: number }[];
    dayOfWeek: { day: string; count: number; percentage: number }[];
    seasonality: { season: string; preference: number }[];
    bingeBehavior: {
      isBinger: boolean;
      avgSessionLength: number;
      maxMoviesPerDay: number;
    };
  };
  moodProfile: {
    action: number;
    drama: number;
    comedy: number;
    romance: number;
    thriller: number;
    horror: number;
    documentary: number;
    animation: number;
  };
  discoveryStyle: 'conservative' | 'adventurous' | 'mixed';
  engagementLevel: 'low' | 'medium' | 'high' | 'super';
  qualityPreference: 'mainstream' | 'niche' | 'mixed';
}

interface BehavioralPattern {
  pattern: string;
  confidence: number;
  examples: string[];
}

interface UserSegment {
  segment: string;
  confidence: number;
  characteristics: string[];
}

export class ProfileAnalyzer {
  private redis: Redis;
  private genreMap: Map<number, string> = new Map();

  constructor(redis: Redis) {
    this.redis = redis;
    this.initializeGenreMap();
  }

  /**
   * Initialize genre mapping
   */
  private initializeGenreMap(): void {
    const genres = [
      { id: 28, name: 'Action' },
      { id: 12, name: 'Adventure' },
      { id: 16, name: 'Animation' },
      { id: 35, name: 'Comedy' },
      { id: 80, name: 'Crime' },
      { id: 99, name: 'Documentary' },
      { id: 18, name: 'Drama' },
      { id: 10751, name: 'Family' },
      { id: 14, name: 'Fantasy' },
      { id: 36, name: 'History' },
      { id: 27, name: 'Horror' },
      { id: 10402, name: 'Music' },
      { id: 9648, name: 'Mystery' },
      { id: 10749, name: 'Romance' },
      { id: 878, name: 'Science Fiction' },
      { id: 10770, name: 'TV Movie' },
      { id: 53, name: 'Thriller' },
      { id: 10752, name: 'War' },
      { id: 37, name: 'Western' }
    ];

    genres.forEach(genre => {
      this.genreMap.set(genre.id, genre.name);
    });
  }

  /**
   * Plan 3.2: Ana profil analizi fonksiyonu
   */
  async generateInsights(userId: string): Promise<ProfileInsights> {
    try {
      logger.info('Generating profile insights', { userId });

      // Paralel veri toplama
      const [userActions, userRatings, userProfile] = await Promise.all([
        this.getUserActions(userId),
        this.getUserRatings(userId),
        this.getUserProfile(userId)
      ]);

      // Cache kontrolü
      const cacheKey = `profile-insights:${userId}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached && this.shouldUseCachedInsights(JSON.parse(cached), userActions.length)) {
        logger.debug('Using cached profile insights', { userId });
        return JSON.parse(cached);
      }

      // Insights oluştur
      const insights: ProfileInsights = {
        favoriteGenres: await this.analyzeGenrePreferences(userRatings),
        favoriteActors: await this.analyzeActorPreferences(userRatings),
        favoriteDirectors: await this.analyzeDirectorPreferences(userRatings),
        watchingPatterns: this.analyzeTemporalPatterns(userActions),
        moodProfile: this.analyzeMoodProfile(userRatings),
        discoveryStyle: this.classifyDiscoveryStyle(userRatings),
        engagementLevel: this.calculateEngagementLevel(userActions, userRatings),
        qualityPreference: this.analyzeQualityPreference(userRatings)
      };

      // Cache'e kaydet (1 saat)
      await this.redis.setex(cacheKey, 3600, JSON.stringify(insights));

      logger.info('Profile insights generated successfully', { 
        userId,
        genreCount: insights.favoriteGenres.length,
        discoveryStyle: insights.discoveryStyle,
        engagementLevel: insights.engagementLevel
      });

      return insights;

    } catch (error) {
      logger.error('Failed to generate profile insights', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      throw error;
    }
  }

  /**
   * Genre preferences analizi
   */
  private async analyzeGenrePreferences(ratings: UserRating[]): Promise<ProfileInsights['favoriteGenres']> {
    const genreStats = new Map<string, { totalRating: number; count: number; ratings: number[] }>();

    // Her rating için genre bilgilerini al
    for (const rating of ratings) {
      const movieGenres = await this.getMovieGenres(rating.movieId);
      
      movieGenres.forEach(genreId => {
        const genreName = this.genreMap.get(genreId) || `Genre_${genreId}`;
        
        if (!genreStats.has(genreName)) {
          genreStats.set(genreName, { totalRating: 0, count: 0, ratings: [] });
        }
        
        const stats = genreStats.get(genreName)!;
        stats.totalRating += rating.rating;
        stats.count++;
        stats.ratings.push(rating.rating);
      });
    }

    // Genre preferences hesapla
    const genrePreferences = Array.from(genreStats.entries()).map(([genre, stats]) => {
      const avgRating = stats.totalRating / stats.count;
      const variance = this.calculateVariance(stats.ratings);
      
      // Score hesaplama: avgRating * count * consistency
      const consistency = Math.max(0, 1 - (variance / 10)); // Normalize variance
      const score = (avgRating / 10) * Math.min(1, stats.count / 5) * consistency;
      
      // Confidence hesaplama
      const confidence = Math.min(1, stats.count / 10);

      return {
        genre,
        score,
        confidence
      };
    });

    return genrePreferences
      .filter(g => g.score > 0.3) // Threshold
      .sort((a, b) => b.score - a.score)
      .slice(0, 8); // Top 8 genres
  }

  /**
   * Temporal patterns analizi
   */
  private analyzeTemporalPatterns(actions: UserAction[]): ProfileInsights['watchingPatterns'] {
    const timeOfDayStats = new Array(24).fill(0);
    const dayOfWeekStats = new Array(7).fill(0);
    const sessionLengths: number[] = [];
    const dailyMovieCounts = new Map<string, number>();

    // Session analizi için actions'ları tarih/saat'e göre grupla
    const sessionGroups = this.groupActionsBySession(actions);

    sessionGroups.forEach(session => {
      sessionLengths.push(session.length);
      
      session.forEach(action => {
        const date = new Date(action.timestamp);
        const hour = date.getHours();
        const dayOfWeek = date.getDay();
        const dateKey = date.toDateString();

        timeOfDayStats[hour]++;
        dayOfWeekStats[dayOfWeek]++;

        // Daily movie count
        if (action.actionType === 'rate' || action.actionType === 'view') {
          dailyMovieCounts.set(dateKey, (dailyMovieCounts.get(dateKey) || 0) + 1);
        }
      });
    });

    const totalActions = actions.length;

    // Time of day distribution
    const timeOfDay = timeOfDayStats.map((count, hour) => ({
      hour,
      count,
      percentage: totalActions > 0 ? (count / totalActions) * 100 : 0
    })).filter(t => t.count > 0);

    // Day of week distribution
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayOfWeekStats.map((count, day) => ({
      day: dayNames[day],
      count,
      percentage: totalActions > 0 ? (count / totalActions) * 100 : 0
    })).filter(d => d.count > 0);

    // Binge behavior analysis
    const avgSessionLength = sessionLengths.length > 0 
      ? sessionLengths.reduce((a, b) => a + b, 0) / sessionLengths.length 
      : 0;
    const maxMoviesPerDay = dailyMovieCounts.size > 0 
      ? Math.max(...Array.from(dailyMovieCounts.values())) 
      : 0;
    const isBinger = avgSessionLength > 3 || maxMoviesPerDay > 5;

    return {
      timeOfDay,
      dayOfWeek,
      seasonality: this.analyzeSeasonality(actions),
      bingeBehavior: {
        isBinger,
        avgSessionLength,
        maxMoviesPerDay
      }
    };
  }

  /**
   * Mood profile analizi
   */
  private analyzeMoodProfile(ratings: UserRating[]): ProfileInsights['moodProfile'] {
    const moodMapping = {
      action: [28],              // Action
      drama: [18],               // Drama
      comedy: [35],              // Comedy
      romance: [10749],          // Romance
      thriller: [53],            // Thriller
      horror: [27],              // Horror
      documentary: [99],         // Documentary
      animation: [16]            // Animation
    };

    const moodScores = {
      action: 0,
      drama: 0,
      comedy: 0,
      romance: 0,
      thriller: 0,
      horror: 0,
      documentary: 0,
      animation: 0
    };

    const moodCounts = { ...moodScores };

    // Her rating için mood kategorilerini hesapla
    ratings.forEach(async (rating) => {
      const movieGenres = await this.getMovieGenres(rating.movieId);
      
      Object.entries(moodMapping).forEach(([mood, genreIds]) => {
        const hasGenre = movieGenres.some(genreId => genreIds.includes(genreId));
        
        if (hasGenre) {
          moodScores[mood as keyof typeof moodScores] += rating.rating;
          moodCounts[mood as keyof typeof moodCounts]++;
        }
      });
    });

    // Normalize scores
    Object.keys(moodScores).forEach(mood => {
      const key = mood as keyof typeof moodScores;
      if (moodCounts[key] > 0) {
        moodScores[key] = (moodScores[key] / moodCounts[key]) / 10; // Normalize to 0-1
      }
    });

    return moodScores;
  }

  /**
   * Discovery style classification
   */
  private classifyDiscoveryStyle(ratings: UserRating[]): ProfileInsights['discoveryStyle'] {
    if (ratings.length < 10) return 'mixed';

    // Popularity analizi
    let mainstreamCount = 0;
    let nicheCount = 0;

    ratings.forEach(async (rating) => {
      const popularity = await this.getMoviePopularity(rating.movieId);
      
      if (popularity > 50) {
        mainstreamCount++;
      } else if (popularity < 20) {
        nicheCount++;
      }
    });

    const mainstreamRatio = mainstreamCount / ratings.length;
    const nicheRatio = nicheCount / ratings.length;

    if (mainstreamRatio > 0.7) {
      return 'conservative';
    } else if (nicheRatio > 0.3) {
      return 'adventurous';
    } else {
      return 'mixed';
    }
  }

  /**
   * Engagement level hesaplama
   */
  private calculateEngagementLevel(
    actions: UserAction[], 
    ratings: UserRating[]
  ): ProfileInsights['engagementLevel'] {
    const totalActions = actions.length;
    const totalRatings = ratings.length;
    const avgRating = ratings.length > 0 
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length 
      : 0;

    // Engagement score hesaplama
    const actionScore = Math.min(1, totalActions / 100); // Max 100 actions = 1.0
    const ratingScore = Math.min(1, totalRatings / 50);   // Max 50 ratings = 1.0
    const qualityScore = avgRating > 0 ? (avgRating - 5) / 5 : 0; // Above average = positive

    const engagementScore = (actionScore + ratingScore + qualityScore) / 3;

    if (engagementScore > 0.8) return 'super';
    if (engagementScore > 0.6) return 'high';
    if (engagementScore > 0.3) return 'medium';
    return 'low';
  }

  /**
   * Quality preference analizi
   */
  private analyzeQualityPreference(ratings: UserRating[]): ProfileInsights['qualityPreference'] {
    // Placeholder implementation
    // Bu kısımda TMDB vote_average'ı kullanarak quality preference analiz edilebilir
    return 'mixed';
  }

  /**
   * Yardımcı metodlar
   */
  private async getUserActions(userId: string): Promise<UserAction[]> {
    // Redis'den user actions'ları al
    const actions = await this.redis.lrange(`user-actions:${userId}`, 0, -1);
    return actions.map(action => JSON.parse(action));
  }

  private async getUserRatings(userId: string): Promise<UserRating[]> {
    // Redis'den user ratings'leri al
    const ratings = await this.redis.lrange(`user-ratings:${userId}`, 0, -1);
    return ratings.map(rating => JSON.parse(rating));
  }

  private async getUserProfile(userId: string): Promise<UserProfile | null> {
    const profile = await this.redis.get(`user-profile:${userId}`);
    return profile ? JSON.parse(profile) : null;
  }

  private async getMovieGenres(movieId: number): Promise<number[]> {
    // Cache'den movie genres al
    const cacheKey = `movie-genres:${movieId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    // Placeholder - gerçek implementasyonda TMDB'den çekilecek
    return [28, 12]; // Action, Adventure
  }

  private async getMoviePopularity(movieId: number): Promise<number> {
    // Cache'den movie popularity al
    const cacheKey = `movie-popularity:${movieId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return parseFloat(cached);
    }

    // Placeholder
    return 50;
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
  }

  private groupActionsBySession(actions: UserAction[]): UserAction[][] {
    // 30 dakika threshold ile session'ları grupla
    const sessions: UserAction[][] = [];
    let currentSession: UserAction[] = [];
    let lastTimestamp = 0;

    actions
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .forEach(action => {
        const timestamp = new Date(action.timestamp).getTime();
        
        if (lastTimestamp > 0 && timestamp - lastTimestamp > 30 * 60 * 1000) {
          // 30 dakika geçmişse yeni session
          if (currentSession.length > 0) {
            sessions.push(currentSession);
          }
          currentSession = [action];
        } else {
          currentSession.push(action);
        }
        
        lastTimestamp = timestamp;
      });

    if (currentSession.length > 0) {
      sessions.push(currentSession);
    }

    return sessions;
  }

  private analyzeSeasonality(actions: UserAction[]): ProfileInsights['watchingPatterns']['seasonality'] {
    // Seasonal analysis placeholder
    return [
      { season: 'Spring', preference: 0.25 },
      { season: 'Summer', preference: 0.30 },
      { season: 'Fall', preference: 0.25 },
      { season: 'Winter', preference: 0.20 }
    ];
  }

  private shouldUseCachedInsights(cachedInsights: any, currentActionCount: number): boolean {
    // Cache'deki insights'ların güncel olup olmadığını kontrol et
    // Basit kontrol: action count'ta büyük değişiklik varsa yenile
    const cachedActionCount = cachedInsights.metadata?.actionCount || 0;
    const changeThreshold = 0.1; // %10 değişiklik threshold'u
    
    return Math.abs(currentActionCount - cachedActionCount) / Math.max(currentActionCount, 1) < changeThreshold;
  }

  private async analyzeActorPreferences(ratings: UserRating[]): Promise<ProfileInsights['favoriteActors']> {
    // Placeholder - gerçek implementasyonda TMDB cast bilgileri kullanılacak
    return [];
  }

  private async analyzeDirectorPreferences(ratings: UserRating[]): Promise<ProfileInsights['favoriteDirectors']> {
    // Placeholder - gerçek implementasyonda TMDB crew bilgileri kullanılacak
    return [];
  }

  /**
   * Behavioral patterns tespit et
   */
  async identifyBehavioralPatterns(userId: string): Promise<BehavioralPattern[]> {
    const insights = await this.generateInsights(userId);
    const patterns: BehavioralPattern[] = [];

    // Weekend binger pattern
    const weekendActivity = insights.watchingPatterns.dayOfWeek
      .filter(d => d.day === 'Saturday' || d.day === 'Sunday')
      .reduce((sum, d) => sum + d.percentage, 0);

    if (weekendActivity > 50) {
      patterns.push({
        pattern: 'Weekend Binger',
        confidence: Math.min(1, weekendActivity / 60),
        examples: ['High weekend activity', 'Low weekday engagement']
      });
    }

    // Night owl pattern
    const nightActivity = insights.watchingPatterns.timeOfDay
      .filter(t => t.hour >= 22 || t.hour <= 2)
      .reduce((sum, t) => sum + t.percentage, 0);

    if (nightActivity > 40) {
      patterns.push({
        pattern: 'Night Owl',
        confidence: Math.min(1, nightActivity / 50),
        examples: ['Late night viewing', 'Low morning activity']
      });
    }

    return patterns;
  }

  /**
   * User segmentation
   */
  async segmentUser(userId: string): Promise<UserSegment> {
    const insights = await this.generateInsights(userId);
    
    // Segment classification logic
    if (insights.engagementLevel === 'super' && insights.discoveryStyle === 'adventurous') {
      return {
        segment: 'Film Enthusiast',
        confidence: 0.9,
        characteristics: ['High engagement', 'Loves niche content', 'Active rater']
      };
    } else if (insights.engagementLevel === 'high' && insights.discoveryStyle === 'conservative') {
      return {
        segment: 'Mainstream Consumer',
        confidence: 0.8,
        characteristics: ['Popular content', 'Regular viewer', 'Predictable taste']
      };
    } else if (insights.engagementLevel === 'low') {
      return {
        segment: 'Casual Viewer',
        confidence: 0.7,
        characteristics: ['Occasional viewing', 'Popular content', 'Low engagement']
      };
    } else {
      return {
        segment: 'Balanced Viewer',
        confidence: 0.6,
        characteristics: ['Mixed preferences', 'Moderate engagement', 'Diverse taste']
      };
    }
  }
}