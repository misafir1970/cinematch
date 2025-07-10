import React from 'react';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: boolean;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  width,
  height,
  rounded = false
}) => {
  const style = {
    width,
    height,
  };

  return (
    <div
      className={`bg-gray-700 animate-pulse ${rounded ? 'rounded-full' : 'rounded'} ${className}`}
      style={style}
    />
  );
};

export const MoviePosterSkeleton: React.FC = () => (
  <div className="space-y-2">
    <Skeleton className="aspect-[2/3] w-full" />
    <Skeleton height="1rem" />
    <Skeleton height="0.75rem" width="60%" />
  </div>
);

export const MovieCardSkeleton: React.FC = () => (
  <div className="bg-gray-800 rounded-lg p-4 space-y-3">
    <Skeleton className="aspect-[16/9] w-full" />
    <div className="space-y-2">
      <Skeleton height="1.25rem" />
      <Skeleton height="1rem" width="80%" />
      <div className="flex justify-between">
        <Skeleton height="0.875rem" width="30%" />
        <Skeleton height="0.875rem" width="25%" />
      </div>
    </div>
  </div>
);

export const MovieDetailsSkeleton: React.FC = () => (
  <div className="space-y-6">
    {/* Backdrop skeleton */}
    <Skeleton className="w-full h-64 md:h-96" />
    
    <div className="container mx-auto px-4">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Poster skeleton */}
        <div className="md:w-1/3">
          <Skeleton className="aspect-[2/3] w-full max-w-sm mx-auto" />
        </div>
        
        {/* Details skeleton */}
        <div className="md:w-2/3 space-y-4">
          <Skeleton height="2.5rem" width="70%" />
          <Skeleton height="1.25rem" width="40%" />
          
          <div className="space-y-2">
            <Skeleton height="1rem" />
            <Skeleton height="1rem" />
            <Skeleton height="1rem" width="80%" />
          </div>
          
          <div className="flex gap-4">
            <Skeleton height="2.5rem" width="8rem" />
            <Skeleton height="2.5rem" width="8rem" />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Skeleton height="1rem" width="30%" />
              <Skeleton height="1rem" width="50%" />
            </div>
            <div className="space-y-2">
              <Skeleton height="1rem" width="30%" />
              <Skeleton height="1rem" width="50%" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const RecommendationsSkeleton: React.FC = () => (
  <div className="space-y-6">
    <div className="flex justify-between items-center">
      <Skeleton height="2rem" width="12rem" />
      <Skeleton height="1.5rem" width="6rem" />
    </div>
    
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {Array.from({ length: 12 }).map((_, index) => (
        <MoviePosterSkeleton key={index} />
      ))}
    </div>
  </div>
);

export const UserProfileSkeleton: React.FC = () => (
  <div className="space-y-6">
    <div className="flex items-center space-x-4">
      <Skeleton width="4rem" height="4rem" rounded />
      <div className="space-y-2">
        <Skeleton height="1.25rem" width="8rem" />
        <Skeleton height="1rem" width="12rem" />
      </div>
    </div>
    
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="bg-gray-800 rounded-lg p-4 space-y-2">
          <Skeleton height="1rem" width="60%" />
          <Skeleton height="1.5rem" width="40%" />
        </div>
      ))}
    </div>
    
    <div className="space-y-4">
      <Skeleton height="1.5rem" width="8rem" />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <MoviePosterSkeleton key={index} />
        ))}
      </div>
    </div>
  </div>
);

export default Skeleton;