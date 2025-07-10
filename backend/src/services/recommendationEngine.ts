import { Movie, UserProfile, UserRating, RecommendationScore } from '@/types';
import { MatrixFactorization } from '@/ml/matrixFactorization';
import { UserProfileService } from './userProfileService';
import { ContentBasedRecommender } from './contentBasedRecommender';
import { CollaborativeFilterService } from './collaborativeFilterService';
import Redis from 'ioredis';

interface HybridWeights {
  content: number;
  collaborative: number;
  popularity: number;
  diversity: number;
}

interface RecommendationContext {
  userId: string;
  count: number;
  excludeWatched: boolean;
  includeExplanations: boolean;
  userProfile?: UserProfile;
}

export class HybridRecommendationEngine {
  private matrixFactorization: MatrixFactorization;
  private userProfileService: UserProfileService;
  private contentBasedRecommender: ContentBasedRecommender;
  private collaborativeFilter: CollaborativeFilterService;
  private redis: Redis;
  private cacheTimeout = 300; // 5 minutes

  constructor(
    matrixFactorization: MatrixFactorization,
    userProfileService: UserProfileService,
    contentBasedRecommender: ContentBasedRecommender,
    collaborativeFilter: CollaborativeFilterService,
    redis: Redis
  ) {
    this.matrixFactorization = matrixFactorization;
    this.userProfileService = userProfileService;
    this.contentBasedRecommender = contentBasedRecommender;
    this.collaborativeFilter = collaborativeFilter;
    this.redis = redis;
  }

