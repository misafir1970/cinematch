import React, { useState, useCallback } from 'react';

interface MoviePosterProps {
  src: string;
  alt: string;
  size?: 'small' | 'medium' | 'large' | 'xl';
  className?: string;
  onClick?: () => void;
  priority?: boolean; // For above-the-fold images
}

export const MoviePoster: React.FC<MoviePosterProps> = ({ 
  src, 
  alt, 
  size = 'medium',
  className = '',
  onClick,
  priority = false
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // TMDB image size mappings for optimal performance
  const sizes = {
    small: 'w185',
    medium: 'w342', 
    large: 'w500',
    xl: 'w780'
  };

  // CSS classes for different sizes
  const sizeClasses = {
    small: 'w-24 h-36',
    medium: 'w-32 h-48',
    large: 'w-48 h-72',
    xl: 'w-64 h-96'
  };

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
  }, []);

  const handleError = useCallback(() => {
    setHasError(true);
    setIsLoaded(true); // Show fallback
  }, []);

  // Construct optimized image URL
  const imageUrl = src.startsWith('http') 
    ? src 
    : `https://image.tmdb.org/t/p/${sizes[size]}${src}`;

  // Fallback image for broken/missing images
  const fallbackImage = (
    <div className={`${sizeClasses[size]} bg-slate-700/50 border border-slate-600/30 rounded-xl flex items-center justify-center ${className}`}>
      <svg 
        className="w-8 h-8 text-slate-500" 
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={1.5} 
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" 
        />
      </svg>
    </div>
  );

  if (hasError) {
    return fallbackImage;
  }

  return (
    <div 
      className={`relative overflow-hidden rounded-xl group cursor-pointer ${sizeClasses[size]} ${className}`}
      onClick={onClick}
    >
      {/* Loading placeholder */}
      {!isLoaded && (
        <div className={`absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-800 animate-pulse ${sizeClasses[size]} rounded-xl`}>
          <div className="absolute inset-0 bg-gradient-to-t from-slate-800/80 via-transparent to-slate-700/20" />
        </div>
      )}
      
      {/* Optimized image */}
      <img
        src={imageUrl}
        alt={alt}
        loading={priority ? "eager" : "lazy"} // Prioritize above-the-fold images
        decoding="async"
        className={`
          w-full h-full object-cover transition-all duration-500 
          ${isLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-105'}
          group-hover:scale-105 group-hover:brightness-110
        `}
        onLoad={handleLoad}
        onError={handleError}
        // Responsive images support
        sizes={`
          (max-width: 640px) ${size === 'small' ? '96px' : '128px'},
          (max-width: 768px) ${size === 'large' ? '192px' : '160px'},
          ${size === 'xl' ? '256px' : '192px'}
        `}
      />
      
      {/* Hover overlay effect */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <div className="absolute bottom-2 left-2 right-2">
          <div className="text-white text-sm font-medium line-clamp-2">
            {alt}
          </div>
        </div>
      </div>
      
      {/* Quality indicator */}
      {isLoaded && !hasError && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="bg-green-500/80 text-white text-xs px-2 py-1 rounded-full">
            HD
          </div>
        </div>
      )}
    </div>
  );
};

// Higher-order component for intersection observer (lazy loading)
export const LazyMoviePoster: React.FC<MoviePosterProps & { 
  rootMargin?: string;
  threshold?: number;
}> = ({ rootMargin = '50px', threshold = 0.1, ...props }) => {
  const [isInView, setIsInView] = useState(false);
  const [ref, setRef] = useState<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!ref) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.unobserve(ref);
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(ref);

    return () => {
      if (ref) observer.unobserve(ref);
    };
  }, [ref, rootMargin, threshold]);

  if (!isInView) {
    return (
      <div 
        ref={setRef}
        className={`bg-slate-700/30 animate-pulse rounded-xl ${
          props.size === 'small' ? 'w-24 h-36' :
          props.size === 'large' ? 'w-48 h-72' :
          props.size === 'xl' ? 'w-64 h-96' :
          'w-32 h-48'
        } ${props.className || ''}`}
      />
    );
  }

  return <MoviePoster {...props} />;
};

// Responsive poster that adapts to screen size
export const ResponsiveMoviePoster: React.FC<Omit<MoviePosterProps, 'size'> & {
  mobileSize?: 'small' | 'medium';
  tabletSize?: 'medium' | 'large';
  desktopSize?: 'large' | 'xl';
}> = ({ 
  mobileSize = 'small',
  tabletSize = 'medium', 
  desktopSize = 'large',
  className = '',
  ...props 
}) => {
  return (
    <>
      {/* Mobile */}
      <div className="block sm:hidden">
        <MoviePoster {...props} size={mobileSize} className={className} />
      </div>
      {/* Tablet */}
      <div className="hidden sm:block lg:hidden">
        <MoviePoster {...props} size={tabletSize} className={className} />
      </div>
      {/* Desktop */}
      <div className="hidden lg:block">
        <MoviePoster {...props} size={desktopSize} className={className} />
      </div>
    </>
  );
};

export default MoviePoster;