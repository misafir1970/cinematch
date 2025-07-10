const tf = require('@tensorflow/tfjs-node');
const path = require('path');
const fs = require('fs').promises;

class MatrixFactorization {
  constructor(options = {}) {
    this.factors = options.factors || 50;
    this.learningRate = options.learningRate || 0.001;
    this.regularization = options.regularization || 1e-6;
    this.epochs = options.epochs || 100;
    this.batchSize = options.batchSize || 32;
    
    this.model = null;
    this.userCount = 0;
    this.movieCount = 0;
    this.userToIndex = new Map();
    this.movieToIndex = new Map();
    this.indexToUser = new Map();
    this.indexToMovie = new Map();
    
    this.modelPath = path.join(__dirname, '../models/matrix_factorization');
  }

  async buildModel(userCount, movieCount, factors = this.factors) {
    try {
      this.userCount = userCount;
      this.movieCount = movieCount;
      
      // User input
      const userInput = tf.input({shape: [1], name: 'user_input'});
      
      // Movie input  
      const movieInput = tf.input({shape: [1], name: 'movie_input'});
      
      // User embedding layer
      const userEmbedding = tf.layers.embedding({
        inputDim: userCount,
        outputDim: factors,
        embeddingsRegularizer: tf.regularizers.l2({l2: this.regularization}),
        name: 'user_embedding'
      }).apply(userInput);
      
      // Movie embedding layer
      const movieEmbedding = tf.layers.embedding({
        inputDim: movieCount,
        outputDim: factors,
        embeddingsRegularizer: tf.regularizers.l2({l2: this.regularization}),
        name: 'movie_embedding'
      }).apply(movieInput);
      
      // Flatten embeddings
      const userFlat = tf.layers.flatten().apply(userEmbedding);
      const movieFlat = tf.layers.flatten().apply(movieEmbedding);
      
      // Dot product layer
      const dot = tf.layers.dot({axes: 1, name: 'dot_product'}).apply([userFlat, movieFlat]);
      
      // Add bias terms
      const userBias = tf.layers.embedding({
        inputDim: userCount,
        outputDim: 1,
        name: 'user_bias'
      }).apply(userInput);
      
      const movieBias = tf.layers.embedding({
        inputDim: movieCount,
        outputDim: 1,
        name: 'movie_bias'
      }).apply(movieInput);
      
      const userBiasFlat = tf.layers.flatten().apply(userBias);
      const movieBiasFlat = tf.layers.flatten().apply(movieBias);
      
      // Combine all components
      const output = tf.layers.add().apply([dot, userBiasFlat, movieBiasFlat]);
      
      // Apply sigmoid to constrain output to [0, 1] range, then scale to [1, 10]
      const scaled = tf.layers.lambda({
        func: (x) => tf.add(tf.mul(tf.sigmoid(x), 9), 1),
        name: 'rating_scale'
      }).apply(output);
      
      this.model = tf.model({
        inputs: [userInput, movieInput],
        outputs: scaled
      });
      
      this.model.compile({
        optimizer: tf.train.adam(this.learningRate),
        loss: 'meanSquaredError',
        metrics: ['mae']
      });
      
      console.log('Matrix factorization model built successfully');
      console.log('Model summary:');
      this.model.summary();
      
      return this.model;
    } catch (error) {
      console.error('Error building model:', error);
      throw error;
    }
  }

  prepareData(ratings) {
    try {
      // Create user and movie mappings
      const users = [...new Set(ratings.map(r => r.userId))];
      const movies = [...new Set(ratings.map(r => r.movieId))];
      
      users.forEach((user, index) => {
        this.userToIndex.set(user, index);
        this.indexToUser.set(index, user);
      });
      
      movies.forEach((movie, index) => {
        this.movieToIndex.set(movie, index);
        this.indexToMovie.set(index, movie);
      });
      
      // Convert ratings to tensors
      const userIndices = ratings.map(r => this.userToIndex.get(r.userId));
      const movieIndices = ratings.map(r => this.movieToIndex.get(r.movieId));
      const ratingValues = ratings.map(r => r.rating);
      
      const userTensor = tf.tensor2d(userIndices, [userIndices.length, 1]);
      const movieTensor = tf.tensor2d(movieIndices, [movieIndices.length, 1]);
      const ratingTensor = tf.tensor2d(ratingValues, [ratingValues.length, 1]);
      
      return {
        userTensor,
        movieTensor,
        ratingTensor,
        userCount: users.length,
        movieCount: movies.length
      };
    } catch (error) {
      console.error('Error preparing data:', error);
      throw error;
    }
  }

  async train(ratings, validationSplit = 0.2) {
    try {
      console.log(`Training on ${ratings.length} ratings...`);
      
      const { userTensor, movieTensor, ratingTensor, userCount, movieCount } = this.prepareData(ratings);
      
      if (!this.model) {
        await this.buildModel(userCount, movieCount);
      }
      
      // Train the model
      const history = await this.model.fit(
        [userTensor, movieTensor],
        ratingTensor,
        {
          epochs: this.epochs,
          batchSize: this.batchSize,
          validationSplit,
          verbose: 1,
          callbacks: {
            onEpochEnd: (epoch, logs) => {
              console.log(`Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(4)}, val_loss = ${logs.val_loss.toFixed(4)}`);
            }
          }
        }
      );
      
      // Clean up tensors
      userTensor.dispose();
      movieTensor.dispose();
      ratingTensor.dispose();
      
      console.log('Training completed successfully');
      return history;
    } catch (error) {
      console.error('Error during training:', error);
      throw error;
    }
  }