  /**
   * Plan 1.3: Ana hibrit öneri fonksiyonu
   */
  async generateRecommendations(
    userId: string, 
    count: number = 20,
    options: Partial<RecommendationContext> = {}
  ): Promise<Movie[]> {
    const context: RecommendationContext = {
      userId,
      count,
      excludeWatched: true,
      includeExplanations: true,
      ...options
    };

    try {
      // Cache kontrolü
      const cacheKey = `recommendations:${userId}:${count}`;
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        console.log(`Returning cached recommendations for user ${userId}`);
        return JSON.parse(cached);
      }

      // User profile'ı al
      const userProfile = context.userProfile || await this.userProfileService.getUserProfile(userId);
      
      // Adaptif ağırlıkları hesapla
      const weights = this.calculateWeights(userProfile);
      
      console.log(`Generating recommendations for user ${userId} with weights:`, weights);

      // Paralel olarak farklı algoritmaları çalıştır
      const [
        contentBasedScores,
        collaborativeScores,
        popularityScores
      ] = await Promise.all([
        this.getContentBasedRecommendations(context, userProfile),
        this.getCollaborativeRecommendations(context, userProfile),
        this.getPopularityBasedRecommendations(context)
      ]);

      // Skorları hibrit algoritma ile birleştir
      const hybridScores = this.combineScores(
        contentBasedScores,
        collaborativeScores,
        popularityScores,
        weights
      );

      // Diversity boost uygula
      const diversifiedScores = this.applyDiversityBoost(hybridScores, userProfile, weights.diversity);

      // Top recommendations'ları seç
      const topScores = diversifiedScores
        .sort((a, b) => b.score - a.score)
        .slice(0, count);

      // Movie detaylarını al
      const recommendations = await this.enrichWithMovieDetails(topScores);

      // Cache'e kaydet
      await this.redis.setex(cacheKey, this.cacheTimeout, JSON.stringify(recommendations));

      console.log(`Generated ${recommendations.length} recommendations for user ${userId}`);
      return recommendations;

    } catch (error) {
      console.error('Failed to generate recommendations:', error);
      
      // Fallback: Popüler filmler döndür
      return this.getFallbackRecommendations(count);
    }
  }

  /**
   * Plan 1.3: Adaptif ağırlık hesaplama
   */
  private calculateWeights(profile: UserProfile): HybridWeights {
    const ratingCount = profile.ratings.length;
    const diversity = this.calculateUserDiversity(profile);
    
    if (ratingCount < 5) {
      // Yeni kullanıcılar - popularite ve çeşitlilik ağırlık
      return {
        content: 0.4,
        collaborative: 0.1,
        popularity: 0.4,
        diversity: 0.1
      };
    } else if (ratingCount < 20) {
      // Orta seviye kullanıcılar - content-based ağırlıklı
      return {
        content: 0.5,
        collaborative: 0.3,
        popularity: 0.15,
        diversity: 0.05
      };
    } else if (ratingCount < 100) {
      // Deneyimli kullanıcılar - hibrit yaklaşım
      return {
        content: 0.4,
        collaborative: 0.5,
        popularity: 0.05,
        diversity: 0.05
      };
    } else {
      // Uzman kullanıcılar - collaborative filtering ağırlıklı
      const collaborativeWeight = Math.min(0.7, 0.4 + (ratingCount - 100) * 0.001);
      return {
        content: 0.3,
        collaborative: collaborativeWeight,
        popularity: 0.05,
        diversity: diversity > 0.7 ? 0.1 : 0.05 // Çeşitlilik seven kullanıcılar için boost
      };
    }
  }

  /**
   * Content-based recommendations
   */
  private async getContentBasedRecommendations(
    context: RecommendationContext,
    userProfile: UserProfile
  ): Promise<RecommendationScore[]> {
    try {
      return await this.contentBasedRecommender.getRecommendations(
        context.userId,
        userProfile,
        context.count * 2 // Daha fazla seçenek al, sonra filtrele
      );
    } catch (error) {
      console.error('Content-based recommendations failed:', error);
      return [];
    }
  }

  /**
   * Collaborative filtering recommendations
   */
  private async getCollaborativeRecommendations(
    context: RecommendationContext,
    userProfile: UserProfile
  ): Promise<RecommendationScore[]> {
    try {
      // Matrix factorization kullan
      const candidateMovies = await this.getCandidateMovies(context.userId);
      const predictions: RecommendationScore[] = [];

      for (const movieId of candidateMovies) {
        const score = await this.matrixFactorization.predict(context.userId, movieId);
        predictions.push({
          movieId,
          score: score / 10, // 0-1 aralığına normalize et
          algorithm: 'collaborative'
        });
      }

      return predictions
        .filter(p => p.score > 0.6) // Threshold uygula
        .sort((a, b) => b.score - a.score)
        .slice(0, context.count * 2);

    } catch (error) {
      console.error('Collaborative filtering failed:', error);
      return [];
    }
  }

  /**
   * Popularity-based recommendations
   */
  private async getPopularityBasedRecommendations(
    context: RecommendationContext
  ): Promise<RecommendationScore[]> {
    try {
      // Redis'den popüler filmleri al
      const popularMovies = await this.redis.zrevrange('popular_movies', 0, context.count * 2);
      
      return popularMovies.map((movieId, index) => ({
        movieId: parseInt(movieId),
        score: 1 - (index / popularMovies.length), // Sıralamaya göre skor
        algorithm: 'collaborative' as const
      }));

    } catch (error) {
      console.error('Popularity-based recommendations failed:', error);
      return [];
    }
  }

  /**
   * Skorları hibrit algoritma ile birleştir
   */
  private combineScores(
    contentScores: RecommendationScore[],
    collaborativeScores: RecommendationScore[],
    popularityScores: RecommendationScore[],
    weights: HybridWeights
  ): RecommendationScore[] {
    const movieScoreMap = new Map<number, { 
      content: number, 
      collaborative: number, 
      popularity: number 
    }>();

    // Content-based skorları ekle
    contentScores.forEach(score => {
      movieScoreMap.set(score.movieId, {
        content: score.score,
        collaborative: 0,
        popularity: 0
      });
    });

    // Collaborative skorları ekle
    collaborativeScores.forEach(score => {
      const existing = movieScoreMap.get(score.movieId);
      if (existing) {
        existing.collaborative = score.score;
      } else {
        movieScoreMap.set(score.movieId, {
          content: 0,
          collaborative: score.score,
          popularity: 0
        });
      }
    });

    // Popularity skorları ekle
    popularityScores.forEach(score => {
      const existing = movieScoreMap.get(score.movieId);
      if (existing) {
        existing.popularity = score.score;
      } else {
        movieScoreMap.set(score.movieId, {
          content: 0,
          collaborative: 0,
          popularity: score.score
        });
      }
    });

    // Hibrit skoru hesapla
    const hybridScores: RecommendationScore[] = [];
    
    movieScoreMap.forEach((scores, movieId) => {
      const hybridScore = (
        scores.content * weights.content +
        scores.collaborative * weights.collaborative +
        scores.popularity * weights.popularity
      );

      hybridScores.push({
        movieId,
        score: hybridScore,
        algorithm: 'hybrid',
        explanation: this.generateExplanation(scores, weights)
      });
    });

    return hybridScores;
  }

  /**
   * Diversity boost uygula
   */
  private applyDiversityBoost(
    scores: RecommendationScore[],
    userProfile: UserProfile,
    diversityWeight: number
  ): RecommendationScore[] {
    if (diversityWeight === 0) return scores;

    // Genre diversity'i hesapla
    const userGenres = new Set(userProfile.preferences.genres.map(g => g.genreId));
    
    return scores.map(score => {
      // TODO: Movie genre bilgisini al ve diversity boost hesapla
      // Bu kısım movie service integration gerektirir
      const diversityBoost = Math.random() * diversityWeight; // Placeholder
      
      return {
        ...score,
        score: score.score + diversityBoost
      };
    });
  }

  /**
   * Açıklama metni oluştur
   */
  private generateExplanation(
    scores: { content: number; collaborative: number; popularity: number },
    weights: HybridWeights
  ): string {
    const explanations: string[] = [];

    if (scores.content > 0.7 && weights.content > 0.3) {
      explanations.push('beğendiğin film türlerine benzer');
    }
    
    if (scores.collaborative > 0.7 && weights.collaborative > 0.3) {
      explanations.push('benzer kullanıcılar tarafından sevilen');
    }
    
    if (scores.popularity > 0.7 && weights.popularity > 0.3) {
      explanations.push('şu anda popüler olan');
    }

    return explanations.length > 0 
      ? `Bu film ${explanations.join(' ve ')} filmlerden.`
      : 'Bu film senin için öneriliyor.';
  }

  /**
   * User diversity skorunu hesapla
   */
  private calculateUserDiversity(profile: UserProfile): number {
    const genreCount = profile.preferences.genres.length;
    const maxGenres = 20; // Maksimum genre sayısı
    
    return Math.min(1, genreCount / maxGenres);
  }

  /**
   * Candidate movie'leri al
   */
  private async getCandidateMovies(userId: string): Promise<number[]> {
    // Redis'den candidate movies al veya hesapla
    const cacheKey = `candidates:${userId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    // Placeholder: Popüler filmlerden seç
    const popularMovies = await this.redis.zrevrange('popular_movies', 0, 500);
    const candidates = popularMovies.map(id => parseInt(id));
    
    // 1 saat cache
    await this.redis.setex(cacheKey, 3600, JSON.stringify(candidates));
    
    return candidates;
  }

  /**
   * Movie detayları ile zenginleştir
   */
  private async enrichWithMovieDetails(scores: RecommendationScore[]): Promise<Movie[]> {
    // TODO: Movie service'den detayları al
    // Şu anlık placeholder
    return scores.map(score => ({
      id: score.movieId,
      title: `Movie ${score.movieId}`,
      overview: `Recommended movie with score ${score.score.toFixed(2)}`,
      poster_path: '/placeholder.jpg',
      backdrop_path: '/placeholder-backdrop.jpg',
      release_date: '2023-01-01',
      vote_average: score.score * 10,
      vote_count: 1000,
      popularity: score.score * 100,
      genre_ids: [28, 12] // Action, Adventure
    } as Movie));
  }

  /**
   * Fallback recommendations
   */
  private async getFallbackRecommendations(count: number): Promise<Movie[]> {
    console.log('Using fallback recommendations');
    
    // Popüler filmler döndür
    return this.enrichWithMovieDetails(
      Array.from({ length: count }, (_, i) => ({
        movieId: i + 1,
        score: 0.8 - (i * 0.01),
        algorithm: 'hybrid' as const
      }))
    );
  }

  /**
   * Real-time model update tetikleyici
   */
  async updateRecommendationsForUser(userId: string): Promise<void> {
    // Cache'i temizle
    const keys = await this.redis.keys(`recommendations:${userId}:*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    
    console.log(`Cleared recommendation cache for user ${userId}`);
  }

  /**
   * Batch recommendation generation
   */
  async generateBatchRecommendations(
    userIds: string[],
    count: number = 20
  ): Promise<Map<string, Movie[]>> {
    const results = new Map<string, Movie[]>();
    
    // Parallel processing with concurrency limit
    const batchSize = 10;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (userId) => {
        try {
          const recommendations = await this.generateRecommendations(userId, count);
          results.set(userId, recommendations);
        } catch (error) {
          console.error(`Batch recommendation failed for user ${userId}:`, error);
          results.set(userId, []);
        }
      });
      
      await Promise.all(batchPromises);
    }
    
    return results;
  }
}