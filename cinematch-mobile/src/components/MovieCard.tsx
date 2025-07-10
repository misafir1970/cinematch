import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../config/theme';
import { Movie } from '../types/Movie';

interface MovieCardProps {
  movie: Movie;
  onPress: () => void;
  style?: any;
  size?: 'small' | 'medium' | 'large';
}

const { width } = Dimensions.get('window');
const cardWidth = (width - 48) / 2; // 2 columns with margins

const MovieCard: React.FC<MovieCardProps> = ({
  movie,
  onPress,
  style,
  size = 'medium',
}) => {
  const getImageUrl = (path: string | null, size: string = 'w342') => {
    if (!path) return 'https://via.placeholder.com/342x513?text=No+Image';
    return `https://image.tmdb.org/t/p/${size}${path}`;
  };

  const formatRating = (rating: number) => {
    return (rating / 2).toFixed(1); // Convert from 10-scale to 5-scale
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.getFullYear().toString();
  };

  const cardHeight = size === 'small' ? 200 : size === 'large' ? 320 : 280;

  return (
    <TouchableOpacity
      style={[styles.container, { width: cardWidth, height: cardHeight }, style]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: getImageUrl(movie.poster_path) }}
          style={styles.poster}
          resizeMode="cover"
        />
        
        {/* Rating Badge */}
        {movie.vote_average > 0 && (
          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={12} color="#FFD700" />
            <Text style={styles.ratingText}>
              {formatRating(movie.vote_average)}
            </Text>
          </View>
        )}

        {/* Gradient Overlay */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          style={styles.gradient}
        />
        
        {/* Movie Info */}
        <View style={styles.movieInfo}>
          <Text style={styles.title} numberOfLines={2}>
            {movie.title}
          </Text>
          {movie.release_date && (
            <Text style={styles.year}>
              {formatDate(movie.release_date)}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  imageContainer: {
    flex: 1,
    position: 'relative',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  ratingBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 2,
  },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
  },
  movieInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
    lineHeight: 18,
  },
  year: {
    color: '#ccc',
    fontSize: 12,
  },
});

export default MovieCard;