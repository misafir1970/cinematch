import { MatrixFactorization, PredictionResult, TrainingData } from '../ml/matrixFactorization';
import { TrackingService, UserAction } from './trackingService';
import * as Redis from 'ioredis';

interface Movie {
  id: number;
  title: string;
  genres: string[];
  directors: string[];
  actors: string[];
  releaseYear: number;
  runtime: number;
  averageRating: number;
  ratingCount: number;
  popularity: number;
  metadata?: any;
}

interface UserProfile {
  userId: string;
  ratingCount: number;
  avgRating: number;
  timeActive: number;
  engagement: number;
  genres: { [genre: string]: number };
  directors: { [director: string]: number };
  actors: { [actor: string]: number };
  lastActive: number | null;
  preferences: {
    genreWeights: { [genre: string]: number };
    directorWeights: { [director: string]: number };
    actorWeights: { [actor: string]: number };
    runtimePreference: { min: number; max: number; ideal: number };
    yearPreference: { min: number; max: number };
    ratingThreshold: number;
  };
}

interface RecommendationItem {
  movieId: number;
  movie: Movie;
  score: number;
  contentScore: number;
  collaborativeScore: number;
  popularityScore: number;
  source: string;
  weights: {
    content: number;
    collaborative: number;
    popularity: number;
  };
  explanation?: string[];
}

interface RecommendationOptions {
  count?: number;
  excludeRated?: boolean;
  excludeWatchlist?: boolean;
  minScore?: number;
  includeExplanations?: boolean;
  diversityFactor?: number;
  genres?: string[];
  yearRange?: { min: number; max: number };
}

class HybridRecommendationEngine {
  private matrixFactorization: MatrixFactorization;
  private trackingService: TrackingService;
  private redis: Redis.Redis;
  private cacheTimeout: number = 300; // 5 minutes

  constructor(redis: Redis.Redis, mongodb: any) {
    this.matrixFactorization = new MatrixFactorization({
      factors: 50,
      learningRate: 0.001,
      regularization: 1e-6,
      epochs: 100,
      batchSize: 1024
    });
    this.trackingService = new TrackingService(redis, mongodb);
    this.redis = redis;
  }

  async generateRecommendations(userId: string, options: RecommendationOptions = {}): Promise<RecommendationItem[]> {
    try {
      const {
        count = 25,
        excludeRated = true,
        excludeWatchlist = true,
        minScore = 0.5,
        includeExplanations = false,
        diversityFactor = 0.3,
        genres,
        yearRange
      } = options;

      // Check cache first
      const cacheKey = `recommendations:${userId}:${JSON.stringify(options)}`;
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get user profile to determine weights
      const userProfile = await this.getUserProfile(userId);
      const weights = this.calculateWeights(userProfile);

      // Get available movies
      const availableMovies = await this.getAvailableMovies(userId, {
        excludeRated,
        excludeWatchlist,
        genres,
        yearRange
      });
      
      if (availableMovies.length === 0) {
        return [];
      }

      // Generate different types of scores
      const [contentBasedScores, collaborativeScores, popularityScores] = await Promise.all([
        this.contentBasedRecommendation(userId, availableMovies, userProfile),
        this.collaborativeFiltering(userId, availableMovies),
        this.popularityBasedRecommendation(availableMovies)
      ]);

      // Combine scores using adaptive weighting
      const hybridScores = this.combineScores(
        contentBasedScores,
        collaborativeScores,
        popularityScores,
        weights,
        includeExplanations
      );

      // Apply diversity filter
      const diverseRecommendations = this.applyDiversityFilter(
        hybridScores,
        diversityFactor,
        userProfile
      );

      // Sort and filter recommendations
      const recommendations = diverseRecommendations
        .filter(item => item.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, count);

      // Cache results
      await this.redis.setex(cacheKey, this.cacheTimeout, JSON.stringify(recommendations));

      // Update recommendation metrics
      await this.updateRecommendationMetrics(userId, recommendations);

      return recommendations;
    } catch (error) {
      console.error('Error generating recommendations:', error);
      throw error;
    }
  }

