// server.js
// Main entry point for the SLNA backend API.
// Run with: node server.js   (or: npm run dev  for auto-restart on changes)

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const newsRoutes = require('./routes/news');
const albumRoutes = require('./routes/albums');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors()); // allows the frontend (running on a different port/origin) to call this API
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded images/files publicly so <img src="http://localhost:3000/uploads/..."> works
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/albums', albumRoutes);

// Health check endpoint -- useful to confirm the server is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'SLNA backend is running.' });
});

// Catch-all 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// Generic error handler (e.g. Multer file-size/type errors land here)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: err.message || 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`\nSLNA backend API running at http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health\n`);
});
