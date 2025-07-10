import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingSpinner } from '../components/LoadingSpinner';

// Lazy load components for code splitting
const Home = lazy(() => import('../pages/Home'));
const MovieDetails = lazy(() => import('../pages/MovieDetails'));
const Recommendations = lazy(() => import('../pages/Recommendations'));
const Profile = lazy(() => import('../pages/Profile'));
const Search = lazy(() => import('../pages/Search'));
const Watchlist = lazy(() => import('../pages/Watchlist'));

// Skeletons for better UX
const MovieDetailsSkeleton = lazy(() => import('../components/skeletons/MovieDetailsSkeleton'));
const RecommendationsSkeleton = lazy(() => import('../components/skeletons/RecommendationsSkeleton'));
const ProfileSkeleton = lazy(() => import('../components/skeletons/ProfileSkeleton'));

// Error pages
const NotFound = lazy(() => import('../pages/NotFound'));
const ServerError = lazy(() => import('../pages/ServerError'));

interface LazyWrapperProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

// Enhanced Suspense wrapper with error boundary
const LazyWrapper: React.FC<LazyWrapperProps> = ({ 
  children, 
  fallback = <LoadingSpinner /> 
}) => (
  <ErrorBoundary>
    <Suspense fallback={fallback}>
      {children}
    </Suspense>
  </ErrorBoundary>
);

export const AppRouter: React.FC = () => {
  return (
    <Router>
      <Routes>
        {/* Home Route */}
        <Route 
          path="/" 
          element={
            <LazyWrapper>
              <Home />
            </LazyWrapper>
          } 
        />
        
        {/* Movie Details with enhanced skeleton */}
        <Route 
          path="/movie/:id" 
          element={
            <LazyWrapper fallback={<MovieDetailsSkeleton />}>
              <MovieDetails />
            </LazyWrapper>
          } 
        />
        
        {/* Recommendations */}
        <Route 
          path="/recommendations" 
          element={
            <LazyWrapper fallback={<RecommendationsSkeleton />}>
              <Recommendations />
            </LazyWrapper>
          } 
        />
        
        {/* User Profile */}
        <Route 
          path="/profile" 
          element={
            <LazyWrapper fallback={<ProfileSkeleton />}>
              <Profile />
            </LazyWrapper>
          } 
        />
        
        {/* Search Results */}
        <Route 
          path="/search" 
          element={
            <LazyWrapper>
              <Search />
            </LazyWrapper>
          } 
        />
        
        {/* Watchlist */}
        <Route 
          path="/watchlist" 
          element={
            <LazyWrapper>
              <Watchlist />
            </LazyWrapper>
          } 
        />
        
        {/* Redirect old URLs */}
        <Route path="/movies/:id" element={<Navigate to="/movie/:id" replace />} />
        <Route path="/users/profile" element={<Navigate to="/profile" replace />} />
        
        {/* Error Pages */}
        <Route 
          path="/error" 
          element={
            <LazyWrapper>
              <ServerError />
            </LazyWrapper>
          } 
        />
        
        {/* 404 Not Found */}
        <Route 
          path="*" 
          element={
            <LazyWrapper>
              <NotFound />
            </LazyWrapper>
          } 
        />
      </Routes>
    </Router>
  );
};

// Route preloading for better UX
export const preloadRoutes = {
  recommendations: () => import('../pages/Recommendations'),
  movieDetails: () => import('../pages/MovieDetails'),
  profile: () => import('../pages/Profile'),
  search: () => import('../pages/Search'),
  watchlist: () => import('../pages/Watchlist')
};

// Preload critical routes on user interaction
export const preloadCriticalRoutes = () => {
  // Preload recommendations page (most likely next page)
  preloadRoutes.recommendations();
  
  // Preload movie details (high probability)
  preloadRoutes.movieDetails();
};

// Hook for programmatic route preloading
export const useRoutePreloader = () => {
  const preloadRoute = (routeName: keyof typeof preloadRoutes) => {
    preloadRoutes[routeName]();
  };

  return { preloadRoute };
};