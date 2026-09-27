// db/pool.js
// Sets up a shared PostgreSQL connection pool for the whole app.
// Reads connection details from environment variables (.env file).

const { Pool, types } = require('pg');
require('dotenv').config();

// By default node-postgres turns SQL "date" columns into JS Date objects,
// which get built using the server's local timezone and then serialized
// back out as UTC ISO timestamps -- shifting the date by a day whenever
// the local timezone (IST, UTC+5:30) rolls the UTC value to the previous
// day. Our "date" columns (event_date, date_of_birth, etc.) never carry a
// time of day, so return them as the plain "YYYY-MM-DD" string Postgres
// already gives us instead of round-tripping through Date at all.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'slna_db',
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

module.exports = pool;
