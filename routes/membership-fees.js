// routes/membership-fees.js
const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const FEE_KEYS = new Set(['associate', 'lifetime', 'upgrade']);

function normaliseFee(row) {
  return {
    key: row.key,
    label: row.label,
    // amount is NOT NULL in the DB (see schema.sql) -- null is only ever
    // surfaced here, as the frontend's "to be announced" signal.
    amount: row.is_tba ? null : Number(row.amount),
    is_tba: row.is_tba,
    updated_at: row.updated_at
  };
}

function isValidAmount(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return false;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0;
}

// List all membership fees (PUBLIC) -- the Membership Categories & Fees
// page renders from this.
router.get('/', async function (req, res) {
  try {
    const result = await db.query(
      'SELECT * FROM membership_fee_settings ORDER BY key'
    );
    return res.json(result.rows.map(normaliseFee));
  } catch (error) {
    console.error('Could not load membership fees:', error);
    return res.status(500).json({ error: 'Could not load membership fees.' });
  }
});

// Update one fee's amount / TBA state.
// The client is never trusted to send the right amount for a TBA fee --
// same convention as resolveCpdFees in routes/events.js -- the server
// forces amount to 0 whenever is_tba is true, ignoring whatever the
// request body sent.
router.put('/:key', requireAuth, async function (req, res) {
  const key = req.params.key;

  if (!FEE_KEYS.has(key)) {
    return res.status(404).json({ error: 'Unknown fee.' });
  }

  const isTba = req.body.is_tba === true || req.body.is_tba === 'true';

  if (!isTba && !isValidAmount(req.body.amount)) {
    return res.status(400).json({ error: 'Amount must be a valid value of 0 or more.' });
  }

  const amount = isTba ? 0 : Number(req.body.amount);

  try {
    const result = await db.query(
      `UPDATE membership_fee_settings
       SET amount = $1, is_tba = $2, updated_at = NOW()
       WHERE key = $3
       RETURNING *`,
      [amount, isTba, key]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Unknown fee.' });
    }

    return res.json({
      message: 'Fee updated.',
      fee: normaliseFee(result.rows[0])
    });
  } catch (error) {
    console.error('Could not update membership fee:', error);
    return res.status(500).json({ error: 'Could not update the fee.' });
  }
});

module.exports = router;
