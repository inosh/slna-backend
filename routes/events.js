// routes/events.js
const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { uploadEventPhoto } = require('../middleware/upload');

const CPD_EVENT_TYPES = new Set([
  'Workshop',
  'Training',
  'Webinar',
  'Seminar',
  'Study Day',
  'Conference',
  'Other'
]);

const OTHER_EVENT_TYPES = new Set([
  'Annual Conference',
  'International Nurses Day',
  'General Meeting',
  'Annual General Meeting',
  'Other Event'
]);

const CPD_EVENT_STATUSES = new Set([
  'Registration Open',
  'Registration Opening Soon',
  'Programme Announced Soon',
  'Closed'
]);

const OTHER_EVENT_STATUSES = new Set([
  'Upcoming',
  'Registration Open',
  'Announcement Soon',
  'Completed'
]);

function eventRules(category) {
  return category === 'cpd'
    ? { types: CPD_EVENT_TYPES, statuses: CPD_EVENT_STATUSES }
    : { types: OTHER_EVENT_TYPES, statuses: OTHER_EVENT_STATUSES };
}

function normaliseEvent(row) {
  if (!row) return null;

  return {
    id: row.id,
    category: row.category,
    type: row.event_type,
    title: row.title,
    event_date: row.event_date,
    time: row.time,
    location: row.location,
    summary: row.summary,
    status: row.status,
    photo_url: row.photo_url,
    photo_filename: row.photo_filename,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function validateEventInput(category, body) {
  const rules = eventRules(category);
  const required = [
    'title',
    'type',
    'event_date',
    'time',
    'location',
    'summary',
    'status'
  ];

  for (const field of required) {
    if (!String(body[field] || '').trim()) {
      return field + ' is required.';
    }
  }

  if (!rules.types.has(body.type)) {
    return 'Invalid event type for this event category.';
  }

  if (!rules.statuses.has(body.status)) {
    return 'Invalid status for this event category.';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.event_date)) {
    return 'Date must use YYYY-MM-DD format.';
  }

  return null;
}

function eventUploadUrl(file) {
  return file ? '/uploads/events/' + file.filename : null;
}

function createEventRoutes(category) {
  const basePath = category === 'cpd' ? '/cpd' : '/other';

  // Create event with optional photo
  router.post(
    basePath,
    requireAuth,
    uploadEventPhoto.single('photo'),
    async function (req, res) {
      const validationError = validateEventInput(category, req.body);

      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const sql = `
        INSERT INTO events (
          category,
          event_type,
          title,
          event_date,
          time,
          location,
          summary,
          status,
          photo_url,
          photo_filename,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING *
      `;

      const values = [
        category,
        req.body.type.trim(),
        req.body.title.trim(),
        req.body.event_date,
        req.body.time.trim(),
        req.body.location.trim(),
        req.body.summary.trim(),
        req.body.status.trim(),
        eventUploadUrl(req.file),
        req.file ? req.file.originalname : null
      ];

      try {
        const result = await db.query(sql, values);
        const row = result.rows[0];

        return res.status(201).json({
          message: 'Event created.',
          event: normaliseEvent(row)
        });
      } catch (error) {
        console.error('Could not create event:', error);
        return res.status(500).json({ error: 'Could not save the event.' });
      }
    }
  );

  // List events
  router.get(basePath, async function (req, res) {
    const sql = `
      SELECT *
      FROM events
      WHERE category = $1
      ORDER BY event_date ASC, id DESC
    `;

    try {
      const result = await db.query(sql, [category]);
      return res.json(result.rows.map(normaliseEvent));
    } catch (error) {
      console.error('Could not load events:', error);
      return res.status(500).json({ error: 'Could not load events.' });
    }
  });

  // Update event status only
  router.patch(
    basePath + '/:id/status',
    requireAuth,
    async function (req, res) {
      const status = String(req.body.status || '').trim();
      const rules = eventRules(category);

      if (!rules.statuses.has(status)) {
        return res.status(400).json({
          error: 'Invalid status for this event category.'
        });
      }

      const sql = `
        UPDATE events
        SET status = $1, updated_at = NOW()
        WHERE id = $2 AND category = $3
        RETURNING *
      `;

      try {
        const result = await db.query(sql, [status, req.params.id, category]);

        if (!result.rows.length) {
          return res.status(404).json({ error: 'Event not found.' });
        }

        return res.json({
          message: 'Event status updated.',
          event: normaliseEvent(result.rows[0])
        });
      } catch (error) {
        console.error('Could not update event status:', error);
        return res.status(500).json({
          error: 'Could not update the event status.'
        });
      }
    }
  );

  // Delete event
  router.delete(
    basePath + '/:id',
    requireAuth,
    async function (req, res) {
      const sql = 'DELETE FROM events WHERE id = $1 AND category = $2';

      try {
        const result = await db.query(sql, [req.params.id, category]);

        if (!result.rowCount) {
          return res.status(404).json({ error: 'Event not found.' });
        }

        return res.json({ message: 'Event deleted.' });
      } catch (error) {
        console.error('Could not delete event:', error);
        return res.status(500).json({ error: 'Could not delete event.' });
      }
    }
  );
}

// CPD events
createEventRoutes('cpd');

// Other events
createEventRoutes('other');

// Combined public calendar endpoint
router.get('/', async function (req, res) {
  const conditions = [];
  const values = [];

  if (req.query.category === 'cpd' || req.query.category === 'other') {
    conditions.push('category = $' + (values.length + 1));
    values.push(req.query.category);
  }

  if (req.query.type) {
    conditions.push('event_type = $' + (values.length + 1));
    values.push(req.query.type);
  }

  if (req.query.status) {
    conditions.push('status = $' + (values.length + 1));
    values.push(req.query.status);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const sql = `
    SELECT *
    FROM events
    ${where}
    ORDER BY event_date ASC, id DESC
  `;

  try {
    const result = await db.query(sql, values);
    return res.json(result.rows.map(normaliseEvent));
  } catch (error) {
    console.error('Could not load combined events:', error);
    return res.status(500).json({ error: 'Could not load events.' });
  }
});

module.exports = router;