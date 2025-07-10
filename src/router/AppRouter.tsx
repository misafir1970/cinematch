import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary';
import LoadingSpinner from '../components/LoadingSpinner';
import MovieDetailsSkeleton from '../components/skeletons/MovieDetailsSkeleton';
import RecommendationsSkeleton from '../components/skeletons/RecommendationsSkeleton';
import ProfileSkeleton from '../components/skeletons/ProfileSkeleton';

// Lazy load components for code splitting
const Home = lazy(() => import('../pages/Home'));
const MovieDetails = lazy(() => import('../pages/MovieDetails'));
const Recommendations = lazy(() => import('../pages/Recommendations'));
const Profile = lazy(() => import('../pages/Profile'));
const Search = lazy(() => import('../pages/Search'));
const Watchlist = lazy(() => import('../pages/Watchlist'));
const Settings = lazy(() => import('../pages/Settings'));
const About = lazy(() => import('../pages/About'));
const NotFound = lazy(() => import('../pages/NotFound'));

// Preload critical components
const MovieDetailsPreload = lazy(() => 
  import('../pages/MovieDetails').then(module => {
    // Preload related components
    import('../components/MovieRating');
    import('../components/MovieRecommendations');
    return module;
  })
);

const RecommendationsPreload = lazy(() => 
  import('../pages/Recommendations').then(module => {
    // Preload recommendation components
    import('../components/RecommendationCard');
    import('../components/RecommendationFilters');
    return module;
  })
);

interface AppRouterProps {
  isAuthenticated?: boolean;
  onRouteChange?: (route: string) => void;
}

export const AppRouter: React.FC<AppRouterProps> = ({ 
  isAuthenticated = false, 
  onRouteChange 
}) => {
  // Route change handler for analytics
  const handleRouteChange = (route: string) => {
    onRouteChange?.(route);
    
    // Track route changes for performance monitoring
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('config', 'GA_MEASUREMENT_ID', {
        page_path: route,
      });
    }
  };

  return (
    <Router>
      <ErrorBoundary>
        <Routes>
          {/* Public Routes */}
          <Route 
            path="/" 
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <Home />
              </Suspense>
            } 
          />
          
          <Route 
            path="/movie/:id" 
            element={
              <Suspense fallback={<MovieDetailsSkeleton />}>
                <MovieDetailsPreload />
              </Suspense>
            } 
          />
          
          <Route 
            path="/search" 
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <Search />
              </Suspense>
            } 
          />
          
          <Route 
            path="/about" 
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <About />
              </Suspense>
            } 
          />

          {/* Protected Routes */}
          {isAuthenticated ? (
            <>
              <Route 
                path="/recommendations" 
                element={
                  <Suspense fallback={<RecommendationsSkeleton />}>
                    <RecommendationsPreload />
                  </Suspense>
                } 
              />
              
              <Route 
                path="/profile" 
                element={
                  <Suspense fallback={<ProfileSkeleton />}>
                    <Profile />
                  </Suspense>
                } 
              />
              
              <Route 
                path="/watchlist" 
                element={
                  <Suspense fallback={<LoadingSpinner />}>
                    <Watchlist />
                  </Suspense>
                } 
              />
              
              <Route 
                path="/settings" 
                element={
                  <Suspense fallback={<LoadingSpinner />}>
                    <Settings />
                  </Suspense>
                } 
              />
            </>
          ) : (
            <>
              {/* Redirect unauthorized users */}
              <Route path="/recommendations" element={<Navigate to="/login" replace />} />
              <Route path="/profile" element={<Navigate to="/login" replace />} />
              <Route path="/watchlist" element={<Navigate to="/login" replace />} />
              <Route path="/settings" element={<Navigate to="/login" replace />} />
            </>
          )}

          {/* 404 Route */}
          <Route 
            path="*" 
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <NotFound />
              </Suspense>
            } 
          />
        </Routes>
      </ErrorBoundary>
    </Router>
  );
};

// Route preloader for critical paths
export const preloadRoute = (routeName: string) => {
  switch (routeName) {
    case 'movie-details':
      import('../pages/MovieDetails');
      import('../components/MovieRating');
      import('../components/MovieRecommendations');
      break;
    case 'recommendations':
      import('../pages/Recommendations');
      import('../components/RecommendationCard');
      import('../components/RecommendationFilters');
      break;
    case 'profile':
      import('../pages/Profile');
      import('../components/ProfileSettings');
      break;
    default:
      break;
  }
};

// Enhanced Router with performance monitoring
export const AppRouterWithAnalytics: React.FC<AppRouterProps> = (props) => {
  React.useEffect(() => {
    // Preload critical routes on app start
    const criticalRoutes = ['movie-details', 'recommendations'];
    
    // Delay preloading to avoid blocking initial render
    setTimeout(() => {
      criticalRoutes.forEach(route => preloadRoute(route));
    }, 2000);
  }, []);

  return <AppRouter {...props} />;
};

export default AppRouter;