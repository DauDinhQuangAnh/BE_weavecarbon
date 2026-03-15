const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection FAILED:');
    console.error('   Error:', err.message);
    console.error('   Config:', {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'weavecarbon',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD ? '***' : 'NOT SET'
    });
    process.exit(-1);
  } else {
    console.log('✅ Database connected successfully');
    console.log('   Host:', process.env.DB_HOST || 'localhost');
    console.log('   Port:', process.env.DB_PORT || 5432);
    console.log('   Database:', process.env.DB_NAME || 'weavecarbon');
    console.log('   User:', process.env.DB_USER || 'postgres');
    release();
  }
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
  process.exit(-1);
});

module.exports = pool;
