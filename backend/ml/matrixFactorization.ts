import * as tf from '@tensorflow/tfjs-node';

interface TrainingData {
  userIds: number[];
  movieIds: number[];
  ratings: number[];
}

interface PredictionResult {
  movieId: number;
  score: number;
  confidence: number;
}

interface ModelConfig {
  factors: number;
  learningRate: number;
  regularization: number;
  epochs: number;
  batchSize: number;
}

class MatrixFactorization {
  private model: tf.LayersModel | null = null;
  private userCount: number = 0;
  private movieCount: number = 0;
  private config: ModelConfig;
  private isTraining: boolean = false;
  private trainingHistory: any[] = [];

  constructor(config: Partial<ModelConfig> = {}) {
    this.config = {
      factors: config.factors || 50,
      learningRate: config.learningRate || 0.001,
      regularization: config.regularization || 1e-6,
      epochs: config.epochs || 100,
      batchSize: config.batchSize || 1024
    };
  }

  async buildModel(userCount: number, movieCount: number): Promise<void> {
    try {
      this.userCount = userCount;
      this.movieCount = movieCount;

      // User input
      const userInput = tf.input({ shape: [1], name: 'user_input' });
      
      // Movie input
      const movieInput = tf.input({ shape: [1], name: 'movie_input' });

      // User embedding layer
      const userEmbedding = tf.layers.embedding({
        inputDim: userCount,
        outputDim: this.config.factors,
        embeddingsInitializer: 'randomNormal',
        embeddingsRegularizer: tf.regularizers.l2({ l2: this.config.regularization }),
        name: 'user_embedding'
      }).apply(userInput) as tf.SymbolicTensor;

      // Movie embedding layer
      const movieEmbedding = tf.layers.embedding({
        inputDim: movieCount,
        outputDim: this.config.factors,
        embeddingsInitializer: 'randomNormal',
        embeddingsRegularizer: tf.regularizers.l2({ l2: this.config.regularization }),
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

      // Flatten embeddings and biases
      const userEmbFlat = tf.layers.flatten().apply(userEmbedding) as tf.SymbolicTensor;
      const movieEmbFlat = tf.layers.flatten().apply(movieEmbedding) as tf.SymbolicTensor;
      const userBiasFlat = tf.layers.flatten().apply(userBias) as tf.SymbolicTensor;
      const movieBiasFlat = tf.layers.flatten().apply(movieBias) as tf.SymbolicTensor;

      // Dot product of embeddings
      const dotProduct = tf.layers.dot({ axes: 1 }).apply([userEmbFlat, movieEmbFlat]) as tf.SymbolicTensor;

      // Add biases
      const withUserBias = tf.layers.add().apply([dotProduct, userBiasFlat]) as tf.SymbolicTensor;
      const withBothBias = tf.layers.add().apply([withUserBias, movieBiasFlat]) as tf.SymbolicTensor;

      // Global bias
      const globalBias = tf.layers.dense({
        units: 1,
        useBias: true,
        activation: 'linear',
        name: 'global_bias'
      }).apply(tf.layers.dense({ units: 1 }).apply(userInput)) as tf.SymbolicTensor;

      // Final output
      const output = tf.layers.add().apply([withBothBias, globalBias]) as tf.SymbolicTensor;

      // Create model
      this.model = tf.model({
        inputs: [userInput, movieInput],
        outputs: output,
        name: 'matrix_factorization'
      });

      // Compile model
      this.model.compile({
        optimizer: tf.train.adam(this.config.learningRate),
        loss: 'meanSquaredError',
        metrics: ['mae']
      });

      console.log('Matrix Factorization model built successfully');
      console.log('Model summary:');
      this.model.summary();

    } catch (error) {
      console.error('Error building model:', error);
      throw error;
    }
  }

  async trainModel(trainingData: TrainingData): Promise<tf.History> {
    if (!this.model) {
      throw new Error('Model not built. Call buildModel() first.');
    }

    if (this.isTraining) {
      throw new Error('Model is already training');
    }

    try {
      this.isTraining = true;

      // Prepare training data tensors
      const userIds = tf.tensor2d(trainingData.userIds.map(id => [id]), [trainingData.userIds.length, 1]);
      const movieIds = tf.tensor2d(trainingData.movieIds.map(id => [id]), [trainingData.movieIds.length, 1]);
      const ratings = tf.tensor2d(trainingData.ratings.map(rating => [rating]), [trainingData.ratings.length, 1]);

      console.log('Starting model training...');
      console.log(`Training samples: ${trainingData.userIds.length}`);
      console.log(`Epochs: ${this.config.epochs}`);
      console.log(`Batch size: ${this.config.batchSize}`);

      // Train the model
      const history = await this.model.fit([userIds, movieIds], ratings, {
        epochs: this.config.epochs,
        batchSize: this.config.batchSize,
        validationSplit: 0.2,
        shuffle: true,
        verbose: 1,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (logs) {
              console.log(`Epoch ${epoch + 1}: loss = ${logs.loss?.toFixed(4)}, val_loss = ${logs.val_loss?.toFixed(4)}`);
            }
          }
        }
      });

      // Store training history
      this.trainingHistory.push({
        timestamp: new Date(),
        config: this.config,
        history: history.history,
        samples: trainingData.userIds.length
      });

      // Clean up tensors
      userIds.dispose();
      movieIds.dispose();
      ratings.dispose();

      console.log('Model training completed');
      return history;

    } catch (error) {
      console.error('Error training model:', error);
      throw error;
    } finally {
      this.isTraining = false;
    }
  }

