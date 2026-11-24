// routes/membership-renewals.js
// Public renewal and upgrade endpoints (mounted at /api/membership):
//   POST /renew/lookup    membership number -> short-lived renewal token
//   GET  /renew/:token    what the Renew Membership page shows
//   POST /renew/:token    submit a renewal or upgrade with a payment slip
// A token comes either from the lookup (the page then masks the member's
// contact details, since anyone could type a number) or from an emailed
// link (reminders, or one an admin sends).

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');

const pool = require('../db/pool');
const M = require('../lib/membership');
const emails = require('../lib/membership-emails');
const { putPrivateObject, deletePrivateObject } = require('../lib/r2');
const { membershipLookupLimiter } = require('../middleware/rate-limit');

const router = express.Router();

const RECEIPT_PREFIX = 'membership-renewals/';
const RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (file.fieldname !== 'receipt') return callback(new Error('Unexpected upload field.'));
    if (!RECEIPT_TYPES.includes(file.mimetype)) {
      return callback(new Error('Invalid file type for receipt. Please upload a PDF, JPG or PNG.'));
    }
    return callback(null, true);
  },
});

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeFilename(name) {
  return path.basename(name || 'receipt').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-') || 'receipt';
}

// "in•••@gmail.com", "071•••••68": enough to recognise, not to read.
const maskEmail = (e) => (e ? e.replace(/^(.{1,2})[^@]*(@.*)$/, '$1•••$2') : null);
const maskPhone = (p) => (p ? p.slice(0, 3) + '•'.repeat(Math.max(p.length - 5, 0)) + p.slice(-2) : null);

