import axios, { AxiosInstance, AxiosResponse } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ApiResponse<T> {
  data: T;
  status: number;
  message?: string;
}

interface Movie {
  id: number;
  title: string;
  overview: string;
  poster_path: string;
  backdrop_path: string;
  release_date: string;
  vote_average: number;
  genre_ids: number[];
  runtime?: number;
}

interface MovieListResponse {
  results: Movie[];
  page: number;
  total_pages: number;
  total_results: number;
}

interface UserAction {
  userId: string;
  movieId: number;
  actionType: 'click' | 'view' | 'rate' | 'watchTime' | 'add_watchlist' | 'remove_watchlist';
  value: number;
  timestamp: Date;
}

class ApiService {
  private api: AxiosInstance;
  private baseURL: string;

  constructor() {
    this.baseURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001/api';
    
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor to add auth token
    this.api.interceptors.request.use(
      async (config) => {
        const token = await AsyncStorage.getItem('authToken');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.api.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          await AsyncStorage.removeItem('authToken');
          // TODO: Navigate to login screen
        }
        return Promise.reject(error);
      }
    );
  }

  // Movie API endpoints
  async getPopularMovies(page = 1): Promise<AxiosResponse<MovieListResponse>> {
    return this.api.get(`/movies/popular?page=${page}`);
  }

  async getTrendingMovies(page = 1): Promise<AxiosResponse<MovieListResponse>> {
    return this.api.get(`/movies/trending?page=${page}`);
  }

  async getMovieDetails(movieId: number): Promise<AxiosResponse<Movie>> {
    return this.api.get(`/movies/${movieId}`);
  }

  async searchMovies(query: string, page = 1): Promise<AxiosResponse<MovieListResponse>> {
    return this.api.get(`/movies/search?query=${encodeURIComponent(query)}&page=${page}`);
  }

  // Recommendation API endpoints
  async getRecommendations(userId: string, page = 1): Promise<AxiosResponse<MovieListResponse>> {
    return this.api.get(`/recommendations/${userId}?page=${page}`);
  }

  async getSimilarMovies(movieId: number): Promise<AxiosResponse<MovieListResponse>> {
    return this.api.get(`/movies/${movieId}/similar`);
  }

  // User action tracking
  async trackAction(action: UserAction): Promise<AxiosResponse<any>> {
    return this.api.post('/track-action', action);
  }

  // User profile endpoints
  async getUserProfile(userId: string): Promise<AxiosResponse<any>> {
    return this.api.get(`/user-profile/${userId}`);
  }

  async getUserActions(userId: string, page = 1): Promise<AxiosResponse<any>> {
    return this.api.get(`/user-actions/${userId}?page=${page}`);
  }

  async updateUserProfile(userId: string, updates: any): Promise<AxiosResponse<any>> {
    return this.api.put(`/user-profile/${userId}`, updates);
  }

  // Watchlist endpoints
  async getWatchlist(userId: string): Promise<AxiosResponse<MovieListResponse>> {
    return this.api.get(`/user/${userId}/watchlist`);
  }

  async addToWatchlist(userId: string, movieId: number): Promise<AxiosResponse<any>> {
    return this.api.post(`/user/${userId}/watchlist`, { movieId });
  }

  async removeFromWatchlist(userId: string, movieId: number): Promise<AxiosResponse<any>> {
    return this.api.delete(`/user/${userId}/watchlist/${movieId}`);
  }

  // Rating endpoints
  async rateMovie(userId: string, movieId: number, rating: number): Promise<AxiosResponse<any>> {
    return this.api.post(`/user/${userId}/ratings`, { movieId, rating });
  }

  async getUserRatings(userId: string): Promise<AxiosResponse<any>> {
    return this.api.get(`/user/${userId}/ratings`);
  }

  // Health check
  async healthCheck(): Promise<AxiosResponse<any>> {
    return this.api.get('/health');
  }
}

export const movieApi = new ApiService();

// Helper function to track user actions
export const trackUserAction = async (
  userId: string,
  movieId: number,
  actionType: UserAction['actionType'],
  value: number = 1
) => {
  try {
    await movieApi.trackAction({
      userId,
      movieId,
      actionType,
      value,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error tracking user action:', error);
  }
};

export default movieApi;