  async incrementalTrain(userId: number, movieId: number, rating: number): Promise<void> {
    if (!this.model) {
      throw new Error('Model not built. Call buildModel() first.');
    }

    try {
      // Prepare single sample tensors
      const userIdTensor = tf.tensor2d([[userId]], [1, 1]);
      const movieIdTensor = tf.tensor2d([[movieId]], [1, 1]);
      const ratingTensor = tf.tensor2d([[rating]], [1, 1]);

      // Perform single-step training
      await this.model.fit([userIdTensor, movieIdTensor], ratingTensor, {
        epochs: 1,
        batchSize: 1,
        verbose: 0
      });

      // Clean up tensors
      userIdTensor.dispose();
      movieIdTensor.dispose();
      ratingTensor.dispose();

    } catch (error) {
      console.error('Error in incremental training:', error);
      throw error;
    }
  }

  async predict(userId: number, movieIds: number[]): Promise<PredictionResult[]> {
    if (!this.model) {
      throw new Error('Model not built. Call buildModel() first.');
    }

    try {
      // Prepare input tensors
      const userIds = Array(movieIds.length).fill(userId);
      const userIdTensor = tf.tensor2d(userIds.map(id => [id]), [userIds.length, 1]);
      const movieIdTensor = tf.tensor2d(movieIds.map(id => [id]), [movieIds.length, 1]);

      // Make predictions
      const predictions = this.model.predict([userIdTensor, movieIdTensor]) as tf.Tensor;
      const predictionData = await predictions.data();

      // Calculate confidence scores (simplified)
      const confidenceScores = await this.calculateConfidence(userId, movieIds);

      // Format results
      const results: PredictionResult[] = movieIds.map((movieId, index) => ({
        movieId,
        score: predictionData[index],
        confidence: confidenceScores[index] || 0.5
      }));

      // Clean up tensors
      userIdTensor.dispose();
      movieIdTensor.dispose();
      predictions.dispose();

      return results;

    } catch (error) {
      console.error('Error making predictions:', error);
      throw error;
    }
  }

