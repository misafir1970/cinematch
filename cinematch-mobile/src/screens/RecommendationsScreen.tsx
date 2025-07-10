import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';

import { colors } from '../config/theme';
import MovieCard from '../components/MovieCard';
import Header from '../components/Header';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { movieApi } from '../services/api';
import { Movie } from '../types/Movie';

const RecommendationsScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [recommendations, setRecommendations] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async (pageNumber = 1, append = false) => {
    try {
      if (!append) setLoading(true);
      
      const response = await movieApi.getRecommendations('user123', pageNumber);
      const newMovies = response.data.results || [];
      
      if (append) {
        setRecommendations(prev => [...prev, ...newMovies]);
      } else {
        setRecommendations(newMovies);
      }
      
      setHasMore(pageNumber < (response.data.total_pages || 1));
      setPage(pageNumber);
    } catch (error) {
      console.error('Error loading recommendations:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRecommendations(1, false);
    setRefreshing(false);
  };

  const loadMore = () => {
    if (hasMore && !loading) {
      loadRecommendations(page + 1, true);
    }
  };

  const handleMoviePress = (movie: Movie) => {
    navigation.navigate('MovieDetails', { movie });
  };

  const renderMovie = ({ item }: { item: Movie }) => (
    <MovieCard
      movie={item}
      onPress={() => handleMoviePress(item)}
      style={styles.movieCard}
    />
  );

  const renderFooter = () => {
    if (!hasMore) return null;
    return (
      <View style={styles.loadingFooter}>
        <LoadingSpinner size="small" />
      </View>
    );
  };

  if (loading && recommendations.length === 0) {
    return <LoadingSpinner />;
  }

  if (!loading && recommendations.length === 0) {
    return (
      <View style={styles.container}>
        <Header title={t('recommendations.title')} showBack />
        <EmptyState
          title={t('recommendations.noRecommendations')}
          subtitle="Start rating movies to get personalized recommendations"
          actionText="Browse Movies"
          onActionPress={() => navigation.navigate('Search')}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Header title={t('recommendations.title')} showBack />
      
      <Text style={styles.subtitle}>{t('recommendations.basedOnYourRatings')}</Text>
      
      <FlatList
        data={recommendations}
        renderItem={renderMovie}
        keyExtractor={(item) => item.id.toString()}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.1}
        ListFooterComponent={renderFooter}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  listContent: {
    paddingHorizontal: 8,
    paddingBottom: 20,
  },
  row: {
    justifyContent: 'space-around',
  },
  movieCard: {
    marginHorizontal: 8,
    marginBottom: 16,
  },
  loadingFooter: {
    paddingVertical: 20,
    alignItems: 'center',
  },
});

export default RecommendationsScreen;