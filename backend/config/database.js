const { Pool } = require('pg');
require('dotenv').config();


// Determine when to enforce SSL. Neon PostgreSQL always requires SSL even from local environments.
// 1) Any DATABASE_URL that points to *.neon.tech
// 2) Production environment
// 3) Explicit override via PG_FORCE_SSL=true
const isNeon = process.env.DATABASE_URL?.includes('neon.tech');
const forceSSL = process.env.PG_FORCE_SSL === 'true';

const sslConfig = (isNeon || forceSSL || process.env.NODE_ENV === 'production')
  ? { rejectUnauthorized: false, require: true }
  : false;


// PostgreSQL Connection Pool with fallback handling

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
  // Allow overriding pool behaviour through env vars while keeping sensible defaults
  max: parseInt(process.env.PG_POOL_MAX || '20', 10),
  idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '2000', 10),
});

let isDBConnected = false;

// Test database connection with graceful fallback
const testConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Successfully connected to PostgreSQL database');
    client.release();
    isDBConnected = true;
    return true;
  } catch (error) {
    console.warn('⚠️ Database connection failed:', error.message);
    console.log('🔄 Server will continue without database functionality');
    isDBConnected = false;
    return false;
  }
};

// Execute query with error handling and database availability check
const query = async (text, params = []) => {
  if (!isDBConnected) {
    console.warn('Database not available, skipping query:', text.substring(0, 50) + '...');
    return { rows: [], rowCount: 0 };
  }

  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query:', { text: text.substring(0, 50) + '...', duration, rows: result.rowCount });
    }
    
    return result;
  } catch (error) {
    console.error('Database query error:', { text: text.substring(0, 50) + '...', error: error.message });
    // Don't throw error, return empty result instead
    return { rows: [], rowCount: 0 };
  }
};

// Get a client from the pool for transactions
const getClient = async () => {
  if (!isDBConnected) {
    throw new Error('Database not available');
  }
  return await pool.connect();
};

// Graceful shutdown
const shutdown = async () => {
  if (isDBConnected) {
    console.log('Closing database connections...');
    await pool.end();
    console.log('Database connections closed.');
  }
};

module.exports = {
  pool,
  query,
  getClient,
  testConnection,
  shutdown,
  isDBConnected: () => isDBConnected
};