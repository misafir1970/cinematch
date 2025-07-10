export interface Movie {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  adult: boolean;
  original_language: string;
  original_title: string;
  genre_ids: number[];
  runtime?: number;
  genres?: Genre[];
  production_companies?: ProductionCompany[];
  production_countries?: ProductionCountry[];
  spoken_languages?: SpokenLanguage[];
  status?: string;
  tagline?: string;
  budget?: number;
  revenue?: number;
  imdb_id?: string;
  homepage?: string;
  belongs_to_collection?: Collection;
  credits?: Credits;
}

export interface Genre {
  id: number;
  name: string;
}

export interface ProductionCompany {
  id: number;
  logo_path: string | null;
  name: string;
  origin_country: string;
}

export interface ProductionCountry {
  iso_3166_1: string;
  name: string;
}

export interface SpokenLanguage {
  english_name: string;
  iso_639_1: string;
  name: string;
}

export interface Collection {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
}

export interface Credits {
  cast: CastMember[];
  crew: CrewMember[];
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
  cast_id: number;
  credit_id: string;
  adult: boolean;
  gender: number;
  known_for_department: string;
  original_name: string;
  popularity: number;
}

export interface CrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path: string | null;
  credit_id: string;
  adult: boolean;
  gender: number;
  known_for_department: string;
  original_name: string;
  popularity: number;
}

export interface MovieListResponse {
  results: Movie[];
  page: number;
  total_pages: number;
  total_results: number;
}

export interface UserRating {
  movieId: number;
  rating: number;
  timestamp: Date;
}

export interface WatchlistItem {
  movieId: number;
  addedAt: Date;
  movie?: Movie;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  preferences: {
    genres: number[];
    languages: string[];
    notifications: boolean;
  };
  statistics: {
    moviesWatched: number;
    moviesRated: number;
    averageRating: number;
    favoriteGenres: Genre[];
    watchTime: number;
  };
}

export interface RecommendationScore {
  movieId: number;
  score: number;
  reason: string;
  algorithm: 'content-based' | 'collaborative' | 'hybrid';
}

export interface UserAction {
  id: string;
  userId: string;
  movieId: number;
  actionType: 'click' | 'view' | 'rate' | 'watchTime' | 'add_watchlist' | 'remove_watchlist';
  value: number;
  timestamp: Date;
  sessionId?: string;
  deviceType?: string;
}