  async contentBasedRecommendation(
    userId: string, 
    availableMovies: Movie[], 
    userProfile: UserProfile
  ): Promise<Partial<RecommendationItem>[]> {
    try {
      if (userProfile.ratingCount === 0) {
        // Cold start: return popularity-based recommendations
        return this.popularityBasedRecommendation(availableMovies);
      }

      // Score movies based on content similarity
      const contentScores = availableMovies.map(movie => {
        const genreScore = this.calculateGenreScore(movie, userProfile.preferences.genreWeights);
        const directorScore = this.calculateDirectorScore(movie, userProfile.preferences.directorWeights);
        const actorScore = this.calculateActorScore(movie, userProfile.preferences.actorWeights);
        const runtimeScore = this.calculateRuntimeScore(movie, userProfile.preferences.runtimePreference);
        const yearScore = this.calculateYearScore(movie, userProfile.preferences.yearPreference);

        // Weighted combination of content features
        const score = (
          genreScore * 0.4 +
          directorScore * 0.2 +
          actorScore * 0.2 +
          runtimeScore * 0.1 +
          yearScore * 0.1
        );

        return {
          movieId: movie.id,
          movie,
          score: this.normalizeScore(score),
          source: 'content-based'
        };
      });

      return contentScores;
    } catch (error) {
      console.error('Error in content-based recommendation:', error);
      return [];
    }
  }

  async collaborativeFiltering(userId: string, availableMovies: Movie[]): Promise<Partial<RecommendationItem>[]> {
    try {
      // Try matrix factorization first
      const movieIds = availableMovies.map(movie => movie.id);
      const predictions = await this.matrixFactorization.predict(parseInt(userId), movieIds);
      
      if (predictions.length > 0) {
        return predictions.map(pred => {
          const movie = availableMovies.find(m => m.id === pred.movieId);
          return {
            movieId: pred.movieId,
            movie,
            score: this.normalizeScore(pred.score),
            source: 'collaborative-matrix'
          };
        });
      }

      // Fallback to user-based collaborative filtering
      return this.userBasedCollaborativeFiltering(userId, availableMovies);
    } catch (error) {
      console.error('Error in collaborative filtering:', error);
      return this.userBasedCollaborativeFiltering(userId, availableMovies);
    }
  }