  async predict(userId, movieIds) {
    try {
      if (!this.model) {
        throw new Error('Model not trained yet');
      }
      
      const userIndex = this.userToIndex.get(userId);
      if (userIndex === undefined) {
        throw new Error(`User ${userId} not found in training data`);
      }
      
      // Filter out movies not seen during training
      const validMovieIds = movieIds.filter(movieId => this.movieToIndex.has(movieId));
      
      if (validMovieIds.length === 0) {
        return [];
      }
      
      const movieIndices = validMovieIds.map(movieId => this.movieToIndex.get(movieId));
      const userIndices = new Array(validMovieIds.length).fill(userIndex);
      
      const userTensor = tf.tensor2d(userIndices, [userIndices.length, 1]);
      const movieTensor = tf.tensor2d(movieIndices, [movieIndices.length, 1]);
      
      const predictions = await this.model.predict([userTensor, movieTensor]);
      const predictionValues = await predictions.data();
      
      // Clean up
      userTensor.dispose();
      movieTensor.dispose();
      predictions.dispose();
      
      // Return predictions with movie IDs
      return validMovieIds.map((movieId, index) => ({
        movieId,
        score: predictionValues[index]
      }));
      
    } catch (error) {
      console.error('Error during prediction:', error);
      throw error;
    }
  }

  async incrementalUpdate(newRatings) {
    try {
      if (!this.model || newRatings.length === 0) {
        return;
      }
      
      console.log(`Performing incremental update with ${newRatings.length} new ratings...`);
      
      // Filter ratings for known users and movies
      const validRatings = newRatings.filter(r => 
        this.userToIndex.has(r.userId) && this.movieToIndex.has(r.movieId)
      );
      
      if (validRatings.length === 0) {
        console.log('No valid ratings for incremental update');
        return;
      }
      
      const userIndices = validRatings.map(r => this.userToIndex.get(r.userId));
      const movieIndices = validRatings.map(r => this.movieToIndex.get(r.movieId));
      const ratingValues = validRatings.map(r => r.rating);
      
      const userTensor = tf.tensor2d(userIndices, [userIndices.length, 1]);
      const movieTensor = tf.tensor2d(movieIndices, [movieIndices.length, 1]);
      const ratingTensor = tf.tensor2d(ratingValues, [ratingValues.length, 1]);
      
      // Perform one epoch of training
      await this.model.fit(
        [userTensor, movieTensor],
        ratingTensor,
        {
          epochs: 1,
          batchSize: Math.min(this.batchSize, validRatings.length),
          verbose: 0
        }
      );
      
      // Clean up
      userTensor.dispose();
      movieTensor.dispose();
      ratingTensor.dispose();
      
      console.log('Incremental update completed');
    } catch (error) {
      console.error('Error during incremental update:', error);
      throw error;
    }
  }

  async saveModel() {
    try {
      if (!this.model) {
        throw new Error('No model to save');
      }
      
      await this.model.save(`file://${this.modelPath}`);
      
      // Save mappings
      const mappings = {
        userToIndex: Object.fromEntries(this.userToIndex),
        movieToIndex: Object.fromEntries(this.movieToIndex),
        indexToUser: Object.fromEntries(this.indexToUser),
        indexToMovie: Object.fromEntries(this.indexToMovie),
        userCount: this.userCount,
        movieCount: this.movieCount,
        factors: this.factors
      };
      
      await fs.writeFile(
        path.join(this.modelPath, 'mappings.json'),
        JSON.stringify(mappings, null, 2)
      );
      
      console.log('Model saved successfully');
    } catch (error) {
      console.error('Error saving model:', error);
      throw error;
    }
  }

  async loadModel() {
    try {
      // Load the model
      this.model = await tf.loadLayersModel(`file://${this.modelPath}/model.json`);
      
      // Load mappings
      const mappingsData = await fs.readFile(path.join(this.modelPath, 'mappings.json'), 'utf8');
      const mappings = JSON.parse(mappingsData);
      
      this.userToIndex = new Map(Object.entries(mappings.userToIndex));
      this.movieToIndex = new Map(Object.entries(mappings.movieToIndex).map(([k, v]) => [parseInt(k), v]));
      this.indexToUser = new Map(Object.entries(mappings.indexToUser).map(([k, v]) => [parseInt(k), v]));
      this.indexToMovie = new Map(Object.entries(mappings.indexToMovie).map(([k, v]) => [parseInt(k), parseInt(v)]));
      this.userCount = mappings.userCount;
      this.movieCount = mappings.movieCount;
      this.factors = mappings.factors;
      
      console.log('Model loaded successfully');
    } catch (error) {
      console.error('Error loading model:', error);
      throw error;
    }
  }

  getModelInfo() {
    return {
      userCount: this.userCount,
      movieCount: this.movieCount,
      factors: this.factors,
      isLoaded: !!this.model,
      parameters: this.model ? this.model.countParams() : 0
    };
  }
}

module.exports = MatrixFactorization;