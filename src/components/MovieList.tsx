import React from 'react';
import { Movie } from '../types/Movie';
import MoviePoster from './MoviePoster';

interface MovieListProps {
  movies: Movie[];
  onMovieClick: (movie: Movie) => void;
  title?: string;
  className?: string;
  isLoading?: boolean;
}

const MovieList: React.FC<MovieListProps> = ({
  movies,
  onMovieClick,
  title,
  className = '',
  isLoading = false
}) => {
  if (isLoading) {
    return (
      <div className={`movie-list ${className}`}>
        {title && <h2 className="text-2xl font-bold mb-4 text-white">{title}</h2>}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="animate-pulse">
              <div className="bg-gray-700 aspect-[2/3] rounded-lg"></div>
              <div className="mt-2 h-4 bg-gray-700 rounded"></div>
              <div className="mt-1 h-3 bg-gray-700 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`movie-list ${className}`}>
      {title && (
        <h2 className="text-2xl font-bold mb-4 text-white">{title}</h2>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {movies.map((movie) => (
          <div
            key={movie.id}
            className="cursor-pointer transform transition-transform hover:scale-105"
            onClick={() => onMovieClick(movie)}
          >
            <MoviePoster
              src={movie.poster_path}
              alt={movie.title}
              size="medium"
              className="mb-2"
            />
            <h3 className="text-white text-sm font-medium line-clamp-2 mb-1">
              {movie.title}
            </h3>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{movie.release_date?.split('-')[0]}</span>
              <div className="flex items-center">
                <span className="text-yellow-400">⭐</span>
                <span className="ml-1">{movie.vote_average.toFixed(1)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MovieList;