  async userBasedCollaborativeFiltering(userId: string, availableMovies: Movie[]): Promise<Partial<RecommendationItem>[]> {
    try {
      const similarUsers = await this.findSimilarUsers(userId);
      
      if (similarUsers.length === 0) {
        return this.popularityBasedRecommendation(availableMovies);
      }

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

  async popularityBasedRecommendation(movies: Movie[]): Promise<Partial<RecommendationItem>[]> {
    return movies.map(movie => ({
      movieId: movie.id,
      movie,
      score: this.calculatePopularityScore(movie),
      source: 'popularity'
    }));
  }

  calculateWeights(userProfile: UserProfile): { content: number; collaborative: number; popularity: number } {
    const ratingCount = userProfile.ratingCount || 0;
    const timeActive = userProfile.timeActive || 0;
    const engagement = userProfile.engagement || 0;

    if (ratingCount < 5) {
      // Cold start: rely heavily on popularity and content
      return { 
        content: 0.5, 
        collaborative: 0.1,
        popularity: 0.4
      };
    } else if (ratingCount < 20) {
      // Building profile: balanced approach with more content
      return { 
        content: 0.6, 
        collaborative: 0.3,
        popularity: 0.1
      };
    } else if (ratingCount < 100) {
      // Experienced user: more collaborative
      return { 
        content: 0.4, 
        collaborative: 0.5,
        popularity: 0.1
      };
    } else {
      // Power user: heavily collaborative with minimal popularity
      const collaborativeWeight = Math.min(0.8, 0.6 + (ratingCount / 500));
      return { 
        content: 0.8 - collaborativeWeight, 
        collaborative: collaborativeWeight,
        popularity: 0.05
      };
    }
  }

  combineScores(
    contentScores: Partial<RecommendationItem>[],
    collaborativeScores: Partial<RecommendationItem>[],
    popularityScores: Partial<RecommendationItem>[],
    weights: { content: number; collaborative: number; popularity: number },
    includeExplanations: boolean = false
  ): RecommendationItem[] {
    const movieScoreMap = new Map<number, RecommendationItem>();

    // Initialize with content scores
    contentScores.forEach(item => {
      if (item.movie) {
        movieScoreMap.set(item.movieId, {
          movieId: item.movieId,
          movie: item.movie,
          score: 0,
          contentScore: item.score || 0,
          collaborativeScore: 0,
          popularityScore: 0,
          source: 'hybrid',
          weights,
          explanation: includeExplanations ? [] : undefined
        });
      }
    });

    // Add collaborative scores
    collaborativeScores.forEach(item => {
      const existing = movieScoreMap.get(item.movieId);
      if (existing) {
        existing.collaborativeScore = item.score || 0;
      } else if (item.movie) {
        movieScoreMap.set(item.movieId, {
          movieId: item.movieId,
          movie: item.movie,
          score: 0,
          contentScore: 0,
          collaborativeScore: item.score || 0,
          popularityScore: 0,
          source: 'hybrid',
          weights,
          explanation: includeExplanations ? [] : undefined
        });
      }
    });

    // Add popularity scores
    popularityScores.forEach(item => {
      const existing = movieScoreMap.get(item.movieId);
      if (existing) {
        existing.popularityScore = item.score || 0;
      } else if (item.movie) {
        movieScoreMap.set(item.movieId, {
          movieId: item.movieId,
          movie: item.movie,
          score: 0,
          contentScore: 0,
          collaborativeScore: 0,
          popularityScore: item.score || 0,
          source: 'hybrid',
          weights,
          explanation: includeExplanations ? [] : undefined
        });
      }
    });

    // Calculate hybrid scores
    return Array.from(movieScoreMap.values()).map(item => {
      const hybridScore = (
        (item.contentScore * weights.content) +
        (item.collaborativeScore * weights.collaborative) +
        (item.popularityScore * weights.popularity)
      );

      item.score = hybridScore;

      // Add explanations if requested
      if (includeExplanations && item.explanation) {
        item.explanation = this.generateExplanations(item, weights);
      }

      return item;
    });
  }

  private generateExplanations(item: RecommendationItem, weights: any): string[] {
    const explanations: string[] = [];
    
    if (item.contentScore > 0.7 && weights.content > 0.3) {
      explanations.push(`Strong match with your preferences (${(item.contentScore * 100).toFixed(0)}% content similarity)`);
    }
    
    if (item.collaborativeScore > 0.7 && weights.collaborative > 0.3) {
      explanations.push(`Users with similar taste enjoyed this movie (${(item.collaborativeScore * 100).toFixed(0)}% collaborative score)`);
    }
    
    if (item.popularityScore > 0.8) {
      explanations.push(`Popular choice among all users`);
    }

    return explanations;
  }

  private applyDiversityFilter(
    recommendations: RecommendationItem[],
    diversityFactor: number,
    userProfile: UserProfile
  ): RecommendationItem[] {
    if (diversityFactor === 0) {
      return recommendations;
    }

    const diverseRecommendations: RecommendationItem[] = [];
    const selectedGenres = new Set<string>();
    const selectedDirectors = new Set<string>();

    // Sort by score first
    const sortedRecommendations = [...recommendations].sort((a, b) => b.score - a.score);

    for (const recommendation of sortedRecommendations) {
      const movie = recommendation.movie;
      const genreOverlap = movie.genres.some(genre => selectedGenres.has(genre));
      const directorOverlap = movie.directors.some(director => selectedDirectors.has(director));

      // Calculate diversity penalty
      let diversityPenalty = 0;
      if (genreOverlap) diversityPenalty += 0.3;
      if (directorOverlap) diversityPenalty += 0.2;

      // Apply diversity factor
      const adjustedScore = recommendation.score * (1 - (diversityPenalty * diversityFactor));
      recommendation.score = adjustedScore;

      diverseRecommendations.push(recommendation);

      // Update selected sets for diversity tracking
      movie.genres.forEach(genre => selectedGenres.add(genre));
      movie.directors.forEach(director => selectedDirectors.add(director));
    }

    return diverseRecommendations;
  }

  // Helper methods for content-based scoring
  private calculateGenreScore(movie: Movie, genreWeights: { [genre: string]: number }): number {
    if (Object.keys(genreWeights).length === 0) return 0.5;
    
    const movieGenreScores = movie.genres.map(genre => genreWeights[genre] || 0);
    return movieGenreScores.length > 0 
      ? movieGenreScores.reduce((sum, score) => sum + score, 0) / movieGenreScores.length
      : 0;
  }

  private calculateDirectorScore(movie: Movie, directorWeights: { [director: string]: number }): number {
    if (Object.keys(directorWeights).length === 0) return 0.5;
    
    const movieDirectorScores = movie.directors.map(director => directorWeights[director] || 0);
    return movieDirectorScores.length > 0 
      ? Math.max(...movieDirectorScores)
      : 0;
  }

  private calculateActorScore(movie: Movie, actorWeights: { [actor: string]: number }): number {
    if (Object.keys(actorWeights).length === 0) return 0.5;
    
    const movieActorScores = movie.actors.map(actor => actorWeights[actor] || 0);
    return movieActorScores.length > 0 
      ? movieActorScores.slice(0, 3).reduce((sum, score) => sum + score, 0) / Math.min(3, movieActorScores.length)
      : 0;
  }

  private calculateRuntimeScore(movie: Movie, runtimePref: { min: number; max: number; ideal: number }): number {
    if (movie.runtime < runtimePref.min || movie.runtime > runtimePref.max) {
      return 0.2;
    }
    
    const distance = Math.abs(movie.runtime - runtimePref.ideal);
    const maxDistance = Math.max(runtimePref.ideal - runtimePref.min, runtimePref.max - runtimePref.ideal);
    
    return 1 - (distance / maxDistance);
  }

  private calculateYearScore(movie: Movie, yearPref: { min: number; max: number }): number {
    if (movie.releaseYear < yearPref.min || movie.releaseYear > yearPref.max) {
      return 0.3;
    }
    return 1;
  }

  private calculatePopularityScore(movie: Movie): number {
    // Normalize popularity score (0-1 range)
    const popularityScore = movie.popularity / 100; // Assuming popularity is 0-100
    const ratingScore = movie.averageRating / 10; // Assuming rating is 0-10
    const ratingCountScore = Math.log(movie.ratingCount + 1) / Math.log(10000); // Log scale for rating count
    
    return (popularityScore * 0.4 + ratingScore * 0.4 + ratingCountScore * 0.2);
  }

  private normalizeScore(score: number): number {
    return Math.max(0, Math.min(1, score));
  }

  // Placeholder implementations for complex operations
  async getUserProfile(userId: string): Promise<UserProfile> {
    // Implementation would fetch and calculate user profile
    return {
      userId,
      ratingCount: 0,
      avgRating: 0,
      timeActive: 0,
      engagement: 0,
      genres: {},
      directors: {},
      actors: {},
      lastActive: null,
      preferences: {
        genreWeights: {},
        directorWeights: {},
        actorWeights: {},
        runtimePreference: { min: 60, max: 200, ideal: 120 },
        yearPreference: { min: 1990, max: new Date().getFullYear() },
        ratingThreshold: 6.0
      }
    };
  }

  async getAvailableMovies(
    userId: string, 
    options: {
      excludeRated?: boolean;
      excludeWatchlist?: boolean;
      genres?: string[];
      yearRange?: { min: number; max: number };
    }
  ): Promise<Movie[]> {
    // Placeholder implementation
    return [];
  }

  async findSimilarUsers(userId: string): Promise<any[]> {
    // Placeholder implementation
    return [];
  }

  async calculateCollaborativeScore(movieId: number, similarUsers: any[]): Promise<number> {
    // Placeholder implementation
    return 0.5;
  }

  private async updateRecommendationMetrics(userId: string, recommendations: RecommendationItem[]): Promise<void> {
    try {
      await this.redis.hincrby('metrics:recommendations', 'total_generated', 1);
      await this.redis.hincrby('metrics:recommendations', 'total_items', recommendations.length);
      
      const avgScore = recommendations.reduce((sum, rec) => sum + rec.score, 0) / recommendations.length;
      await this.redis.hset('metrics:recommendations', 'last_avg_score', avgScore.toString());
    } catch (error) {
      console.error('Error updating recommendation metrics:', error);
    }
  }
}

export { HybridRecommendationEngine, Movie, UserProfile, RecommendationItem, RecommendationOptions };