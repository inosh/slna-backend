// routes/auth.js
// Handles staff login. Verifies username/password against the
// users table (bcrypt-hashed), and issues a JWT on success.

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { loginLimiter } = require('../middleware/rate-limit');
require('dotenv').config();

const router = express.Router();

// Basic in-memory lockout on top of the IP-based rate limiter below: this
// one is keyed by username, so repeated failed attempts against a single
// account get locked out even if spread across many IPs.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const failedAttemptsByUsername = new Map();

function isLockedOut(username) {
  const entry = failedAttemptsByUsername.get(username);
  if (!entry || !entry.lockedUntil) return false;
  if (entry.lockedUntil <= Date.now()) {
    failedAttemptsByUsername.delete(username);
    return false;
  }
  return true;
}

function recordFailedAttempt(username) {
  const entry = failedAttemptsByUsername.get(username) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  failedAttemptsByUsername.set(username, entry);
}

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (isLockedOut(username)) {
    return res.status(429).json({
      error: 'Too many failed login attempts for this account. Please try again in 15 minutes.',
    });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) {
      recordFailedAttempt(username);
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      recordFailedAttempt(username);
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    failedAttemptsByUsername.delete(username);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

module.exports = router;
