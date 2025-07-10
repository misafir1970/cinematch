import * as tf from '@tensorflow/tfjs-node';
import { UserRating, MLModelConfig } from '@/types';

export class MatrixFactorization {
  private model: tf.LayersModel | null = null;
  private userCount = 0;
  private movieCount = 0;
  private factors = 50;
  private learningRate = 0.001;
  private regularization = 1e-6;
  private userIndexMap = new Map<string, number>();
  private movieIndexMap = new Map<number, number>();
  private isTraining = false;

  constructor(config?: Partial<MLModelConfig>) {
    if (config?.parameters) {
      this.factors = config.parameters.factors || 50;
      this.learningRate = config.parameters.learningRate || 0.001;
      this.regularization = config.parameters.regularization || 1e-6;
    }
  }

  /**
   * Plan 1.2: Matrix Factorization model'ini oluştur
   */
  async buildModel(userCount: number, movieCount: number, factors: number = 50): Promise<void> {
    this.userCount = userCount;
    this.movieCount = movieCount;
    this.factors = factors;

    try {
      // User input layer
      const userInput = tf.input({ shape: [1], name: 'user_input' });
      
      // Movie input layer  
      const movieInput = tf.input({ shape: [1], name: 'movie_input' });

      // User embedding layer
      const userEmbedding = tf.layers.embedding({
        inputDim: userCount,
        outputDim: factors,
        embeddingsInitializer: 'randomNormal',
        embeddingsRegularizer: tf.regularizers.l2({ l2: this.regularization }),
        name: 'user_embedding'
      }).apply(userInput) as tf.SymbolicTensor;

      // Movie embedding layer
      const movieEmbedding = tf.layers.embedding({
        inputDim: movieCount,
        outputDim: factors,
        embeddingsInitializer: 'randomNormal',
        embeddingsRegularizer: tf.regularizers.l2({ l2: this.regularization }),
        name: 'movie_embedding'
      }).apply(movieInput) as tf.SymbolicTensor;

      // User bias
      const userBias = tf.layers.embedding({
        inputDim: userCount,
        outputDim: 1,
        embeddingsInitializer: 'zeros',
        name: 'user_bias'
      }).apply(userInput) as tf.SymbolicTensor;

      // Movie bias
      const movieBias = tf.layers.embedding({
        inputDim: movieCount,
        outputDim: 1,
        embeddingsInitializer: 'zeros',
        name: 'movie_bias'
      }).apply(movieInput) as tf.SymbolicTensor;

      // Flatten embeddings
      const userEmbeddingFlat = tf.layers.flatten().apply(userEmbedding) as tf.SymbolicTensor;
      const movieEmbeddingFlat = tf.layers.flatten().apply(movieEmbedding) as tf.SymbolicTensor;
      const userBiasFlat = tf.layers.flatten().apply(userBias) as tf.SymbolicTensor;
      const movieBiasFlat = tf.layers.flatten().apply(movieBias) as tf.SymbolicTensor;

      // Dot product for interaction
      const dotProduct = tf.layers.dot({ axes: 1 }).apply([
        userEmbeddingFlat, 
        movieEmbeddingFlat
      ]) as tf.SymbolicTensor;

      // Add biases
      const addUserBias = tf.layers.add().apply([dotProduct, userBiasFlat]) as tf.SymbolicTensor;
      const prediction = tf.layers.add().apply([addUserBias, movieBiasFlat]) as tf.SymbolicTensor;

      // Global bias ekle
      const globalBias = tf.layers.dense({
        units: 1,
        useBias: true,
        activation: 'linear',
        name: 'global_bias'
      }).apply(prediction) as tf.SymbolicTensor;

      // Model oluştur
      this.model = tf.model({
        inputs: [userInput, movieInput],
        outputs: globalBias,
        name: 'matrix_factorization'
      });

      // Model'i compile et
      this.model.compile({
        optimizer: tf.train.adam(this.learningRate),
        loss: 'meanSquaredError',
        metrics: ['mae']
      });

      console.log('Matrix Factorization model built successfully');
      console.log('Model summary:');
      this.model.summary();

    } catch (error) {
      console.error('Failed to build Matrix Factorization model:', error);
      throw new Error(`Model building failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Training data'sını hazırla
   */
  private prepareTrainingData(ratings: UserRating[]): {
    userIndices: tf.Tensor,
    movieIndices: tf.Tensor,
    ratingValues: tf.Tensor
  } {
    // User ve movie mapping'lerini oluştur
    const uniqueUsers = [...new Set(ratings.map(r => r.userId))];
    const uniqueMovies = [...new Set(ratings.map(r => r.movieId))];

    uniqueUsers.forEach((userId, index) => {
      this.userIndexMap.set(userId, index);
    });

    uniqueMovies.forEach((movieId, index) => {
      this.movieIndexMap.set(movieId, index);
    });

    // Tensors oluştur
    const userIndices = ratings.map(r => this.userIndexMap.get(r.userId) || 0);
    const movieIndices = ratings.map(r => this.movieIndexMap.get(r.movieId) || 0);
    const ratingValues = ratings.map(r => r.rating);

    return {
      userIndices: tf.tensor2d(userIndices, [userIndices.length, 1]),
      movieIndices: tf.tensor2d(movieIndices, [movieIndices.length, 1]),
      ratingValues: tf.tensor2d(ratingValues, [ratingValues.length, 1])
    };
  }

  /**
   * Model'i train et
   */
  async train(ratings: UserRating[], validationSplit: number = 0.2, epochs: number = 50): Promise<void> {
    if (!this.model) {
      throw new Error('Model not built. Call buildModel() first.');
    }

    if (this.isTraining) {
      throw new Error('Model is already training');
    }

    this.isTraining = true;

    try {
      const { userIndices, movieIndices, ratingValues } = this.prepareTrainingData(ratings);

      console.log(`Training with ${ratings.length} ratings...`);
      console.log(`Users: ${this.userIndexMap.size}, Movies: ${this.movieIndexMap.size}`);

      const history = await this.model.fit(
        [userIndices, movieIndices],
        ratingValues,
        {
          epochs,
          batchSize: 256,
          validationSplit,
          shuffle: true,
          verbose: 1,
          callbacks: {
            onEpochEnd: (epoch, logs) => {
              console.log(`Epoch ${epoch + 1}: loss = ${logs?.loss?.toFixed(4)}, val_loss = ${logs?.val_loss?.toFixed(4)}`);
            }
          }
        }
      );

      console.log('Training completed successfully');
      
      // Memory cleanup
      userIndices.dispose();
      movieIndices.dispose();
      ratingValues.dispose();

    } catch (error) {
      console.error('Training failed:', error);
      throw error;
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Incremental training - planın online learning kısmı
   */
  async incrementalTrain(newRatings: UserRating[], learningRate: number = 0.0001): Promise<void> {
    if (!this.model) {
      throw new Error('Model not built');
    }

    if (this.isTraining) {
      console.warn('Model is already training, skipping incremental update');
      return;
    }

    try {
      // Learning rate'i düşür incremental training için
      this.model.compile({
        optimizer: tf.train.adam(learningRate),
        loss: 'meanSquaredError',
        metrics: ['mae']
      });

      const { userIndices, movieIndices, ratingValues } = this.prepareTrainingData(newRatings);

      // Tek epoch ile hızlı güncelleme
      await this.model.fit(
        [userIndices, movieIndices],
        ratingValues,
        {
          epochs: 1,
          batchSize: 32,
          verbose: 0
        }
      );

      // Memory cleanup
      userIndices.dispose();
      movieIndices.dispose();
      ratingValues.dispose();

      console.log(`Incremental training completed with ${newRatings.length} new ratings`);

    } catch (error) {
      console.error('Incremental training failed:', error);
    }
  }

  /**
   * User için movie prediction'ı yap
   */
  async predict(userId: string, movieId: number): Promise<number> {
    if (!this.model) {
      throw new Error('Model not built');
    }

    const userIndex = this.userIndexMap.get(userId);
    const movieIndex = this.movieIndexMap.get(movieId);

    if (userIndex === undefined || movieIndex === undefined) {
      // Cold start problem - default rating döndür
      return 6.0; // Ortalama rating
    }

    try {
      const userTensor = tf.tensor2d([[userIndex]]);
      const movieTensor = tf.tensor2d([[movieIndex]]);

      const prediction = this.model.predict([userTensor, movieTensor]) as tf.Tensor;
      const rating = await prediction.data();

      // Cleanup
      userTensor.dispose();
      movieTensor.dispose();
      prediction.dispose();

      // Rating'i 1-10 arasında sınırla
      return Math.max(1, Math.min(10, rating[0]));

    } catch (error) {
      console.error('Prediction failed:', error);
      return 6.0; // Fallback rating
    }
  }

  /**
   * Batch prediction için optimize edilmiş versiyon
   */
  async batchPredict(userMoviePairs: Array<{userId: string, movieId: number}>): Promise<number[]> {
    if (!this.model) {
      throw new Error('Model not built');
    }

    const userIndices: number[] = [];
    const movieIndices: number[] = [];

    // Valid pairs'leri filtrele
    const validPairs = userMoviePairs.filter(pair => {
      const userIndex = this.userIndexMap.get(pair.userId);
      const movieIndex = this.movieIndexMap.get(pair.movieId);
      
      if (userIndex !== undefined && movieIndex !== undefined) {
        userIndices.push(userIndex);
        movieIndices.push(movieIndex);
        return true;
      }
      return false;
    });

    if (validPairs.length === 0) {
      return new Array(userMoviePairs.length).fill(6.0);
    }

    try {
      const userTensor = tf.tensor2d(userIndices.map(i => [i]));
      const movieTensor = tf.tensor2d(movieIndices.map(i => [i]));

      const predictions = this.model.predict([userTensor, movieTensor]) as tf.Tensor;
      const ratings = await predictions.data();

      // Cleanup
      userTensor.dispose();
      movieTensor.dispose();
      predictions.dispose();

      // Rating'leri sınırla
      return Array.from(ratings).map(rating => Math.max(1, Math.min(10, rating)));

    } catch (error) {
      console.error('Batch prediction failed:', error);
      return new Array(userMoviePairs.length).fill(6.0);
    }
  }

  /**
   * Model'i kaydet
   */
  async saveModel(path: string): Promise<void> {
    if (!this.model) {
      throw new Error('No model to save');
    }

    try {
      await this.model.save(`file://${path}`);
      
      // Mapping'leri de kaydet
      const mappings = {
        userIndexMap: Array.from(this.userIndexMap.entries()),
        movieIndexMap: Array.from(this.movieIndexMap.entries()),
        userCount: this.userCount,
        movieCount: this.movieCount,
        factors: this.factors
      };

      // Bu kısım file system require ediyor, şu anlık placeholder
      // await fs.writeFile(`${path}/mappings.json`, JSON.stringify(mappings));
      
      console.log(`Model saved to ${path}`);
    } catch (error) {
      console.error('Failed to save model:', error);
      throw error;
    }
  }

  /**
   * Model'i yükle
   */
  async loadModel(path: string): Promise<void> {
    try {
      this.model = await tf.loadLayersModel(`file://${path}/model.json`);
      
      // Mapping'leri yükle
      // const mappings = JSON.parse(await fs.readFile(`${path}/mappings.json`, 'utf-8'));
      // Bu kısım şu anlık placeholder
      
      console.log(`Model loaded from ${path}`);
    } catch (error) {
      console.error('Failed to load model:', error);
      throw error;
    }
  }

  /**
   * Model durumunu getir
   */
  getModelInfo(): {
    isBuilt: boolean;
    isTraining: boolean;
    userCount: number;
    movieCount: number;
    factors: number;
  } {
    return {
      isBuilt: this.model !== null,
      isTraining: this.isTraining,
      userCount: this.userCount,
      movieCount: this.movieCount,
      factors: this.factors
    };
  }

  /**
   * Memory cleanup
   */
  dispose(): void {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.userIndexMap.clear();
    this.movieIndexMap.clear();
  }
}