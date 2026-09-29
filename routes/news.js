// routes/news.js
// CRUD endpoints for news items. Public routes (GET) are open to
// all visitors. Write routes (POST, DELETE) require a valid login.

const express = require('express');
const fs = require('fs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { uploadNewsPhoto, uploadNewsDocument } = require('../middleware/upload');

const router = express.Router();

// Allowed values for news.news_type -- kept in sync with the CHECK constraint
// added by db/migrate-news-type-album.js.
const NEWS_TYPES = [
  'International Nurses Day',
  'Annual General Meeting',
  'General Meeting',
  'CPD Event',
  'General News',
];

// Creates an album from gallery photos uploaded alongside a news item, using
// the news title/date as the album title/date, and returns the new album id.
// Must run inside the same transaction as the news insert. Returns null when
// no gallery photos were uploaded (news items don't require a gallery).
async function createAlbumForNews(client, { title, event_date, files, createdBy }) {
  if (!files || files.length === 0) return null;

  const albumResult = await client.query(
    'INSERT INTO albums (title, event_date, created_by) VALUES ($1, $2, $3) RETURNING id',
    [title, event_date, createdBy]
  );
  const albumId = albumResult.rows[0].id;

  await Promise.all(files.map((file, index) =>
    client.query(
      'INSERT INTO album_photos (album_id, photo_url, display_order) VALUES ($1, $2, $3)',
      [albumId, `/uploads/news/${file.filename}`, index]
    )
  ));

  return albumId;
}

// Replaces an existing album's photos entirely (delete + re-insert) and
// refreshes its title/date to match the news item it's linked to. Used when
// an admin edits a news item and chooses to override the album -- the admin
// must re-upload every photo, since this does not merge with what's there.
// Must run inside the same transaction as the news update.
async function replaceAlbumPhotos(client, albumId, { title, event_date, files }) {
  await client.query('DELETE FROM album_photos WHERE album_id = $1', [albumId]);
  await client.query(
    'UPDATE albums SET title = $1, event_date = $2 WHERE id = $3',
    [title, event_date, albumId]
  );

  await Promise.all(files.map((file, index) =>
    client.query(
      'INSERT INTO album_photos (album_id, photo_url, display_order) VALUES ($1, $2, $3)',
      [albumId, `/uploads/news/${file.filename}`, index]
    )
  ));
}

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

// GET /api/news/:id - get a single news item by ID, including its linked
// photo album (if any), for the news detail page gallery (PUBLIC)
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM news WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'News item not found.' });
    }
    const newsItem = result.rows[0];
    if (newsItem.album_id) {
      const photosResult = await pool.query(
        'SELECT * FROM album_photos WHERE album_id = $1 ORDER BY display_order ASC, id ASC',
        [newsItem.album_id]
      );
      newsItem.photos = photosResult.rows;
    }
    res.json(newsItem);
  } catch (err) {
    console.error('Error fetching news item:', err);
    res.status(500).json({ error: 'Failed to fetch news item.' });
  }
});

// POST /api/news/typed - create a news item typed directly in the UI (PROTECTED)
// "photo" is the single cover photo; "photos" (optional, multiple) becomes a
// linked photo album, titled/dated after this news item.
router.post(
  '/typed',
  requireAuth,
  uploadNewsPhoto.fields([{ name: 'photo', maxCount: 1 }, { name: 'photos', maxCount: 30 }]),
  async (req, res) => {
    const { title, event_date, summary, body, news_type } = req.body;

    if (!title || !event_date || !body || !news_type) {
      return res.status(400).json({ error: 'Title, date, type, and content are required.' });
    }
    if (!NEWS_TYPES.includes(news_type)) {
      return res.status(400).json({ error: 'Invalid news type.' });
    }

    const coverFile = req.files && req.files['photo'] ? req.files['photo'][0] : null;
    const galleryFiles = req.files && req.files['photos'] ? req.files['photos'] : [];
    const photoUrl = coverFile ? `/uploads/news/${coverFile.filename}` : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const albumId = await createAlbumForNews(client, {
        title, event_date, files: galleryFiles, createdBy: req.user.id,
      });

      const result = await client.query(
        `INSERT INTO news (title, event_date, summary, body, source, photo_url, news_type, album_id, created_by)
         VALUES ($1, $2, $3, $4, 'typed', $5, $6, $7, $8) RETURNING *`,
        [title, event_date, summary || null, body, photoUrl, news_type, albumId, req.user.id]
      );

      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error creating news item:', err);
      res.status(500).json({ error: 'Failed to create news item.' });
    } finally {
      client.release();
    }
  }
);

