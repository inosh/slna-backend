// routes/news.js
// CRUD endpoints for news items. Public routes (GET) are open to
// all visitors. Write routes (POST, DELETE) require a valid login.

const express = require('express');
const fs = require('fs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { uploadNewsPhoto, uploadNewsDocument } = require('../middleware/upload');

const router = express.Router();

// GET /api/news - list all news items, newest first (PUBLIC)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM news ORDER BY event_date DESC, created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching news:', err);
    res.status(500).json({ error: 'Failed to fetch news items.' });
  }
});

// GET /api/news/:id - get a single news item by ID (PUBLIC)
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM news WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'News item not found.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching news item:', err);
    res.status(500).json({ error: 'Failed to fetch news item.' });
  }
});

// POST /api/news/typed - create a news item typed directly in the UI (PROTECTED)
router.post('/typed', requireAuth, uploadNewsPhoto.single('photo'), async (req, res) => {
  const { title, event_date, summary, body } = req.body;

  if (!title || !event_date || !body) {
    return res.status(400).json({ error: 'Title, date, and content are required.' });
  }

  const photoUrl = req.file ? `/uploads/news/${req.file.filename}` : null;

  try {
    const result = await pool.query(
      `INSERT INTO news (title, event_date, summary, body, source, photo_url, created_by)
       VALUES ($1, $2, $3, $4, 'typed', $5, $6) RETURNING *`,
      [title, event_date, summary || null, body, photoUrl, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating news item:', err);
    res.status(500).json({ error: 'Failed to create news item.' });
  }
});

// POST /api/news/upload - create a news item from an uploaded document (PROTECTED)
// Accepts a document (.txt/.pdf/.docx) and an optional photo in the same request.
router.post(
  '/upload',
  requireAuth,
  uploadNewsDocument.fields([{ name: 'document', maxCount: 1 }, { name: 'photo', maxCount: 1 }]),
  async (req, res) => {
    const { title, event_date, summary } = req.body;
    const documentFile = req.files && req.files['document'] ? req.files['document'][0] : null;
    const photoFile = req.files && req.files['photo'] ? req.files['photo'][0] : null;

    if (!title || !event_date || !documentFile) {
      return res.status(400).json({ error: 'Title, date, and a document file are required.' });
    }

    let body = req.body.body || '';
    // Auto-extract text content only for .txt files (reliable in Node without extra libraries).
    // For .pdf/.docx, the file is stored as an attachment and the body is whatever was typed manually.
    if (documentFile.mimetype === 'text/plain') {
      try {
        body = fs.readFileSync(documentFile.path, 'utf-8');
      } catch (e) {
        console.warn('Could not read .txt file contents:', e.message);
      }
    }
    if (!body) {
      body = `Attached document: ${documentFile.originalname}`;
    }

    const photoUrl = photoFile ? `/uploads/news/${photoFile.filename}` : null;

    try {
      const result = await pool.query(
        `INSERT INTO news (title, event_date, summary, body, source, file_name, photo_url, created_by)
         VALUES ($1, $2, $3, $4, 'file', $5, $6, $7) RETURNING *`,
        [title, event_date, summary || body.substring(0, 180), body, documentFile.originalname, photoUrl, req.user.id]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('Error creating news item from upload:', err);
      res.status(500).json({ error: 'Failed to create news item.' });
    }
  }
);

// DELETE /api/news/:id - remove a news item (PROTECTED)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM news WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'News item not found.' });
    }
    res.json({ message: 'News item deleted.', deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting news item:', err);
    res.status(500).json({ error: 'Failed to delete news item.' });
  }
});

module.exports = router;
