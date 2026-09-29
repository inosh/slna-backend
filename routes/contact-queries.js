// routes/contact-queries.js
// Handles submissions from the Contact SLNA form. Anyone can submit a
// query (PUBLIC); only logged-in admins can list, review, or remove them.

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const SUBJECTS = new Set(['general', 'feedback', 'membership', 'events', 'other']);
const STATUSES = new Set(['new', 'read']);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateQueryInput(body) {
  const required = ['fullName', 'email', 'mobileNumber', 'subject', 'message'];

  for (const field of required) {
    if (!String(body[field] || '').trim()) {
      return { error: field + ' is required.' };
    }
  }

  if (!EMAIL_PATTERN.test(String(body.email).trim())) {
    return { error: 'Please provide a valid email address.' };
  }

  if (!SUBJECTS.has(body.subject)) {
    return { error: 'Please select a valid subject.' };
  }

  return {};
}

// POST /api/contact-queries - submit a contact/inquiry/feedback message (PUBLIC)
router.post('/', async (req, res) => {
  const validation = validateQueryInput(req.body);

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const result = await pool.query(
      `INSERT INTO contact_queries (full_name, email, mobile_number, subject, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        String(req.body.fullName).trim(),
        String(req.body.email).trim(),
        String(req.body.mobileNumber).trim(),
        req.body.subject,
        String(req.body.message).trim()
      ]
    );

    res.status(201).json({
      message: 'Your message has been sent. The Secretariat will respond as soon as possible.',
      query: result.rows[0]
    });
  } catch (err) {
    console.error('Error saving contact query:', err);
    res.status(500).json({ error: 'Could not submit your message. Please try again.' });
  }
});

// GET /api/contact-queries - list all submitted queries, newest first (ADMIN)
router.get('/', requireAuth, async (req, res) => {
  try {
    const status = req.query.status;
    const conditions = [];
    const values = [];

    if (status && STATUSES.has(status)) {
      values.push(status);
      conditions.push('status = $' + values.length);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await pool.query(
      `SELECT * FROM contact_queries ${where} ORDER BY created_at DESC`,
      values
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching contact queries:', err);
    res.status(500).json({ error: 'Failed to fetch contact queries.' });
  }
});

// PATCH /api/contact-queries/:id/status - mark a query as new/read (ADMIN)
router.patch('/:id/status', requireAuth, async (req, res) => {
  const status = String(req.body.status || '').trim();

  if (!STATUSES.has(status)) {
    return res.status(400).json({ error: 'status must be "new" or "read".' });
  }

  try {
    const result = await pool.query(
      `UPDATE contact_queries
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Query not found.' });
    }

    res.json({ message: 'Status updated.', query: result.rows[0] });
  } catch (err) {
    console.error('Error updating contact query status:', err);
    res.status(500).json({ error: 'Failed to update the query status.' });
  }
});

// DELETE /api/contact-queries/:id - remove a query (ADMIN)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM contact_queries WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Query not found.' });
    }

    res.json({ message: 'Query deleted.', deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting contact query:', err);
    res.status(500).json({ error: 'Failed to delete the query.' });
  }
});

module.exports = router;
