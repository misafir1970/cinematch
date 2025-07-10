export interface UserAction {
  userId: string;
  movieId: number;
  actionType: 'click' | 'view' | 'rate' | 'watchTime' | 'addToWatchlist' | 'removeFromWatchlist';
  value: number;
  timestamp: Date;
  sessionId?: string;
  metadata?: {
    duration?: number;
    position?: number;
    deviceType?: string;
    source?: string;
    serverTimestamp?: string;
  };
}

export interface Movie {
  id: number;
  title: string;
  overview: string;
  poster_path: string;
  backdrop_path: string;
  release_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  genre_ids: number[];
  genres?: Genre[];
  runtime?: number;
  budget?: number;
  revenue?: number;
}

export interface Genre {
  id: number;
  name: string;
}

export interface UserProfile {
  userId: string;
  ratings: UserRating[];
  preferences: {
    genres: { genreId: number; weight: number }[];
    actors: { actorId: number; weight: number }[];
    directors: { directorId: number; weight: number }[];
  };
  demographics?: {
    age?: number;
    gender?: string;
    location?: string;
  };
  behaviorPatterns: {
    watchingTimes: string[];
    sessionDuration: number;
    discoveryStyle: 'conservative' | 'adventurous' | 'mixed';
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRating {
  userId: string;
  movieId: number;
  rating: number;
  timestamp: Date;
}

export interface RecommendationScore {
  movieId: number;
  score: number;
  explanation?: string;
  algorithm: 'content' | 'collaborative' | 'hybrid';
}

export interface MLModelConfig {
  algorithm: string;
  parameters: Record<string, any>;
  version: string;
  trainedAt: Date;
}

export interface CacheConfig {
  ttl: number;
  maxSize: number;
  namespace: string;
}

export interface ModelUpdateJob {
  userId: string;
  movieId: number;
  action: string;
  value: number;
  priority: 'low' | 'medium' | 'high';
  timestamp?: Date;
}