  async batchPredict(userIds: number[], movieIds: number[]): Promise<Map<number, PredictionResult[]>> {
    if (!this.model) {
      throw new Error('Model not built. Call buildModel() first.');
    }

    if (userIds.length !== movieIds.length) {
      throw new Error('User IDs and Movie IDs arrays must have the same length');
    }

    try {
      // Prepare input tensors
      const userIdTensor = tf.tensor2d(userIds.map(id => [id]), [userIds.length, 1]);
      const movieIdTensor = tf.tensor2d(movieIds.map(id => [id]), [movieIds.length, 1]);

      // Make batch predictions
      const predictions = this.model.predict([userIdTensor, movieIdTensor]) as tf.Tensor;
      const predictionData = await predictions.data();

      // Group results by user
      const resultMap = new Map<number, PredictionResult[]>();
      
      for (let i = 0; i < userIds.length; i++) {
        const userId = userIds[i];
        const movieId = movieIds[i];
        const score = predictionData[i];

        if (!resultMap.has(userId)) {
          resultMap.set(userId, []);
        }

        resultMap.get(userId)!.push({
          movieId,
          score,
          confidence: 0.5 // Simplified confidence
        });
      }

      // Clean up tensors
      userIdTensor.dispose();
      movieIdTensor.dispose();
      predictions.dispose();

      return resultMap;

    } catch (error) {
      console.error('Error in batch prediction:', error);
      throw error;
    }
  }

  private async calculateConfidence(userId: number, movieIds: number[]): Promise<number[]> {
    // Simplified confidence calculation
    // In a real implementation, this could be based on:
    // - Number of ratings by the user
    // - Number of ratings for the movie
    // - Variance in similar users' ratings
    // - Model's prediction uncertainty
    
    return movieIds.map(() => Math.random() * 0.4 + 0.3); // 0.3 to 0.7
  }

  async saveModel(path: string): Promise<void> {
    if (!this.model) {
      throw new Error('Model not built. Call buildModel() first.');
    }

    try {
      await this.model.save(`file://${path}`);
      console.log(`Model saved to ${path}`);
    } catch (error) {
      console.error('Error saving model:', error);
      throw error;
    }
  }

  async loadModel(path: string): Promise<void> {
    try {
      this.model = await tf.loadLayersModel(`file://${path}`);
      console.log(`Model loaded from ${path}`);
    } catch (error) {
      console.error('Error loading model:', error);
      throw error;
    }
  }

  async evaluateModel(testData: TrainingData): Promise<any> {
    if (!this.model) {
      throw new Error('Model not built. Call buildModel() first.');
    }

    try {
      // Prepare test data tensors
      const userIds = tf.tensor2d(testData.userIds.map(id => [id]), [testData.userIds.length, 1]);
      const movieIds = tf.tensor2d(testData.movieIds.map(id => [id]), [testData.movieIds.length, 1]);
      const ratings = tf.tensor2d(testData.ratings.map(rating => [rating]), [testData.ratings.length, 1]);

      // Evaluate model
      const evaluation = await this.model.evaluate([userIds, movieIds], ratings, {
        batchSize: this.config.batchSize
      });

      const loss = Array.isArray(evaluation) ? await evaluation[0].data() : await evaluation.data();
      const mae = Array.isArray(evaluation) && evaluation.length > 1 ? await evaluation[1].data() : null;

      // Clean up tensors
      userIds.dispose();
      movieIds.dispose();
      ratings.dispose();

      if (Array.isArray(evaluation)) {
        evaluation.forEach(tensor => tensor.dispose());
      } else {
        evaluation.dispose();
      }

      return {
        loss: loss[0],
        mae: mae ? mae[0] : null,
        rmse: Math.sqrt(loss[0]),
        samples: testData.userIds.length
      };

    } catch (error) {
      console.error('Error evaluating model:', error);
      throw error;
    }
  }

  getModelInfo(): any {
    return {
      isBuilt: !!this.model,
      isTraining: this.isTraining,
      userCount: this.userCount,
      movieCount: this.movieCount,
      config: this.config,
      trainingHistory: this.trainingHistory.length,
      lastTraining: this.trainingHistory.length > 0 
        ? this.trainingHistory[this.trainingHistory.length - 1].timestamp 
        : null
    };
  }

  dispose(): void {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
  }
}

export { MatrixFactorization, TrainingData, PredictionResult, ModelConfig };