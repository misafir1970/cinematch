import React, { useState, useRef, useEffect, useCallback } from 'react';

interface MoviePosterProps {
  src: string;
  alt: string;
  size?: 'small' | 'medium' | 'large' | 'original';
  priority?: boolean;
  lazy?: boolean;
  className?: string;
  onLoad?: () => void;
  onError?: () => void;
  placeholder?: string;
  aspectRatio?: 'poster' | 'backdrop' | 'square';
}

interface ImageSizes {
  small: string;
  medium: string;
  large: string;
  original: string;
}

const TMDB_IMAGE_SIZES: ImageSizes = {
  small: 'w185',
  medium: 'w342', 
  large: 'w500',
  original: 'original'
};

// Aspect ratio configurations
const ASPECT_RATIOS = {
  poster: 'aspect-[2/3]',
  backdrop: 'aspect-[16/9]',
  square: 'aspect-square'
};

// Image loading states
type LoadingState = 'loading' | 'loaded' | 'error';

// Fallback placeholder images
const PLACEHOLDER_IMAGES = {
  poster: '/images/poster-placeholder.svg',
  backdrop: '/images/backdrop-placeholder.svg',
  square: '/images/square-placeholder.svg'
};

export const MoviePoster: React.FC<MoviePosterProps> = ({
  src,
  alt,
  size = 'medium',
  priority = false,
  lazy = true,
  className = '',
  onLoad,
  onError,
  placeholder,
  aspectRatio = 'poster'
}) => {
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [currentSrc, setCurrentSrc] = useState<string>('');
  const imgRef = useRef<HTMLImageElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Generate optimized image URL
  const generateImageUrl = useCallback((imgSrc: string, imgSize: keyof ImageSizes): string => {
    if (!imgSrc) return '';
    
    // Handle full URLs (already optimized)
    if (imgSrc.startsWith('http')) {
      return imgSrc;
    }
    
    // Handle TMDB paths
    if (imgSrc.startsWith('/')) {
      return `https://image.tmdb.org/t/p/${TMDB_IMAGE_SIZES[imgSize]}${imgSrc}`;
    }
    
    return imgSrc;
  }, []);

  // Progressive image loading
  const loadProgressiveImage = useCallback(async () => {
    if (!src) {
      setLoadingState('error');
      return;
    }

    try {
      // Load smaller image first for faster perceived loading
      const sizes: (keyof ImageSizes)[] = ['small', 'medium', 'large'];
      const targetSizeIndex = sizes.indexOf(size);
      
      // Start with a smaller size if available
      let startIndex = Math.max(0, targetSizeIndex - 1);
      
      for (let i = startIndex; i <= targetSizeIndex; i++) {
        const currentSize = sizes[i];
        const imageUrl = generateImageUrl(src, currentSize);
        
        // Preload image
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            setCurrentSrc(imageUrl);
            
            // If this is the final size, mark as loaded
            if (i === targetSizeIndex) {
              setLoadingState('loaded');
              onLoad?.();
            }
            resolve();
          };
          img.onerror = reject;
          img.src = imageUrl;
        });
      }
    } catch (error) {
      console.warn('Failed to load image:', src, error);
      setLoadingState('error');
      onError?.();
    }
  }, [src, size, generateImageUrl, onLoad, onError]);

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (!lazy || priority) {
      loadProgressiveImage();
      return;
    }

    if (!imgRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          loadProgressiveImage();
          observerRef.current?.disconnect();
        }
      },
      {
        rootMargin: '50px', // Start loading 50px before image comes into view
        threshold: 0.1
      }
    );

    observerRef.current.observe(imgRef.current);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [lazy, priority, loadProgressiveImage]);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  // Error fallback image
  const getFallbackImage = (): string => {
    if (placeholder) return placeholder;
    return PLACEHOLDER_IMAGES[aspectRatio] || PLACEHOLDER_IMAGES.poster;
  };

  // Generate srcSet for responsive images
  const generateSrcSet = (): string => {
    if (!src) return '';
    
    const srcSet = Object.entries(TMDB_IMAGE_SIZES)
      .map(([sizeName, tmdbSize]) => {
        const url = generateImageUrl(src, sizeName as keyof ImageSizes);
        const width = getImageWidth(sizeName as keyof ImageSizes);
        return `${url} ${width}w`;
      })
      .join(', ');
    
    return srcSet;
  };

  // Get image width for srcSet
  const getImageWidth = (sizeName: keyof ImageSizes): number => {
    const widths = {
      small: 185,
      medium: 342,
      large: 500,
      original: 1000
    };
    return widths[sizeName];
  };

  // Combined CSS classes
  const containerClasses = [
    'relative overflow-hidden',
    'bg-gray-900 bg-opacity-10',
    ASPECT_RATIOS[aspectRatio],
    className
  ].filter(Boolean).join(' ');

  const imageClasses = [
    'absolute inset-0 w-full h-full object-cover',
    'transition-all duration-500 ease-out',
    loadingState === 'loaded' ? 'opacity-100 scale-100' : 'opacity-0 scale-105'
  ].join(' ');

  const placeholderClasses = [
    'absolute inset-0 w-full h-full object-cover',
    'transition-opacity duration-300',
    loadingState === 'loaded' ? 'opacity-0' : 'opacity-100'
  ].join(' ');

  return (
    <div className={containerClasses}>
      {/* Placeholder/Loading state */}
      <div className={placeholderClasses}>
        {loadingState === 'loading' && (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 animate-pulse">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin opacity-50"></div>
            </div>
          </div>
        )}
        
        {loadingState === 'error' && (
          <img
            src={getFallbackImage()}
            alt={`${alt} - placeholder`}
            className="w-full h-full object-cover opacity-70"
          />
        )}
      </div>

      {/* Main image */}
      <img
        ref={imgRef}
        src={currentSrc || (!lazy || priority ? generateImageUrl(src, size) : undefined)}
        srcSet={currentSrc ? generateSrcSet() : undefined}
        sizes="(max-width: 640px) 185px, (max-width: 1024px) 342px, 500px"
        alt={alt}
        className={imageClasses}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => {
          if (loadingState !== 'loaded') {
            setLoadingState('loaded');
            onLoad?.();
          }
        }}
        onError={() => {
          setLoadingState('error');
          onError?.();
        }}
      />

      {/* Image overlay for better text readability (optional) */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
    </div>
  );
};

