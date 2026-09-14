// ============================================================
// MySQL connection pool
// A pool (instead of a single connection) means the API can
// handle many requests at once without waiting on one shared
// connection, and automatically reconnects dropped connections.
// ============================================================
const mysql = require('mysql2');

const useSsl = String(process.env.DB_USE_SSL).toLowerCase() === 'true';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined
});

// Promise-based interface so routes can use async/await instead of callbacks
const db = pool.promise();

// Fail fast with a clear message if the database is unreachable
pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('   Check DB_HOST / DB_USER / DB_PASSWORD / DB_NAME / DB_PORT in your .env file.');
    return;
  }
  console.log(`✅ Connected to MySQL database: ${process.env.DB_NAME}`);
  connection.release();
});

module.exports = db;