// What the Renew Membership page needs for this member.
async function renewalView(member) {
  const [settings, fees] = await Promise.all([M.loadSettings(), M.loadFees()]);
  const state = M.memberState(member, settings);
  const latest = (await pool.query(
    `SELECT kind, to_category, status, status_note, amount, payment_reference,
            new_valid_until, created_at, reviewed_at
       FROM renewal_requests WHERE member_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [member.id]
  )).rows[0] || null;

  const hidden = Boolean(member.via_lookup);
  const canRenew = member.category !== 'LT' && state !== 'deactivated' && renewalAmount(member, fees) !== null;

  return {
    member: {
      name_with_initials: member.name_with_initials || member.full_name,
      membership_number: member.membership_number,
      category: member.category,
      category_label: M.CATEGORIES[member.category],
      valid_until: M.toDateString(member.valid_until),
      grace_ends: M.graceEnds(member, settings),
      state,
      state_label: M.STATE_LABELS[state],
      email: hidden ? null : member.email_address,
      mobile: hidden ? null : member.mobile_number,
      current_working_place: hidden ? null : member.current_working_place,
      contact_hidden: hidden,
      email_hint: hidden ? maskEmail(member.email_address) : null,
      mobile_hint: hidden ? maskPhone(member.mobile_number) : null,
    },
    renewal: canRenew
      ? { amount: renewalAmount(member, fees), new_valid_until: M.renewedValidUntil(member, settings) }
      : null,
    // Categories this member can upgrade to, each at that category's fee
    // less any loyalty discount.
    upgrades: state === 'deactivated' ? [] : M.UPGRADES[member.category]
      .map((to) => {
        const quote = M.upgradeQuote(member, to, fees, settings);
        return {
          to_category: to,
          label: M.CATEGORIES[to],
          amount: quote.amount,
          full_amount: quote.base,
          discount: quote.discount,
          years: quote.years,
          new_valid_until: M.upgradedValidUntil(member, to, settings),
          // Associates moving to a nurses' category give their work details.
          needs_work_details: M.needsWorkDetails(member, 'upgrade', to),
        };
      })
      .filter((u) => u.amount !== null),
    payment_reference: M.paymentReference(member),
    latest_request: latest,
  };
}

function renewalAmount(member, fees) {
  return M.renewalFee(member, fees);
}

function notFoundToken(res) {
  return res.status(404).json({
    error: 'This renewal link has expired or is not valid. You can still renew with your membership number.',
  });
}

router.post('/renew/lookup', membershipLookupLimiter, async (req, res, next) => {
  try {
    // The membership number alone: members who joined before the website
    // often have no NIC on record. The page then hides their contact details.
    const member = await M.findMemberByNumber(req.body.membership_number);
    if (!member) {
      return res.status(404).json({ error: 'No member has that membership number. Please check it and try again.' });
    }
    return res.json({ token: await M.createRenewalToken(member.id, 1, undefined, { viaLookup: true }) });
  } catch (err) {
    return next(err);
  }
});

router.get('/renew/:token', membershipLookupLimiter, async (req, res, next) => {
  try {
    const member = await M.memberForToken(req.params.token);
    if (!member) return notFoundToken(res);
    return res.json(await renewalView(member));
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/renew/:token',
  membershipLookupLimiter,
  upload.single('receipt'),
  async (req, res, next) => {
    let receiptKey = null;

    try {
      const member = await M.memberForToken(req.params.token);
      if (!member) return notFoundToken(res);

      const view = await renewalView(member);
      const kind = clean(req.body.kind);
      const paymentDate = clean(req.body.payment_date);
      const email = clean(req.body.email).toLowerCase();
      const mobile = clean(req.body.mobile).replace(/[\s-]/g, '');
      const workplace = clean(req.body.current_working_place);

      if (!['renewal', 'upgrade'].includes(kind)) throw M.badRequest('Please choose to renew or upgrade.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || paymentDate > M.today()) {
        throw M.badRequest('Please enter the date you paid (not in the future).');
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw M.badRequest('Please enter a valid email address.');
      if (mobile && !/^(?:\+94|0)7[0-8][0-9]{7}$/.test(mobile)) {
        throw M.badRequest('Mobile number must be a valid Sri Lankan mobile number (07XXXXXXXX or +947XXXXXXXX).');
      }
      if (!req.file) throw M.badRequest('Please upload your payment slip or receipt.');

      const target = kind === 'upgrade'
        ? view.upgrades.find((u) => u.to_category === clean(req.body.to_category))
        : null;
      if (kind === 'upgrade' && !target) throw M.badRequest('This membership cannot be upgraded to that category.');
      if (kind === 'renewal' && !view.renewal) throw M.badRequest('This membership does not need renewing.');

      const pending = (await pool.query(
        "SELECT 1 FROM renewal_requests WHERE member_id = $1 AND status = 'pending'", [member.id]
      )).rows[0];
      if (pending) throw M.badRequest('Your previous renewal is still being verified. You will hear from us soon.');

      // An Associate (student) upgrading to Ordinary / Lifetime gives their
      // work details now. They are saved to the member record straight away
      // (kept even if the payment is later rejected: they're still useful).
      const workDetails = target && M.needsWorkDetails(member, kind, target.to_category)
        ? M.readWorkDetails(req.body)
        : null;

      if (workDetails) await M.saveWorkDetails(pool, member, workDetails);

      receiptKey = `${RECEIPT_PREFIX}${member.id}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeFilename(req.file.originalname)}`;
      await putPrivateObject(receiptKey, req.file.buffer, req.file.mimetype);

      const request = (await pool.query(
        `INSERT INTO renewal_requests
           (member_id, kind, from_category, to_category, amount, discount_amount,
            payment_reference, payment_date, receipt_key, receipt_original_name,
            email_address, mobile_number, current_working_place, previous_valid_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          member.id, kind, member.category, target ? target.to_category : member.category,
          target ? target.amount : view.renewal.amount, target ? target.discount : 0,
          view.payment_reference, paymentDate, receiptKey, req.file.originalname,
          email || null, mobile || null, workplace || null, member.valid_until,
        ]
      )).rows[0];

      emails.renewalSubmitted(member, request);
      emails.secretaryRenewalSubmitted(member, request);

      return res.status(201).json({ payment_reference: request.payment_reference, status: request.status });
    } catch (err) {
      if (receiptKey) deletePrivateObject(receiptKey).catch(() => {});
      return next(err);
    }
  }
);

// Upload errors (size / type) as friendly 400s.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'The payment slip must be 5 MB or smaller.' : 'There was a problem with the uploaded file.',
    });
  }
  if (err && /Invalid file type|Unexpected upload field/.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

module.exports = { router, renewalView, RECEIPT_PREFIX };
