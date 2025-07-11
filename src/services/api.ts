// API Service for backend communication
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isVerified: boolean;
  lastLogin?: string;
}

export interface UserProfile {
  user: User;
  profile: {
    preferences: Record<string, any>;
    settings: Record<string, any>;
    favoriteGenres: string[];
    watchProviders: string[];
    languagePreferences: string[];
    createdAt: string;
    updatedAt: string;
  };
  statistics: {
    totalRatings: number;
    watchlistCount: number;
    averageRating: number;
    genresRated: number;
  };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface MovieRating {
  id?: string;
  user_id?: string;
  movie_id: number;
  movie_title: string;
  movie_poster_path?: string;
  movie_release_date?: string;
  movie_genres?: string[];
  rating: number;
  review_text?: string;
  is_favorite?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface WatchlistItem {
  id?: string;
  user_id?: string;
  movie_id: number;
  movie_title: string;
  movie_poster_path?: string;
  movie_release_date?: string;
  movie_genres?: string[];
  status: 'to_watch' | 'watched' | 'skipped' | 'favorite';
  added_at?: string;
  watched_at?: string;
  notes?: string;
}

class ApiService {
  private getAccessToken(): string | null {
    return localStorage.getItem('cinematch_access_token');
  }

  private getRefreshToken(): string | null {
    return localStorage.getItem('cinematch_refresh_token');
  }

  private setTokens(tokens: AuthTokens): void {
    localStorage.setItem('cinematch_access_token', tokens.accessToken);
    localStorage.setItem('cinematch_refresh_token', tokens.refreshToken);
  }

  private clearTokens(): void {
    localStorage.removeItem('cinematch_access_token');
    localStorage.removeItem('cinematch_refresh_token');
  }

  private async makeRequest<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers
    });

    if (response.status === 401 && token) {
      // Try to refresh token
      const refreshed = await this.refreshToken();
      if (refreshed) {
        // Retry with new token
        headers.Authorization = `Bearer ${this.getAccessToken()}`;
        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
          ...options,
          headers
        });
        return this.handleResponse(retryResponse);
      } else {
        this.clearTokens();
        window.dispatchEvent(new CustomEvent('auth:logout'));
        throw new Error('Authentication failed');
      }
    }

    return this.handleResponse(response);
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    if (data.success === false) {
      throw new Error(data.error || 'Request failed');
    }

    return data.data || data;
  }

  // Auth methods
  async register(userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<{ user: User; tokens: AuthTokens }> {
    const result = await this.makeRequest<{ user: User; tokens: AuthTokens }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    });

    this.setTokens(result.tokens);
    return result;
  }

  async login(credentials: {
    email: string;
    password: string;
  }): Promise<{ user: User; tokens: AuthTokens }> {
    const result = await this.makeRequest<{ user: User; tokens: AuthTokens }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    });

    this.setTokens(result.tokens);
    return result;
  }

  async logout(): Promise<void> {
    try {
      const refreshToken = this.getRefreshToken();
      if (refreshToken) {
        await this.makeRequest('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken })
        });
      }
    } catch (error) {
      console.warn('Logout error:', error);
    } finally {
      this.clearTokens();
    }
  }

  async refreshToken(): Promise<boolean> {
    try {
      const refreshToken = this.getRefreshToken();
      if (!refreshToken) return false;

      const result = await this.makeRequest<{ accessToken: string }>('/auth/refresh-token', {
        method: 'POST',
        body: JSON.stringify({ refreshToken })
      });

      localStorage.setItem('cinematch_access_token', result.accessToken);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getCurrentUser(): Promise<User> {
    const result = await this.makeRequest<{ user: User }>('/auth/me');
    return result.user;
  }

  async forgotPassword(email: string): Promise<void> {
    await this.makeRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.makeRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword })
    });
  }

  // User profile methods
  async getUserProfile(): Promise<UserProfile> {
    const result = await this.makeRequest<{ profile: UserProfile }>('/user/profile');
    return result.profile;
  }

  async updateUserProfile(profileData: Partial<UserProfile['profile']>): Promise<UserProfile['profile']> {
    const result = await this.makeRequest<{ profile: UserProfile['profile'] }>('/user/profile', {
      method: 'PUT',
      body: JSON.stringify(profileData)
    });
    return result.profile;
  }

  // Ratings methods
  async getUserRatings(options: {
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
    minRating?: number;
    maxRating?: number;
  } = {}): Promise<{ ratings: MovieRating[]; total: number; limit: number; offset: number }> {
    const params = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value.toString());
      }
    });

    const result = await this.makeRequest<{ ratings: { ratings: MovieRating[]; total: number; limit: number; offset: number } }>(`/user/ratings?${params}`);
    return result.ratings;
  }

  async rateMovie(ratingData: Omit<MovieRating, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<MovieRating> {
    const result = await this.makeRequest<{ rating: MovieRating }>('/user/ratings', {
      method: 'POST',
      body: JSON.stringify(ratingData)
    });
    return result.rating;
  }

  async deleteRating(movieId: number): Promise<void> {
    await this.makeRequest(`/user/ratings/${movieId}`, {
      method: 'DELETE'
    });
  }

  // Watchlist methods
  async getUserWatchlist(options: {
    limit?: number;
    offset?: number;
    status?: string;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
  } = {}): Promise<{ watchlist: WatchlistItem[]; total: number; limit: number; offset: number }> {
    const params = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value.toString());
      }
    });

    const result = await this.makeRequest<{ watchlist: { watchlist: WatchlistItem[]; total: number; limit: number; offset: number } }>(`/user/watchlist?${params}`);
    return result.watchlist;
  }

  async addToWatchlist(movieData: Omit<WatchlistItem, 'id' | 'user_id' | 'added_at' | 'watched_at'>): Promise<WatchlistItem> {
    const result = await this.makeRequest<{ watchlistItem: WatchlistItem }>('/user/watchlist', {
      method: 'POST',
      body: JSON.stringify(movieData)
    });
    return result.watchlistItem;
  }

  async updateWatchlistItem(movieId: number, updateData: { status?: string; notes?: string; watchedAt?: string }): Promise<WatchlistItem> {
    const result = await this.makeRequest<{ watchlistItem: WatchlistItem }>(`/user/watchlist/${movieId}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });
    return result.watchlistItem;
  }

  async removeFromWatchlist(movieId: number): Promise<void> {
    await this.makeRequest(`/user/watchlist/${movieId}`, {
      method: 'DELETE'
    });
  }

  // Bulk operations
  async bulkRateMovies(ratings: Omit<MovieRating, 'id' | 'user_id' | 'created_at' | 'updated_at'>[]): Promise<{ results: MovieRating[]; errors?: any[] }> {
    const result = await this.makeRequest<{ results: MovieRating[]; errors?: any[] }>('/user/ratings/bulk', {
      method: 'POST',
      body: JSON.stringify({ ratings })
    });
    return result;
  }

  // Health check
  async healthCheck(): Promise<{ status: string; services: Record<string, string> }> {
    return this.makeRequest('/health');
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return !!this.getAccessToken();
  }
}

export const apiService = new ApiService();
export default apiService;