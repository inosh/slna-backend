// routes/albums.js
// CRUD endpoints for photo albums. Public GET routes for the
// gallery pages; protected POST/DELETE for the admin dashboard.

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { uploadAlbumPhotos } = require('../middleware/upload');

const router = express.Router();

// GET /api/albums - list all albums with their photo count and cover photo (PUBLIC)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id, a.title, a.event_date, a.created_at,
        COUNT(ap.id) AS photo_count,
        (SELECT photo_url FROM album_photos WHERE album_id = a.id ORDER BY display_order ASC LIMIT 1) AS cover_photo
      FROM albums a
      LEFT JOIN album_photos ap ON ap.album_id = a.id
      GROUP BY a.id
      ORDER BY a.event_date DESC, a.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching albums:', err);
    res.status(500).json({ error: 'Failed to fetch albums.' });
  }
});

// GET /api/albums/:id - get one album with all its photos (PUBLIC)
router.get('/:id', async (req, res) => {
  try {
    const albumResult = await pool.query('SELECT * FROM albums WHERE id = $1', [req.params.id]);
    if (albumResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found.' });
    }
    const photosResult = await pool.query(
      'SELECT * FROM album_photos WHERE album_id = $1 ORDER BY display_order ASC, id ASC',
      [req.params.id]
    );
    res.json({ ...albumResult.rows[0], photos: photosResult.rows });
  } catch (err) {
    console.error('Error fetching album:', err);
    res.status(500).json({ error: 'Failed to fetch album.' });
  }
});

// POST /api/albums - create a new album with one or more photos (PROTECTED)
router.post('/', requireAuth, uploadAlbumPhotos.array('photos', 40), async (req, res) => {
  const { title, event_date } = req.body;

  if (!title || !event_date) {
    return res.status(400).json({ error: 'Album title and date are required.' });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'At least one photo is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const albumResult = await client.query(
      'INSERT INTO albums (title, event_date, created_by) VALUES ($1, $2, $3) RETURNING *',
      [title, event_date, req.user.id]
    );
    const album = albumResult.rows[0];

    const photoInsertPromises = req.files.map((file, index) =>
      client.query(
        'INSERT INTO album_photos (album_id, photo_url, display_order) VALUES ($1, $2, $3)',
        [album.id, `/uploads/albums/${file.filename}`, index]
      )
    );
    await Promise.all(photoInsertPromises);

    await client.query('COMMIT');
    res.status(201).json({ ...album, photo_count: req.files.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating album:', err);
    res.status(500).json({ error: 'Failed to create album.' });
  } finally {
    client.release();
  }
});

// DELETE /api/albums/:id - remove an album and all its photos (PROTECTED)
// album_photos rows are removed automatically via ON DELETE CASCADE.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM albums WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found.' });
    }
    res.json({ message: 'Album deleted.', deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting album:', err);
    res.status(500).json({ error: 'Failed to delete album.' });
  }
});

module.exports = router;
