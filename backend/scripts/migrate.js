const { query, testConnection } = require('../config/database');

const migrations = [
  {
    name: 'create_users_table',
    query: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        is_verified BOOLEAN DEFAULT false,
        verification_token VARCHAR(255),
        reset_token VARCHAR(255),
        reset_token_expires TIMESTAMP,
        last_login TIMESTAMP,
        login_attempts INTEGER DEFAULT 0,
        locked_until TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    name: 'create_user_profiles_table',
    query: `
      CREATE TABLE IF NOT EXISTS user_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        preferences JSONB DEFAULT '{}',
        settings JSONB DEFAULT '{}',
        favorite_genres TEXT[] DEFAULT '{}',
        watch_providers TEXT[] DEFAULT '{}',
        language_preferences TEXT[] DEFAULT '{"en"}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      );
    `
  },
  {
    name: 'create_user_ratings_table',
    query: `
      CREATE TABLE IF NOT EXISTS user_ratings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        movie_id INTEGER NOT NULL,
        movie_title VARCHAR(500),
        movie_poster_path VARCHAR(500),
        movie_release_date DATE,
        movie_genres TEXT[] DEFAULT '{}',
        rating DECIMAL(2,1) NOT NULL CHECK (rating >= 0 AND rating <= 10),
        review_text TEXT,
        is_favorite BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, movie_id)
      );
    `
  },
  {
    name: 'create_user_watchlist_table',
    query: `
      CREATE TABLE IF NOT EXISTS user_watchlist (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        movie_id INTEGER NOT NULL,
        movie_title VARCHAR(500),
        movie_poster_path VARCHAR(500),
        movie_release_date DATE,
        movie_genres TEXT[] DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'to_watch' CHECK (status IN ('to_watch', 'watched', 'skipped', 'favorite')),
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        watched_at TIMESTAMP,
        notes TEXT,
        UNIQUE(user_id, movie_id)
      );
    `
  },
  {
    name: 'create_user_actions_table',
    query: `
      CREATE TABLE IF NOT EXISTS user_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action_type VARCHAR(50) NOT NULL,
        movie_id INTEGER,
        movie_title VARCHAR(500),
        value DECIMAL,
        metadata JSONB DEFAULT '{}',
        session_id VARCHAR(255),
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    name: 'create_recommendation_cache_table',
    query: `
      CREATE TABLE IF NOT EXISTS recommendation_cache (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recommendations JSONB NOT NULL,
        algorithm_version VARCHAR(20) DEFAULT '1.0',
        cache_key VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, cache_key)
      );
    `
  },
  {
    name: 'create_user_sessions_table',
    query: `
      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token VARCHAR(500) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        device_info JSONB DEFAULT '{}',
        ip_address INET,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    name: 'create_indexes',
    query: `
      -- Performance indexes
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token);
      CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token);
      
      CREATE INDEX IF NOT EXISTS idx_user_ratings_user_id ON user_ratings(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_ratings_movie_id ON user_ratings(movie_id);
      CREATE INDEX IF NOT EXISTS idx_user_ratings_rating ON user_ratings(rating);
      CREATE INDEX IF NOT EXISTS idx_user_ratings_created_at ON user_ratings(created_at);
      
      CREATE INDEX IF NOT EXISTS idx_user_watchlist_user_id ON user_watchlist(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_watchlist_movie_id ON user_watchlist(movie_id);
      CREATE INDEX IF NOT EXISTS idx_user_watchlist_status ON user_watchlist(status);
      
      CREATE INDEX IF NOT EXISTS idx_user_actions_user_id ON user_actions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_actions_movie_id ON user_actions(movie_id);
      CREATE INDEX IF NOT EXISTS idx_user_actions_type ON user_actions(action_type);
      CREATE INDEX IF NOT EXISTS idx_user_actions_created_at ON user_actions(created_at);
      
      CREATE INDEX IF NOT EXISTS idx_recommendation_cache_user_id ON recommendation_cache(user_id);
      CREATE INDEX IF NOT EXISTS idx_recommendation_cache_expires ON recommendation_cache(expires_at);
      
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(refresh_token);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
    `
  },
  {
    name: 'alter_user_ratings_rating_scale',
    query: `
      ALTER TABLE IF EXISTS user_ratings
      ALTER COLUMN rating TYPE DECIMAL(3,1);
    `
  }
];

const runMigrations = async () => {
  console.log('🚀 Starting database migrations...');
  
  // Test connection first
  const isConnected = await testConnection();
  if (!isConnected) {
    console.error('❌ Cannot connect to database. Aborting migrations.');
    process.exit(1);
  }

  try {
    // Create migrations tracking table
    await query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Get already executed migrations
    const { rows: executedMigrations } = await query('SELECT name FROM migrations');
    const executedNames = executedMigrations.map(row => row.name);

    let migrationsRun = 0;

    for (const migration of migrations) {
      if (executedNames.includes(migration.name)) {
        console.log(`⏭️  Skipping migration: ${migration.name} (already executed)`);
        continue;
      }

      console.log(`🔄 Running migration: ${migration.name}`);
      
      try {
        await query(migration.query);
        await query('INSERT INTO migrations (name) VALUES ($1)', [migration.name]);
        console.log(`✅ Migration completed: ${migration.name}`);
        migrationsRun++;
      } catch (error) {
        console.error(`❌ Migration failed: ${migration.name}`, error.message);
        throw error;
      }
    }

    console.log(`🎉 Migrations completed! ${migrationsRun} new migrations executed.`);
    
    // Show tables summary
    const { rows: tables } = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log('\n📊 Database tables:');
    tables.forEach(table => {
      console.log(`   - ${table.table_name}`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
};

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migration process completed.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration process failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigrations };