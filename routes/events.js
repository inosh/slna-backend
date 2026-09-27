// routes/events.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const {
  uploadEventPhoto,
  uploadCpdEventFiles
} = require('../middleware/upload');

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

const CPD_EVENT_AUDIENCES = new Set([
  'Open for Public',
  'Members Only'
]);

function eventUploadUrl(file) {
  return file ? '/uploads/events/' + file.filename : null;
}

function attachmentUploadUrl(file) {
  return file ? '/uploads/events/attachements/' + file.filename : null;
}

// The attachment's filename is built before the event has a real id (see
// uploadCpdEventFiles), so once a CREATE gets its new id back from the
// database, swap the "new" placeholder in the stored filename for it.
function renameAttachmentForNewEvent(file, eventId) {
  const currentName = path.basename(file.path);
  const updatedName = currentName.replace(/^(\d+)-new-/, `$1-${eventId}-`);

  if (updatedName === currentName) {
    return { url: attachmentUploadUrl(file), filename: file.originalname };
  }

  const updatedPath = path.join(path.dirname(file.path), updatedName);
  fs.renameSync(file.path, updatedPath);

  return {
    url: '/uploads/events/attachements/' + updatedName,
    filename: file.originalname
  };
}

function isValidFee(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return false;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0;
}

// ------------------------------------------------------------------
// CPD events (table: cpd_events)
// ------------------------------------------------------------------

function normaliseCpdEvent(row) {
  if (!row) return null;

  return {
    id: row.id,
    category: 'cpd',
    type: row.event_type,
    title: row.title,
    event_date: row.event_date,
    time: row.time,
    location: row.location,
    summary: row.summary,
    status: row.status,
    audience: row.audience,
    member_fee: row.member_fee === null ? null : Number(row.member_fee),
    non_member_fee:
        row.non_member_fee === null ? null : Number(row.non_member_fee),
    photo_url: row.photo_url,
    photo_filename: row.photo_filename,
    attachment_url: row.attachment_url,
    attachment_filename: row.attachment_filename,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function validateCpdEventInput(body) {
  const required = [
    'title',
    'type',
    'event_date',
    'time',
    'location',
    'summary',
    'status',
    'audience'
  ];

  for (const field of required) {
    if (!String(body[field] || '').trim()) {
      return field + ' is required.';
    }
  }

  if (!CPD_EVENT_TYPES.has(body.type)) {
    return 'Invalid event type for this event category.';
  }

  if (!CPD_EVENT_STATUSES.has(body.status)) {
    return 'Invalid status for this event category.';
  }

  if (!CPD_EVENT_AUDIENCES.has(body.audience)) {
    return 'Invalid audience. Must be "Open for Public" or "Members Only".';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.event_date)) {
    return 'Date must use YYYY-MM-DD format.';
  }

  if (!isValidFee(body.member_fee)) {
    return 'Member Fee must be a valid amount of 0 or more.';
  }

  if (!isValidFee(body.non_member_fee)) {
    return 'Non-Member Fee must be a valid amount of 0 or more.';
  }

  return null;
}

// Create CPD event with optional photo and PDF attachment
router.post(
  '/cpd',
  requireAuth,
  uploadCpdEventFiles,
  async function (req, res) {
    const validationError = validateCpdEventInput(req.body);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const photoFile = req.files && req.files.photo && req.files.photo[0];
    const attachmentFile = req.files && req.files.attachment && req.files.attachment[0];

    const sql = `
      INSERT INTO cpd_events (
        event_type,
        title,
        event_date,
        time,
        location,
        summary,
        status,
        audience,
        member_fee,
        non_member_fee,
        photo_url,
        photo_filename,
        attachment_url,
        attachment_filename,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
      RETURNING *
    `;

    const values = [
      req.body.type.trim(),
      req.body.title.trim(),
      req.body.event_date,
      req.body.time.trim(),
      req.body.location.trim(),
      req.body.summary.trim(),
      req.body.status.trim(),
      req.body.audience.trim(),
      Number(req.body.member_fee),
      Number(req.body.non_member_fee),
      eventUploadUrl(photoFile),
      photoFile ? photoFile.originalname : null,
      attachmentUploadUrl(attachmentFile),
      attachmentFile ? attachmentFile.originalname : null
    ];

    try {
      const result = await db.query(sql, values);
      let row = result.rows[0];

      if (attachmentFile) {
        const renamed = renameAttachmentForNewEvent(attachmentFile, row.id);

        const updateResult = await db.query(
          'UPDATE cpd_events SET attachment_url = $1 WHERE id = $2 RETURNING *',
          [renamed.url, row.id]
        );

        row = updateResult.rows[0];
      }

      return res.status(201).json({
        message: 'Event created.',
        event: normaliseCpdEvent(row)
      });
    } catch (error) {
      console.error('Could not create CPD event:', error);
      return res.status(500).json({ error: 'Could not save the event.' });
    }
  }
);

// List CPD events
router.get('/cpd', async function (req, res) {
  const sql = `
    SELECT *
    FROM cpd_events
    ORDER BY event_date ASC, id DESC
  `;

  try {
    const result = await db.query(sql);
    return res.json(result.rows.map(normaliseCpdEvent));
  } catch (error) {
    console.error('Could not load CPD events:', error);
    return res.status(500).json({ error: 'Could not load events.' });
  }
});

// Get a single CPD event by ID (PUBLIC)
router.get('/cpd/:id', async function (req, res) {
  const sql = 'SELECT * FROM cpd_events WHERE id = $1';

  try {
    const result = await db.query(sql, [req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    return res.json(normaliseCpdEvent(result.rows[0]));
  } catch (error) {
    console.error('Could not load CPD event:', error);
    return res.status(500).json({ error: 'Could not load the event.' });
  }
});

// Download a CPD event's PDF attachment (PUBLIC)
router.get('/cpd/:id/attachment', async function (req, res) {
  try {
    const result = await db.query(
      'SELECT attachment_url, attachment_filename FROM cpd_events WHERE id = $1',
      [req.params.id]
    );

    if (!result.rows.length || !result.rows[0].attachment_url) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }

    const { attachment_url: attachmentUrl, attachment_filename: attachmentFilename } = result.rows[0];
    const filePath = path.join(__dirname, '..', attachmentUrl.replace(/^\/+/, ''));

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Attachment file not found.' });
    }

    return res.download(filePath, attachmentFilename || path.basename(filePath));
  } catch (error) {
    console.error('Could not download CPD event attachment:', error);
    return res.status(500).json({ error: 'Could not download the attachment.' });
  }
});

// Update CPD event status only
router.patch(
  '/cpd/:id/status',
  requireAuth,
  async function (req, res) {
    const status = String(req.body.status || '').trim();

    if (!CPD_EVENT_STATUSES.has(status)) {
      return res.status(400).json({
        error: 'Invalid status for this event category.'
      });
    }

    const sql = `
      UPDATE cpd_events
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    try {
      const result = await db.query(sql, [status, req.params.id]);

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Event not found.' });
      }

      return res.json({
        message: 'Event status updated.',
        event: normaliseCpdEvent(result.rows[0])
      });
    } catch (error) {
      console.error('Could not update CPD event status:', error);
      return res.status(500).json({
        error: 'Could not update the event status.'
      });
    }
  }
);

// Full update for CPD event (optionally replacing the photo and/or attachment)
router.put(
  '/cpd/:id',
  requireAuth,
  uploadCpdEventFiles,
  async function (req, res) {
    const validationError = validateCpdEventInput(req.body);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const photoFile = req.files && req.files.photo && req.files.photo[0];
    const attachmentFile = req.files && req.files.attachment && req.files.attachment[0];

    try {
      const existing = await db.query(
        'SELECT * FROM cpd_events WHERE id = $1',
        [req.params.id]
      );

      if (!existing.rows.length) {
        return res.status(404).json({ error: 'Event not found.' });
      }

      const photoUrl = photoFile
          ? eventUploadUrl(photoFile)
          : existing.rows[0].photo_url;

      const photoFilename = photoFile
          ? photoFile.originalname
          : existing.rows[0].photo_filename;

      const attachmentUrl = attachmentFile
          ? attachmentUploadUrl(attachmentFile)
          : existing.rows[0].attachment_url;

      const attachmentFilename = attachmentFile
          ? attachmentFile.originalname
          : existing.rows[0].attachment_filename;

      const sql = `
        UPDATE cpd_events
        SET event_type = $1,
            title = $2,
            event_date = $3,
            time = $4,
            location = $5,
            summary = $6,
            status = $7,
            audience = $8,
            member_fee = $9,
            non_member_fee = $10,
            photo_url = $11,
            photo_filename = $12,
            attachment_url = $13,
            attachment_filename = $14,
            updated_at = NOW()
        WHERE id = $15
        RETURNING *
      `;

      const values = [
        req.body.type.trim(),
        req.body.title.trim(),
        req.body.event_date,
        req.body.time.trim(),
        req.body.location.trim(),
        req.body.summary.trim(),
        req.body.status.trim(),
        req.body.audience.trim(),
        Number(req.body.member_fee),
        Number(req.body.non_member_fee),
        photoUrl,
        photoFilename,
        attachmentUrl,
        attachmentFilename,
        req.params.id
      ];

      const result = await db.query(sql, values);

      return res.json({
        message: 'Event updated.',
        event: normaliseCpdEvent(result.rows[0])
      });
    } catch (error) {
      console.error('Could not update CPD event:', error);
      return res.status(500).json({ error: 'Could not update the event.' });
    }
  }
);

// Delete CPD event
router.delete(
  '/cpd/:id',
  requireAuth,
  async function (req, res) {
    const sql = 'DELETE FROM cpd_events WHERE id = $1';

    try {
      const result = await db.query(sql, [req.params.id]);

      if (!result.rowCount) {
        return res.status(404).json({ error: 'Event not found.' });
      }

      return res.json({ message: 'Event deleted.' });
    } catch (error) {
      console.error('Could not delete CPD event:', error);
      return res.status(500).json({ error: 'Could not delete event.' });
    }
  }
);

// ------------------------------------------------------------------
// Other events (table: events, category = 'other') -- unchanged
// ------------------------------------------------------------------

function normaliseOtherEvent(row) {
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

function validateOtherEventInput(body) {
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

  if (!OTHER_EVENT_TYPES.has(body.type)) {
    return 'Invalid event type for this event category.';
  }

  if (!OTHER_EVENT_STATUSES.has(body.status)) {
    return 'Invalid status for this event category.';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.event_date)) {
    return 'Date must use YYYY-MM-DD format.';
  }

  return null;
}

// Create Other event with optional photo
router.post(
  '/other',
  requireAuth,
  uploadEventPhoto.single('photo'),
  async function (req, res) {
    const validationError = validateOtherEventInput(req.body);

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
      'other',
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
        event: normaliseOtherEvent(row)
      });
    } catch (error) {
      console.error('Could not create event:', error);
      return res.status(500).json({ error: 'Could not save the event.' });
    }
  }
);

// List Other events
router.get('/other', async function (req, res) {
  const sql = `
    SELECT *
    FROM events
    WHERE category = 'other'
    ORDER BY event_date ASC, id DESC
  `;

  try {
    const result = await db.query(sql);
    return res.json(result.rows.map(normaliseOtherEvent));
  } catch (error) {
    console.error('Could not load events:', error);
    return res.status(500).json({ error: 'Could not load events.' });
  }
});

// Get a single Other event by ID (PUBLIC)
router.get('/other/:id', async function (req, res) {
  const sql = "SELECT * FROM events WHERE id = $1 AND category = 'other'";

  try {
    const result = await db.query(sql, [req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    return res.json(normaliseOtherEvent(result.rows[0]));
  } catch (error) {
    console.error('Could not load event:', error);
    return res.status(500).json({ error: 'Could not load the event.' });
  }
});

// Update Other event status only
router.patch(
  '/other/:id/status',
  requireAuth,
  async function (req, res) {
    const status = String(req.body.status || '').trim();

    if (!OTHER_EVENT_STATUSES.has(status)) {
      return res.status(400).json({
        error: 'Invalid status for this event category.'
      });
    }

    const sql = `
      UPDATE events
      SET status = $1, updated_at = NOW()
      WHERE id = $2 AND category = 'other'
      RETURNING *
    `;

    try {
      const result = await db.query(sql, [status, req.params.id]);

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Event not found.' });
      }

      return res.json({
        message: 'Event status updated.',
        event: normaliseOtherEvent(result.rows[0])
      });
    } catch (error) {
      console.error('Could not update event status:', error);
      return res.status(500).json({
        error: 'Could not update the event status.'
      });
    }
  }
);

// Full update for Other event (optionally replacing the photo)
router.put(
  '/other/:id',
  requireAuth,
  uploadEventPhoto.single('photo'),
  async function (req, res) {
    const validationError = validateOtherEventInput(req.body);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    try {
      const existing = await db.query(
        "SELECT * FROM events WHERE id = $1 AND category = 'other'",
        [req.params.id]
      );

      if (!existing.rows.length) {
        return res.status(404).json({ error: 'Event not found.' });
      }

      const photoUrl = req.file
          ? eventUploadUrl(req.file)
          : existing.rows[0].photo_url;

      const photoFilename = req.file
          ? req.file.originalname
          : existing.rows[0].photo_filename;

      const sql = `
        UPDATE events
        SET event_type = $1,
            title = $2,
            event_date = $3,
            time = $4,
            location = $5,
            summary = $6,
            status = $7,
            photo_url = $8,
            photo_filename = $9,
            updated_at = NOW()
        WHERE id = $10 AND category = 'other'
        RETURNING *
      `;

      const values = [
        req.body.type.trim(),
        req.body.title.trim(),
        req.body.event_date,
        req.body.time.trim(),
        req.body.location.trim(),
        req.body.summary.trim(),
        req.body.status.trim(),
        photoUrl,
        photoFilename,
        req.params.id
      ];

      const result = await db.query(sql, values);

      return res.json({
        message: 'Event updated.',
        event: normaliseOtherEvent(result.rows[0])
      });
    } catch (error) {
      console.error('Could not update event:', error);
      return res.status(500).json({ error: 'Could not update the event.' });
    }
  }
);

// Delete Other event
router.delete(
  '/other/:id',
  requireAuth,
  async function (req, res) {
    const sql = "DELETE FROM events WHERE id = $1 AND category = 'other'";

    try {
      const result = await db.query(sql, [req.params.id]);

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

// ------------------------------------------------------------------
// Combined public calendar endpoint (reads from both tables)
// ------------------------------------------------------------------

async function fetchOtherEvents(filters) {
  const conditions = ["category = 'other'"];
  const values = [];

  if (filters.type) {
    conditions.push('event_type = $' + (values.length + 1));
    values.push(filters.type);
  }

  if (filters.status) {
    conditions.push('status = $' + (values.length + 1));
    values.push(filters.status);
  }

  const sql = `
    SELECT *
    FROM events
    WHERE ${conditions.join(' AND ')}
  `;

  const result = await db.query(sql, values);
  return result.rows.map(normaliseOtherEvent);
}

async function fetchCpdEvents(filters) {
  const conditions = [];
  const values = [];

  if (filters.type) {
    conditions.push('event_type = $' + (values.length + 1));
    values.push(filters.type);
  }

  if (filters.status) {
    conditions.push('status = $' + (values.length + 1));
    values.push(filters.status);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const sql = `
    SELECT *
    FROM cpd_events
    ${where}
  `;

  const result = await db.query(sql, values);
  return result.rows.map(normaliseCpdEvent);
}

router.get('/', async function (req, res) {
  const filters = {
    type: req.query.type || null,
    status: req.query.status || null
  };

  try {
    let events;

    if (req.query.category === 'cpd') {
      events = await fetchCpdEvents(filters);
    } else if (req.query.category === 'other') {
      events = await fetchOtherEvents(filters);
    } else {
      const [cpdEvents, otherEvents] = await Promise.all([
        fetchCpdEvents(filters),
        fetchOtherEvents(filters)
      ]);
      events = cpdEvents.concat(otherEvents);
    }

    events.sort(function (a, b) {
      return new Date(a.event_date) - new Date(b.event_date) || b.id - a.id;
    });

    return res.json(events);
  } catch (error) {
    console.error('Could not load combined events:', error);
    return res.status(500).json({ error: 'Could not load events.' });
  }
});

module.exports = router;