// HOC for automatic image optimization
export const OptimizedImage: React.FC<Omit<MoviePosterProps, 'size'> & {
  width?: number;
  height?: number;
}> = ({ width, height, ...props }) => {
  // Auto-determine size based on dimensions
  const getOptimalSize = (): MoviePosterProps['size'] => {
    if (!width) return 'medium';
    
    if (width <= 185) return 'small';
    if (width <= 342) return 'medium';
    if (width <= 500) return 'large';
    return 'original';
  };

  return <MoviePoster {...props} size={getOptimalSize()} />;
};

// Hook for image preloading
export const useImagePreloader = () => {
  const preloadImage = useCallback((src: string, size: keyof ImageSizes = 'medium'): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!src) {
        reject(new Error('No image source provided'));
        return;
      }

      const img = new Image();
      img.onload = () => resolve();
      img.onerror = reject;
      
      if (src.startsWith('/')) {
        img.src = `https://image.tmdb.org/t/p/${TMDB_IMAGE_SIZES[size]}${src}`;
      } else {
        img.src = src;
      }
    });
  }, []);

  const preloadImages = useCallback(async (
    images: Array<{ src: string; size?: keyof ImageSizes }>
  ): Promise<void> => {
    const preloadPromises = images.map(({ src, size = 'medium' }) => 
      preloadImage(src, size).catch(error => 
        console.warn('Failed to preload image:', src, error)
      )
    );

    await Promise.allSettled(preloadPromises);
  }, [preloadImage]);

  return { preloadImage, preloadImages };
};

// Image cache management
class ImageCache {
  private cache = new Map<string, { url: string; timestamp: number }>();
  private maxSize = 100;
  private maxAge = 30 * 60 * 1000; // 30 minutes

  set(key: string, url: string): void {
    // Clean old entries if cache is full
    if (this.cache.size >= this.maxSize) {
      this.cleanup();
    }

    this.cache.set(key, {
      url,
      timestamp: Date.now()
    });
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }

    return entry.url;
  }

  private cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > this.maxAge) {
        toDelete.push(key);
      }
    });

    toDelete.forEach(key => this.cache.delete(key));

    // If still too many entries, remove oldest
    if (this.cache.size >= this.maxSize) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = entries.slice(0, Math.floor(this.maxSize * 0.2));
      toRemove.forEach(([key]) => this.cache.delete(key));
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export const imageCache = new ImageCache();