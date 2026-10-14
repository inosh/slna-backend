// routes/executive-committee.js
const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { uploadExecCommitteePhoto } = require('../middleware/upload');

// The 10 Executive Committee seats are fixed by the SLNA constitution --
// this route only ever updates these rows, it never creates or deletes one.
const SLOT_ORDER = [
  'president', 'general_secretary', 'treasurer',
  'vp_hospital', 'vp_education', 'vp_public_health',
  'asst_secretary_1', 'asst_secretary_2', 'asst_treasurer', 'librarian'
];
const SLOT_KEYS = new Set(SLOT_ORDER);

function normaliseMember(row) {
  return {
    slot_key: row.slot_key,
    display_order: row.display_order,
    role_title: row.role_title,
    designation: row.designation,
    name: row.name,
    photo_url: row.photo_url
  };
}

function normaliseSettings(row) {
  return {
    term_start_year: row.term_start_year,
    term_end_year: row.term_end_year,
    agm_number: row.agm_number,
    agm_date: row.agm_date,
    agm_venue: row.agm_venue
  };
}

// Public: full roster (in seat order) plus the term/AGM details shown on
// the Executive Committee page.
router.get('/', async function (req, res) {
  try {
    const [members, settings] = await Promise.all([
      db.query('SELECT * FROM exec_committee_members ORDER BY display_order'),
      db.query('SELECT * FROM exec_committee_settings WHERE id = 1')
    ]);

    return res.json({
      members: members.rows.map(normaliseMember),
      settings: settings.rows[0] ? normaliseSettings(settings.rows[0]) : null
    });
  } catch (error) {
    console.error('Could not load executive committee:', error);
    return res.status(500).json({ error: 'Could not load the executive committee.' });
  }
});

// Update the term and AGM details (admin only).
router.put('/settings', requireAuth, async function (req, res) {
  const termStartYear = Number(req.body.term_start_year);
  const termEndYear = Number(req.body.term_end_year);
  const agmNumber = Number(req.body.agm_number);
  const agmDate = req.body.agm_date;
  const agmVenue = String(req.body.agm_venue || '').trim();

  if (!Number.isInteger(termStartYear) || !Number.isInteger(termEndYear) || termEndYear < termStartYear) {
    return res.status(400).json({ error: 'Enter a valid term (the "From" year must not be after the "To" year).' });
  }

  if (!Number.isInteger(agmNumber) || agmNumber < 1) {
    return res.status(400).json({ error: 'Enter a valid AGM number.' });
  }

  if (!agmDate) {
    return res.status(400).json({ error: 'Enter the AGM date.' });
  }

  try {
    const result = await db.query(
      `UPDATE exec_committee_settings
       SET term_start_year = $1, term_end_year = $2, agm_number = $3,
           agm_date = $4, agm_venue = $5, updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [termStartYear, termEndYear, agmNumber, agmDate, agmVenue || null]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Executive committee settings not found.' });
    }

    return res.json({
      message: 'Term and AGM details updated.',
      settings: normaliseSettings(result.rows[0])
    });
  } catch (error) {
    console.error('Could not update executive committee settings:', error);
    return res.status(500).json({ error: 'Could not update the term and AGM details.' });
  }
});

// Update one seat's name / designation / role title / photo (admin only).
// Slots are fixed -- there is no create or delete, only updates to the 10
// seeded rows.
router.put('/:slotKey', requireAuth, uploadExecCommitteePhoto.single('photo'), async function (req, res) {
  const slotKey = req.params.slotKey;

  if (!SLOT_KEYS.has(slotKey)) {
    return res.status(404).json({ error: 'Unknown committee seat.' });
  }

  const name = String(req.body.name || '').trim();
  const roleTitle = String(req.body.role_title || '').trim();
  const designation = String(req.body.designation || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  if (!roleTitle) {
    return res.status(400).json({ error: 'Role title is required.' });
  }

  try {
    const existing = await db.query(
      'SELECT * FROM exec_committee_members WHERE slot_key = $1',
      [slotKey]
    );

    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Unknown committee seat.' });
    }

    const photoUrl = req.file ? '/uploads/' + req.file.key : existing.rows[0].photo_url;
    const photoFilename = req.file ? req.file.originalname : existing.rows[0].photo_filename;

    const result = await db.query(
      `UPDATE exec_committee_members
       SET name = $1, role_title = $2, designation = $3,
           photo_url = $4, photo_filename = $5, updated_at = NOW()
       WHERE slot_key = $6
       RETURNING *`,
      [name, roleTitle, designation || null, photoUrl, photoFilename, slotKey]
    );

    return res.json({
      message: 'Committee member updated.',
      member: normaliseMember(result.rows[0])
    });
  } catch (error) {
    console.error('Could not update committee member:', error);
    return res.status(500).json({ error: 'Could not update the committee member.' });
  }
});

module.exports = router;
