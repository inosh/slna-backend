// routes/albums.js
// CRUD endpoints for photo albums. Public GET routes for the
// gallery pages; protected POST/DELETE for the admin dashboard.

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { uploadAlbumPhotos } = require('../middleware/upload');
const { deletePublicObject } = require('../lib/r2');

const router = express.Router();

// GET /api/albums - list all albums with their photo count and cover photo (PUBLIC)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id, a.title, a.event_date, a.created_at,
        COUNT(ap.id) AS photo_count,
        (SELECT photo_url FROM album_photos WHERE album_id = a.id ORDER BY display_order ASC LIMIT 1) AS cover_photo,
        (SELECT media_type FROM album_photos WHERE album_id = a.id ORDER BY display_order ASC LIMIT 1) AS cover_media_type
      FROM albums a
      LEFT JOIN album_photos ap ON ap.album_id = a.id
      GROUP BY a.id
      ORDER BY a.event_date DESC, a.created_at DESC
    `);

    // ?include=photos adds each album's photos and videos, for the
    // gallery's "All" view (one request instead of one per album).
    if (req.query.include === 'photos' && result.rows.length) {
      const photos = await pool.query(
        'SELECT id, album_id, photo_url, media_type, display_order FROM album_photos ORDER BY album_id, display_order ASC, id ASC'
      );
      const byAlbum = {};
      photos.rows.forEach((photo) => {
        (byAlbum[photo.album_id] = byAlbum[photo.album_id] || []).push(photo);
      });
      result.rows.forEach((album) => { album.photos = byAlbum[album.id] || []; });
    }

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
        'INSERT INTO album_photos (album_id, photo_url, media_type, display_order) VALUES ($1, $2, $3, $4)',
        [album.id, `/uploads/${file.key}`, file.mimetype.startsWith('video/') ? 'video' : 'image', index]
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

// PATCH /api/albums/:id - rename an album's title only (PROTECTED)
router.patch('/:id', requireAuth, async (req, res) => {
  const title = String(req.body.title || '').trim();

  if (!title) {
    return res.status(400).json({ error: 'Album title is required.' });
  }

  try {
    const result = await pool.query(
      'UPDATE albums SET title = $1 WHERE id = $2 RETURNING *',
      [title, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found.' });
    }

    res.json({ message: 'Album updated.', album: result.rows[0] });
  } catch (err) {
    console.error('Error updating album:', err);
    res.status(500).json({ error: 'Failed to update album.' });
  }
});

// POST /api/albums/:id/photos - add photos/videos to an existing album (PROTECTED)
// New items go after the existing ones, in the order they were selected.
router.post('/:id/photos', requireAuth, uploadAlbumPhotos.array('photos', 40), async (req, res) => {
  const files = req.files || [];
  const discardFiles = () => Promise.all(files.map((file) =>
    deletePublicObject(file.key).catch(() => {})
  ));

  try {
    const album = await pool.query('SELECT id FROM albums WHERE id = $1', [req.params.id]);
    if (album.rows.length === 0) {
      await discardFiles();
      return res.status(404).json({ error: 'Album not found.' });
    }
    if (files.length === 0) {
      return res.status(400).json({ error: 'Please choose at least one photo or video.' });
    }

    const { rows: [{ max }] } = await pool.query(
      'SELECT COALESCE(MAX(display_order), -1) AS max FROM album_photos WHERE album_id = $1',
      [req.params.id]
    );

    const inserted = [];
    for (const [index, file] of files.entries()) {
      const row = await pool.query(
        'INSERT INTO album_photos (album_id, photo_url, media_type, display_order) VALUES ($1, $2, $3, $4) RETURNING *',
        [req.params.id, `/uploads/${file.key}`, file.mimetype.startsWith('video/') ? 'video' : 'image', Number(max) + 1 + index]
      );
      inserted.push(row.rows[0]);
    }

    res.status(201).json({ message: 'Added to album.', photos: inserted });
  } catch (err) {
    await discardFiles();
    console.error('Error adding album photos:', err);
    res.status(500).json({ error: 'Failed to add photos to the album.' });
  }
});

// DELETE /api/albums/photos/:photoId - remove one photo/video from an album (PROTECTED)
router.delete('/photos/:photoId', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM album_photos WHERE id = $1 RETURNING *',
      [req.params.photoId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photo not found.' });
    }

    const key = result.rows[0].photo_url.replace(/^\/uploads\//, '');
    deletePublicObject(key).catch((deleteErr) => {
      console.error('Could not delete R2 object for album photo:', key, deleteErr.message);
    });

    res.json({ message: 'Photo deleted.', deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting album photo:', err);
    res.status(500).json({ error: 'Failed to delete the photo.' });
  }
});

// DELETE /api/albums/:id - remove an album and all its photos (PROTECTED)
// album_photos rows are removed automatically via ON DELETE CASCADE; the
// underlying R2 objects are not, so they're cleaned up explicitly here.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const photosResult = await pool.query(
      'SELECT photo_url FROM album_photos WHERE album_id = $1',
      [req.params.id]
    );

    const result = await pool.query('DELETE FROM albums WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found.' });
    }

    await Promise.all(photosResult.rows.map((row) => {
      const key = row.photo_url.replace(/^\/uploads\//, '');
      return deletePublicObject(key).catch((deleteErr) => {
        console.error('Could not delete R2 object for album photo:', key, deleteErr.message);
      });
    }));

    res.json({ message: 'Album deleted.', deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting album:', err);
    res.status(500).json({ error: 'Failed to delete album.' });
  }
});

module.exports = router;
