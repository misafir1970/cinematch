import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { LoadingSpinner } from '../shared/components';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';

// Lazy-loaded components for better performance
const Home = lazy(() => import('../pages/Home'));
const MovieDetails = lazy(() => import('../pages/MovieDetails'));
const Recommendations = lazy(() => import('../pages/Recommendations'));
const Profile = lazy(() => import('../pages/Profile'));
const Search = lazy(() => import('../pages/Search'));
const Watchlist = lazy(() => import('../pages/Watchlist'));
const Settings = lazy(() => import('../pages/Settings'));
const About = lazy(() => import('../pages/About'));

// Loading components for better UX
const MovieDetailsSkeleton = () => (
  <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
    <div className="max-w-6xl mx-auto">
      <div className="animate-pulse">
        <div className="flex flex-col lg:flex-row gap-8">
          <div className="lg:w-1/3">
            <div className="aspect-[2/3] bg-slate-700 rounded-xl"></div>
          </div>
          <div className="lg:w-2/3 space-y-4">
            <div className="h-8 bg-slate-700 rounded w-3/4"></div>
            <div className="h-4 bg-slate-700 rounded w-1/2"></div>
            <div className="space-y-2">
              <div className="h-4 bg-slate-700 rounded"></div>
              <div className="h-4 bg-slate-700 rounded"></div>
              <div className="h-4 bg-slate-700 rounded w-5/6"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const RecommendationsSkeleton = () => (
  <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
    <div className="max-w-7xl mx-auto">
      <div className="animate-pulse space-y-8">
        <div className="h-12 bg-slate-700 rounded w-1/3"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="space-y-4">
              <div className="aspect-[2/3] bg-slate-700 rounded-xl"></div>
              <div className="h-4 bg-slate-700 rounded w-3/4"></div>
              <div className="h-3 bg-slate-700 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const ProfileSkeleton = () => (
  <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
    <div className="max-w-4xl mx-auto">
      <div className="animate-pulse space-y-8">
        <div className="text-center space-y-4">
          <div className="w-24 h-24 bg-slate-700 rounded-full mx-auto"></div>
          <div className="h-6 bg-slate-700 rounded w-48 mx-auto"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-32 bg-slate-700 rounded-xl"></div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const SearchSkeleton = () => (
  <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
    <div className="max-w-7xl mx-auto">
      <div className="animate-pulse space-y-8">
        <div className="h-12 bg-slate-700 rounded"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="space-y-4">
              <div className="aspect-[2/3] bg-slate-700 rounded-xl"></div>
              <div className="h-4 bg-slate-700 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const GenericSkeleton = () => (
  <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
    <div className="max-w-7xl mx-auto">
      <div className="animate-pulse space-y-8">
        <div className="h-8 bg-slate-700 rounded w-1/4"></div>
        <div className="space-y-4">
          <div className="h-4 bg-slate-700 rounded"></div>
          <div className="h-4 bg-slate-700 rounded w-5/6"></div>
          <div className="h-4 bg-slate-700 rounded w-3/4"></div>
        </div>
      </div>
    </div>
  </div>
);

// Enhanced error fallback component
const RouteErrorFallback = ({ error, resetError }: { error: Error; resetError: () => void }) => (
  <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-8">
    <div className="max-w-md w-full bg-slate-800 rounded-xl p-8 text-center border border-red-500/20">
      <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-white mb-2">Sayfa Yüklenemedi</h2>
      <p className="text-slate-300 mb-6">Bu sayfada bir hata oluştu. Lütfen tekrar deneyin.</p>
      <div className="space-y-3">
        <button
          onClick={resetError}
          className="w-full bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Tekrar Dene
        </button>
        <button
          onClick={() => window.location.href = '/'}
          className="w-full bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Ana Sayfaya Dön
        </button>
      </div>
      {process.env.NODE_ENV === 'development' && (
        <details className="mt-4 text-left">
          <summary className="text-slate-400 cursor-pointer">Hata Detayları</summary>
          <pre className="text-xs text-red-400 mt-2 p-2 bg-slate-900 rounded overflow-auto">
            {error.message}
            {error.stack}
          </pre>
        </details>
      )}
    </div>
  </div>
);

// Route configuration for better maintainability
const routes = [
  {
    path: '/',
    component: Home,
    skeleton: GenericSkeleton,
    exact: true
  },
  {
    path: '/movie/:id',
    component: MovieDetails,
    skeleton: MovieDetailsSkeleton
  },
  {
    path: '/recommendations',
    component: Recommendations,
    skeleton: RecommendationsSkeleton
  },
  {
    path: '/profile',
    component: Profile,
    skeleton: ProfileSkeleton
  },
  {
    path: '/search',
    component: Search,
    skeleton: SearchSkeleton
  },
  {
    path: '/watchlist',
    component: Watchlist,
    skeleton: GenericSkeleton
  },
  {
    path: '/settings',
    component: Settings,
    skeleton: GenericSkeleton
  },
  {
    path: '/about',
    component: About,
    skeleton: GenericSkeleton
  }
];

// Enhanced Suspense wrapper with better loading states
const SuspenseWrapper = ({ 
  children, 
  fallback, 
  timeout = 10000 
}: { 
  children: React.ReactNode; 
  fallback: React.ComponentType; 
  timeout?: number;
}) => {
  const Fallback = fallback;
  
  return (
    <ErrorBoundary fallback={RouteErrorFallback}>
      <Suspense fallback={<Fallback />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
};

export const AppRouter = () => {
  return (
    <Router>
      <Routes>
        {routes.map(({ path, component: Component, skeleton, exact }) => (
          <Route
            key={path}
            path={path}
            element={
              <SuspenseWrapper fallback={skeleton}>
                <Component />
              </SuspenseWrapper>
            }
          />
        ))}
        
        {/* Redirect unknown routes to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

// Preload critical routes for better performance
export const preloadCriticalRoutes = () => {
  // Preload most commonly accessed routes
  import('../pages/Recommendations');
  import('../pages/MovieDetails');
  import('../pages/Search');
};

// Route-based code splitting utilities
export const prefetchRoute = (routeName: string) => {
  const route = routes.find(r => r.path.includes(routeName));
  if (route) {
    return route.component;
  }
};

export default AppRouter;