// POST /api/news/upload - create a news item from an uploaded document (PROTECTED)
// Accepts a document (.txt/.pdf/.docx), an optional cover photo, and optional
// gallery photos (become a linked album) in the same request.
router.post(
  '/upload',
  requireAuth,
  uploadNewsDocument.fields([
    { name: 'document', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'photos', maxCount: 30 },
  ]),
  async (req, res) => {
    const { title, event_date, summary, news_type } = req.body;
    const documentFile = req.files && req.files['document'] ? req.files['document'][0] : null;
    const photoFile = req.files && req.files['photo'] ? req.files['photo'][0] : null;
    const galleryFiles = req.files && req.files['photos'] ? req.files['photos'] : [];

    if (!title || !event_date || !documentFile || !news_type) {
      return res.status(400).json({ error: 'Title, date, type, and a document file are required.' });
    }
    if (!NEWS_TYPES.includes(news_type)) {
      return res.status(400).json({ error: 'Invalid news type.' });
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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const albumId = await createAlbumForNews(client, {
        title, event_date, files: galleryFiles, createdBy: req.user.id,
      });

      const result = await client.query(
        `INSERT INTO news (title, event_date, summary, body, source, file_name, photo_url, news_type, album_id, created_by)
         VALUES ($1, $2, $3, $4, 'file', $5, $6, $7, $8, $9) RETURNING *`,
        [title, event_date, summary || body.substring(0, 180), body, documentFile.originalname, photoUrl, news_type, albumId, req.user.id]
      );

      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error creating news item from upload:', err);
      res.status(500).json({ error: 'Failed to create news item.' });
    } finally {
      client.release();
    }
  }
);

// PUT /api/news/:id - update a news item's fields (PROTECTED)
// Cover photo ("photo") is replaced only if a new file is sent, otherwise the
// existing one is kept. The linked album is left untouched unless
// "override_album" is 'true', in which case its photos are replaced entirely
// with whatever is sent in "photos" (the admin must re-upload every photo --
// this does not merge with the album's existing contents). If the news item
// has no album yet and override_album is 'true' with photos attached, a new
// album is created, same as on initial publish.
router.put(
  '/:id',
  requireAuth,
  uploadNewsPhoto.fields([{ name: 'photo', maxCount: 1 }, { name: 'photos', maxCount: 30 }]),
  async (req, res) => {
    const { title, event_date, summary, body, news_type } = req.body;
    const overrideAlbum = req.body.override_album === 'true';

    if (!title || !event_date || !body || !news_type) {
      return res.status(400).json({ error: 'Title, date, type, and content are required.' });
    }
    if (!NEWS_TYPES.includes(news_type)) {
      return res.status(400).json({ error: 'Invalid news type.' });
    }

    const coverFile = req.files && req.files['photo'] ? req.files['photo'][0] : null;
    const galleryFiles = req.files && req.files['photos'] ? req.files['photos'] : [];

    if (overrideAlbum && galleryFiles.length === 0) {
      return res.status(400).json({
        error: 'Please upload the album photos again -- all photos must be re-uploaded when replacing an album.',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingResult = await client.query(
        'SELECT * FROM news WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (existingResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'News item not found.' });
      }
      const existing = existingResult.rows[0];

      const photoUrl = coverFile ? `/uploads/news/${coverFile.filename}` : existing.photo_url;

      let albumId = existing.album_id;
      if (overrideAlbum) {
        if (albumId) {
          await replaceAlbumPhotos(client, albumId, { title, event_date, files: galleryFiles });
        } else {
          albumId = await createAlbumForNews(client, {
            title, event_date, files: galleryFiles, createdBy: req.user.id,
          });
        }
      }

      const result = await client.query(
        `UPDATE news
         SET title = $1, event_date = $2, summary = $3, body = $4, news_type = $5,
             photo_url = $6, album_id = $7, updated_at = NOW()
         WHERE id = $8
         RETURNING *`,
        [title, event_date, summary || null, body, news_type, photoUrl, albumId, req.params.id]
      );

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error updating news item:', err);
      res.status(500).json({ error: 'Failed to update news item.' });
    } finally {
      client.release();
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
