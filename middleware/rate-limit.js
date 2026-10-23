// middleware/rate-limit.js
// Rate limiters for public-facing endpoints that would otherwise be open
// to brute-force (login) or spam/flooding (public contact form) attempts.

const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts from this device. Please try again in 15 minutes.' },
});

const contactFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this device. Please try again later.' },
});

module.exports = { loginLimiter, contactFormLimiter };
