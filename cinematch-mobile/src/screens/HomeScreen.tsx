import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';

import { colors } from '../config/theme';
import MovieList from '../components/MovieList';
import Header from '../components/Header';
import LoadingSpinner from '../components/LoadingSpinner';
import { movieApi } from '../services/api';
import { Movie } from '../types/Movie';

const HomeScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [popularMovies, setPopularMovies] = useState<Movie[]>([]);
  const [trendingMovies, setTrendingMovies] = useState<Movie[]>([]);
  const [recommendations, setRecommendations] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [popular, trending, userRecs] = await Promise.all([
        movieApi.getPopularMovies(),
        movieApi.getTrendingMovies(),
        movieApi.getRecommendations('user123'), // TODO: Get actual user ID
      ]);
      
      setPopularMovies(popular.data.results || []);
      setTrendingMovies(trending.data.results || []);
      setRecommendations(userRecs.data.results || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleMoviePress = (movie: Movie) => {
    navigation.navigate('MovieDetails', { movie });
  };

  const handleSeeAllRecommendations = () => {
    navigation.navigate('Recommendations');
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Header title={t('home.title')} />
      
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Your Recommendations */}
        {recommendations.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {t('home.yourRecommendations')}
              </Text>
              <TouchableOpacity onPress={handleSeeAllRecommendations}>
                <Text style={styles.seeAllText}>See All</Text>
              </TouchableOpacity>
            </View>
            <MovieList
              movies={recommendations.slice(0, 10)}
              onMoviePress={handleMoviePress}
              horizontal
            />
          </View>
        )}

        {/* Trending Now */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('home.trendingNow')}</Text>
          <MovieList
            movies={trendingMovies}
            onMoviePress={handleMoviePress}
            horizontal
          />
        </View>

        {/* Popular Movies */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('home.popularMovies')}</Text>
          <MovieList
            movies={popularMovies}
            onMoviePress={handleMoviePress}
            horizontal
          />
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  seeAllText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default HomeScreen;