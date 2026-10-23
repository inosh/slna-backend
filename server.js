// server.js
// Main entry point for the SLNA backend API.
// Run with: node server.js   (or: npm run dev  for auto-restart on changes)

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
require('dotenv').config();

const { publicUrlForKey } = require('./lib/r2');

const authRoutes = require('./routes/auth');
const newsRoutes = require('./routes/news');
const albumRoutes = require('./routes/albums');
const membershipApplicationsRoutes = require(
    './routes/membership-applications'
);
const eventsRoutes = require('./routes/events');
const eventRegistrationsRoutes = require('./routes/event-registrations');
const contactQueriesRoutes = require('./routes/contact-queries');
const membershipFeesRoutes = require('./routes/membership-fees');
const executiveCommitteeRoutes = require('./routes/executive-committee');
const subCommitteesRoutes = require('./routes/sub-committees');
const legacyMembersRoutes = require('./routes/legacy-members');
const memberDirectoryRoutes = require('./routes/member-directory');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
// crossOriginResourcePolicy is relaxed to "cross-origin" because the
// /uploads/* route below redirects to images on R2, which the frontend
// (a different origin) needs to be able to load.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Only the configured production frontend origin(s) -- plus localhost, for
// local development -- may call this API from a browser. CORS_ORIGIN can be
// a comma-separated list; it falls back to SITE_URL so existing deployments
// keep working without extra config.
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.SITE_URL || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Requests with no Origin header (server-to-server calls, curl, Postman)
    // aren't subject to the browser's CORS check, so let them through.
    if (!origin) return callback(null, true);

    const normalized = origin.replace(/\/+$/, '');
    if (allowedOrigins.includes(normalized) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Public files now live in the R2 public bucket. Old/existing links still
// point at /uploads/<key> (e.g. /uploads/albums/123.jpg, built from DB
// values that were never rewritten), so redirect those straight to R2
// instead of serving from local disk.
app.get('/uploads/*', (req, res) => {
  const key = req.path.replace(/^\/uploads\//, '');
  res.redirect(302, publicUrlForKey(key));
});

// --- Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/albums', albumRoutes);
app.use(
    '/api/membership',
    membershipApplicationsRoutes
);
app.use('/api/events', eventsRoutes);
app.use('/api/event-registrations', eventRegistrationsRoutes);
app.use('/api/contact-queries', contactQueriesRoutes);
app.use('/api/membership-fees', membershipFeesRoutes);
app.use('/api/executive-committee', executiveCommitteeRoutes);
app.use('/api/sub-committees', subCommitteesRoutes);
app.use('/api/legacy-members', legacyMembersRoutes);
app.use('/api/member-directory', memberDirectoryRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'SLNA backend is running.' });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// ============================================================
// UPDATED ERROR HANDLER
// Gives clear, human-readable messages for common upload
// problems instead of raw technical error text.
// ============================================================
app.use((err, req, res, next) => {
  // Multer-specific errors (file size, unexpected field, etc.)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'That file is too large. Photos must be under 15MB, videos under 100MB, and documents under 30MB. Please choose a smaller file or compress it before uploading.',
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Too many files selected, or an unexpected file field was used. Please try uploading again.',
      });
    }
    return res.status(400).json({ error: 'File upload error: ' + err.message });
  }

  // Errors thrown manually from our fileFilter functions (wrong file type)
  if (err.message && (err.message.includes('are allowed') || err.message.includes('file type'))) {
    return res.status(400).json({ error: err.message });
  }

  // Anything else isn't an upload problem -- hand it to the generic error
  // handler below, which knows how to respect error.statusCode (e.g. the
  // 400s thrown by validationError() across the admin routes) instead of
  // flattening every error into an opaque 500.
  return next(err);
});

app.use(function (error, req, res, next) {
  console.error('Unhandled API error:', error);

  if (res.headersSent) {
    return next(error);
  }

  const statusCode = error.statusCode || 500;

  return res.status(statusCode).json({
    success: false,
    error:
        statusCode >= 500
            ? 'The server could not complete this request. Please try again or contact the system administrator.'
            : error.message,
    message:
        statusCode >= 500
            ? 'The server could not complete this request. Please try again or contact the system administrator.'
            : error.message,
    details: error.details || undefined
  });
});

app.listen(PORT, () => {
  console.log(`\nSLNA backend API running at http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health\n`);
});
