// routes/sub-committees.js
const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

function normaliseMember(row) {
  return {
    id: row.id,
    committee_key: row.committee_key,
    display_order: row.display_order,
    designation: row.designation,
    name: row.name
  };
}

function normaliseCommittee(row) {
  return {
    slot_key: row.slot_key,
    display_order: row.display_order,
    name: row.name,
    description: row.description,
    members: []
  };
}

// Public: all 7 Sub Committees (in order), each with its 5 members (in
// seat order).
router.get('/', async function (req, res) {
  try {
    const [committees, members] = await Promise.all([
      db.query('SELECT * FROM sub_committees ORDER BY display_order'),
      db.query('SELECT * FROM sub_committee_members ORDER BY committee_key, display_order')
    ]);

    const byKey = {};
    const result = committees.rows.map(function (row) {
      const committee = normaliseCommittee(row);
      byKey[committee.slot_key] = committee;
      return committee;
    });

    members.rows.forEach(function (row) {
      const committee = byKey[row.committee_key];
      if (committee) committee.members.push(normaliseMember(row));
    });

    return res.json(result);
  } catch (error) {
    console.error('Could not load sub committees:', error);
    return res.status(500).json({ error: 'Could not load the sub committees.' });
  }
});

// Update one member's name / designation (admin only). Committees and
// seats are fixed -- there is no create or delete, only updates to the 35
// seeded rows.
router.put('/members/:id', requireAuth, async function (req, res) {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(404).json({ error: 'Unknown committee member.' });
  }

  const name = String(req.body.name || '').trim();
  const designation = String(req.body.designation || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  try {
    const result = await db.query(
      `UPDATE sub_committee_members
       SET name = $1, designation = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [name, designation || null, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Unknown committee member.' });
    }

    return res.json({
      message: 'Committee member updated.',
      member: normaliseMember(result.rows[0])
    });
  } catch (error) {
    console.error('Could not update sub committee member:', error);
    return res.status(500).json({ error: 'Could not update the committee member.' });
  }
});

module.exports = router;
