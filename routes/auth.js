// routes/auth.js
// Handles staff login. Verifies username/password against the
// users table (bcrypt-hashed), and issues a JWT on success.

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { loginLimiter } = require('../middleware/rate-limit');
const { requireAuth } = require('../middleware/auth');
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

// POST /api/auth/change-password - lets a logged-in staff user change their
// own password. Requires the current password so a stolen-but-still-valid
// JWT alone isn't enough to lock the real owner out.
router.post('/change-password', requireAuth, loginLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, user.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error while changing password.' });
  }
});

module.exports = router;
