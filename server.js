// server.js
// Main entry point for the SLNA backend API.
// Run with: node server.js   (or: npm run dev  for auto-restart on changes)

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const newsRoutes = require('./routes/news');
const albumRoutes = require('./routes/albums');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/albums', albumRoutes);

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
        error: 'That file is too large. Photos must be under 25MB and documents under 30MB. Please choose a smaller file or compress the photo before uploading.',
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

  // Anything else -- log the technical detail on the server, but keep the
  // message shown to the admin user generic and non-alarming.
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again, or contact your website administrator if the problem continues.' });
});

app.listen(PORT, () => {
  console.log(`\nSLNA backend API running at http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health\n`);
});
