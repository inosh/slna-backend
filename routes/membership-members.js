// routes/membership-members.js
// Admin endpoints for members, renewals, upgrades, settings and reminders
// (mounted at /api/membership-admin; every route needs a login).
//
//   GET    /overview                      counts for badges and stat tiles
//   GET    /next-number?category=GM       suggested next membership number
//   GET    /members?state=&category=&record=&q=
//   GET    /members/counts?category=&record=&q=
//   GET    /members/:id                   details, payments, reminders, old numbers
//   POST   /members                       add a member (source manual or legacy)
//   PUT    /members/:id                   edit details
//   POST   /members/:id/deactivate        { reason }
//   POST   /members/:id/reactivate
//   POST   /members/:id/renewal-link      { send_email }
//   POST   /members/:id/payments          record a renewal / upgrade paid offline
//   GET    /renewals?status=pending|verified|rejected|all
//   GET    /renewals/counts
//   GET    /renewals/:id/receipt
//   PATCH  /renewals/:id                  { status: verified|rejected, status_note, membership_number }
//   GET    /settings                      grace / notice days, upgrade discounts
//   PUT    /settings
//   POST   /reminders/run                 send due reminders now
//
// Members also keep their original rows (membership_applications /
// legacy_lifetime_members): personal details and the active flag are
// written to those too, so the old records stay accurate.

const express = require('express');

const pool = require('../db/pool');
const M = require('../lib/membership');
const emails = require('../lib/membership-emails');
const { runReminders } = require('../lib/reminders');
const { requireAuth } = require('../middleware/auth');
const { getPrivateObject, isNotFoundError } = require('../lib/r2');
const { normaliseNic, isValidNic, nicVariants, INVALID_NIC_MESSAGE } = require('../lib/nic');
const { RECEIPT_PREFIX } = require('./membership-renewals');

const router = express.Router();
router.use(requireAuth);

const clean = (v) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());
const userId = (req) => (req.user && req.user.id ? req.user.id : null);
const userName = (req) => (req.user && req.user.username ? req.user.username : null);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// Personal / contact / professional fields an admin can edit
// [jsonKey, column, label, requiredForFullRecord]
const DETAIL_FIELDS = [
  ['fullName', 'full_name', 'Full name'],
  ['nameWithInitials', 'name_with_initials', 'Name with initials'],
  ['title', 'title', 'Title'],
  ['nicNumber', 'nic_number', 'NIC number'],
  ['dateOfBirth', 'date_of_birth', 'Date of birth'],
  ['sex', 'sex', 'Sex'],
  ['maritalStatus', 'marital_status', 'Marital status'],
  ['permanentAddress', 'permanent_address', 'Permanent address'],
  ['currentWorkingPlace', 'current_working_place', 'Current working place'],
  ['officialAddress', 'official_address', 'Official address'],
  ['mobileNumber', 'mobile_number', 'Mobile number'],
  ['whatsappNumber', 'whatsapp_number', 'WhatsApp number'],
  ['residentialNumber', 'residential_number', 'Residential number'],
  ['officeNumber', 'office_number', 'Office number'],
  ['emailAddress', 'email_address', 'Email address'],
  ['slncRegistrationNumber', 'slnc_registration_number', 'SLNC registration number'],
  ['slncRegistrationDate', 'slnc_registration_date', 'SLNC registration date'],
  ['designation', 'designation', 'Designation'],
  ['firstAppointmentDate', 'first_appointment_date', 'First appointment date'],
  ['firstAppointmentPlace', 'first_appointment_place', 'First appointment place'],
  ['nursingSchool', 'nursing_school', 'Nursing school'],
  ['batch', 'batch', 'Batch'],
  ['higherEducationalQualification', 'higher_educational_qualification', 'Higher educational qualification'],
  ['studentNumber', 'student_number', 'Student number'],
  ['instituteRegistrationDate', 'institute_registration_date', 'Nursing school registration date'],
];
const DATE_COLUMNS = new Set(['date_of_birth', 'slnc_registration_date', 'first_appointment_date', 'institute_registration_date']);
// Columns the legacy table doesn't have.
const NOT_IN_LEGACY = new Set(['student_number', 'institute_registration_date']);

function memberToJson(row, settings) {
  const state = M.memberState(row, settings);
  const json = {
    id: Number(row.id),
    membershipNumber: row.membership_number,
    category: row.category,
    categoryLabel: M.CATEGORIES[row.category],
    state,
    stateLabel: M.STATE_LABELS[state],
    joinedOn: M.toDateString(row.joined_on),
    categorySince: M.toDateString(row.category_since),
    validUntil: M.toDateString(row.valid_until),
    graceEnds: M.graceEnds(row, settings),
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at,
    deactivatedReason: row.deactivated_reason,
    source: row.source,
    isLegacy: row.source === 'legacy',
    isManualEntry: row.source === 'manual',
    applicationId: row.application_id ? Number(row.application_id) : null,
    referenceNumber: row.reference_number || null,
    adminNote: row.admin_note,
    hasPendingRenewal: Boolean(row.pending_renewal_id),
    pendingRenewalId: row.pending_renewal_id ? Number(row.pending_renewal_id) : null,
  };
  DETAIL_FIELDS.forEach(([key, col]) => {
    json[key] = DATE_COLUMNS.has(col) ? M.toDateString(row[col]) : row[col];
  });
  return json;
}

// Members list with the latest pending renewal id and application ref.
const MEMBER_SELECT = `
  SELECT m.*, a.reference_number,
         (SELECT r.id FROM renewal_requests r WHERE r.member_id = m.id AND r.status = 'pending'
           ORDER BY r.created_at DESC LIMIT 1) AS pending_renewal_id
    FROM members m
    LEFT JOIN membership_applications a ON a.id = m.application_id`;

// Filters shared by the list, counts and export. Returns { where, params }.
function memberFilters(query) {
  const where = [];
  const params = [];
  const category = clean(query.category).toUpperCase();
  if (M.CATEGORIES[category]) {
    params.push(category);
    where.push(`m.category = $${params.length}`);
  }
  if (query.record === 'legacy') where.push("m.source = 'legacy'");
  if (query.record === 'new') where.push("m.source <> 'legacy'");
  const q = clean(query.q).toLowerCase();
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    params.push(q.replace(/[^a-z0-9]/g, ''));
    const c = `$${params.length}`;
    where.push(`(lower(m.full_name) LIKE ${p} OR lower(coalesce(m.name_with_initials, '')) LIKE ${p}
      OR lower(coalesce(m.nic_number, '')) LIKE ${p} OR lower(m.membership_number) LIKE ${p}
      OR lower(coalesce(m.mobile_number, '')) LIKE ${p} OR lower(coalesce(m.email_address, '')) LIKE ${p}
      OR EXISTS (SELECT 1 FROM retired_membership_numbers rn WHERE rn.member_id = m.id
                  AND lower(regexp_replace(rn.membership_number, '[^A-Za-z0-9]', '', 'g')) LIKE '%' || ${c} || '%'))`);
  }
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

async function loadMembers(query, settings) {
  const { where, params } = memberFilters(query);
  const rows = (await pool.query(`${MEMBER_SELECT} ${where} ORDER BY m.id`, params)).rows;
  return rows.map((row) => memberToJson(row, settings));
}

// state: current (everyone not deactivated) | all | active | renewal_due |
// grace | lapsed | deactivated | pending_renewal
function filterByState(members, state) {
  switch (state) {
    case 'all': return members;
    case 'pending_renewal': return members.filter((m) => m.hasPendingRenewal);
    case 'active': case 'renewal_due': case 'grace': case 'lapsed': case 'deactivated':
      return members.filter((m) => m.state === state);
    default: return members.filter((m) => m.state !== 'deactivated');
  }
}

function countStates(members) {
  const counts = { current: 0, all: members.length, active: 0, renewal_due: 0, grace: 0, lapsed: 0, deactivated: 0, pending_renewal: 0 };
  members.forEach((m) => {
    counts[m.state] += 1;
    if (m.state !== 'deactivated') counts.current += 1;
    if (m.hasPendingRenewal) counts.pending_renewal += 1;
  });
  return counts;
}

async function getMember(id, client = pool) {
  const row = (await client.query(`${MEMBER_SELECT} WHERE m.id = $1`, [id])).rows[0];
  return row || null;
}

function notFound(res, what = 'Member') {
  return res.status(404).json({ success: false, error: `${what} not found.`, message: `${what} not found.` });
}

// Copies the given member columns to the member's original row.
async function mirrorToSource(client, member, columns, values) {
  if (!columns.length) return;
  if (member.application_id) {
    const sets = columns.map((c, i) => `${c} = $${i + 1}`);
    await client.query(
      `UPDATE membership_applications SET ${sets.join(', ')}, updated_at = now() WHERE id = $${columns.length + 1}`,
      values.concat([member.application_id])
    );
  } else if (member.legacy_member_id) {
    const keep = columns.map((c, i) => [c, values[i]]).filter(([c]) => !NOT_IN_LEGACY.has(c));
    if (!keep.length) return;
    const sets = keep.map(([c], i) => `${c} = $${i + 1}`);
    await client.query(
      `UPDATE legacy_lifetime_members SET ${sets.join(', ')}, updated_at = now() WHERE id = $${keep.length + 1}`,
      keep.map(([, v]) => v).concat([member.legacy_member_id])
    );
  }
}

// Reads DETAIL_FIELDS from a request body -> { columns, values }.
// Validates sex, NIC, email, mobile when present.
function readDetails(body, { onlyPresent }) {
  const columns = [];
  const values = [];
  DETAIL_FIELDS.forEach(([key, col, label]) => {
    if (onlyPresent && !(key in body)) return;
    let value = clean(body[key]);
    if (value === '') value = null;
    if (value && DATE_COLUMNS.has(col) && !isDate(value)) throw M.badRequest(`${label} must be a valid date.`);
    if (col === 'sex' && value && !['Male', 'Female'].includes(value)) throw M.badRequest('Sex must be Male or Female.');
    if (col === 'nic_number' && value) {
      if (!isValidNic(value)) throw M.badRequest(INVALID_NIC_MESSAGE);
      value = normaliseNic(value);
    }
    if (col === 'email_address' && value) {
      value = value.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw M.badRequest('Please enter a valid email address.');
    }
    columns.push(col);
    values.push(value);
  });
  return { columns, values };
}

async function nicBelongsToOther(nic, memberId, client = pool) {
  if (!nic) return null;
  return (await client.query(
    `SELECT membership_number FROM members
      WHERE UPPER(REPLACE(nic_number, ' ', '')) = ANY($1) AND ($2::bigint IS NULL OR id <> $2) LIMIT 1`,
    [nicVariants(nic), memberId]
  )).rows[0] || null;
}

// ---------- Overview / numbers ----------

router.get('/overview', async (req, res, next) => {
  try {
    const settings = await M.loadSettings();
    const members = await loadMembers({}, settings);
    const pendingRenewals = (await pool.query("SELECT count(*)::int AS n FROM renewal_requests WHERE status = 'pending'")).rows[0].n;
    res.json({ success: true, members: countStates(members), pendingRenewals });
  } catch (err) {
    next(err);
  }
});

router.get('/next-number', async (req, res, next) => {
  try {
    const category = clean(req.query.category).toUpperCase();
    if (!M.CATEGORIES[category]) throw M.badRequest('Unknown category.');
    res.json({ success: true, category, membershipNumber: await M.suggestMembershipNumber(category) });
  } catch (err) {
    next(err);
  }
});

// ---------- Members ----------

router.get('/members', async (req, res, next) => {
  try {
    const settings = await M.loadSettings();
    const members = filterByState(await loadMembers(req.query, settings), clean(req.query.state));
    res.json({ success: true, members });
  } catch (err) {
    next(err);
  }
});

router.get('/members/counts', async (req, res, next) => {
  try {
    const settings = await M.loadSettings();
    res.json({ success: true, counts: countStates(await loadMembers(req.query, settings)) });
  } catch (err) {
    next(err);
  }
});

router.get('/members/:id', async (req, res, next) => {
  try {
    const row = await getMember(req.params.id);
    if (!row) return notFound(res);
    const settings = await M.loadSettings();
    const [renewals, reminders, previous] = await Promise.all([
      pool.query(
        `SELECT r.*, u.username AS reviewed_by_name FROM renewal_requests r
           LEFT JOIN users u ON u.id = r.reviewed_by
          WHERE r.member_id = $1 ORDER BY r.created_at DESC`,
        [row.id]
      ),
      pool.query('SELECT kind, period_key, status, detail, created_at FROM reminder_log WHERE member_id = $1 ORDER BY created_at DESC LIMIT 30', [row.id]),
      pool.query('SELECT membership_number, reason, retired_at FROM retired_membership_numbers WHERE member_id = $1 ORDER BY retired_at', [row.id]),
    ]);
    res.json({
      success: true,
      member: memberToJson(row, settings),
      renewals: renewals.rows.map(renewalToJson),
      reminders: reminders.rows.map((r) => ({ ...r, period_key: M.toDateString(r.period_key) })),
      previousNumbers: previous.rows,
      upgrades: M.UPGRADES[row.category],
    });
  } catch (err) {
    next(err);
  }
});

// Add a member by hand: source "manual" (accepted outside the online form,
// e.g. a paper form) or "legacy" (from the pre-digital records).
router.post('/members', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const source = clean(req.body.source) === 'legacy' ? 'legacy' : 'manual';
    // Legacy members come from the old lifetime roll: always Lifetime.
    const category = source === 'legacy' ? 'LT' : clean(req.body.category).toUpperCase() || 'LT';
    if (!M.CATEGORIES[category]) throw M.badRequest('Please choose a membership category.');

    const { columns, values } = readDetails(req.body, { onlyPresent: false });
    const get = (col) => values[columns.indexOf(col)];
    if (!get('name_with_initials')) throw M.badRequest('Name with initials is required.');
    if (!get('full_name')) values[columns.indexOf('full_name')] = get('name_with_initials');

    await client.query('BEGIN');
    const number = await M.checkMembershipNumber(req.body.membershipNumber, category, null, client);
    const clash = await nicBelongsToOther(get('nic_number'), null, client);
    if (clash) throw M.badRequest(`A member with this NIC already exists (${clash.membership_number}).`);

    const joinedOn = clean(req.body.joinedOn) || (source === 'manual' ? M.today() : null);
    if (joinedOn && !isDate(joinedOn)) throw M.badRequest('Member since must be a valid date.');
    let validUntil = null;
    if (M.isAnnual(category)) {
      validUntil = clean(req.body.validUntil) || (joinedOn ? M.addYear(joinedOn) : null);
      if (!validUntil || !isDate(validUntil)) {
        throw M.badRequest('Please enter "Valid until" (or "Member since") for a General or Associate member.');
      }
    }

    const allColumns = columns.concat(['membership_number', 'category', 'joined_on', 'category_since', 'valid_until', 'source', 'admin_note']);
    const allValues = values.concat([number, category, joinedOn, joinedOn, validUntil, source, clean(req.body.adminNote) || null]);
    const inserted = (await client.query(
      `INSERT INTO members (${allColumns.join(', ')}) VALUES (${allColumns.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING id`,
      allValues
    )).rows[0];
    await client.query('COMMIT');

    const settings = await M.loadSettings();
    res.status(201).json({ success: true, message: 'Member added.', member: memberToJson(await getMember(inserted.id), settings) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.put('/members/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const member = (await client.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!member) {
      await client.query('ROLLBACK');
      return notFound(res);
    }

    const { columns, values } = readDetails(req.body, { onlyPresent: true });
    const fullIdx = columns.indexOf('full_name');
    if (fullIdx >= 0 && !values[fullIdx]) throw M.badRequest('Full name is required.');
    const nicIdx = columns.indexOf('nic_number');
    if (nicIdx >= 0) {
      const clash = await nicBelongsToOther(values[nicIdx], member.id, client);
      if (clash) throw M.badRequest(`A member with this NIC already exists (${clash.membership_number}).`);
    }

    // Membership dates: joined_on for anyone, valid_until for annual members.
    const extraCols = [];
    const extraVals = [];
    if ('joinedOn' in req.body) {
      const v = clean(req.body.joinedOn) || null;
      if (v && !isDate(v)) throw M.badRequest('Member since must be a valid date.');
      extraCols.push('joined_on');
      extraVals.push(v);
    }
    if ('validUntil' in req.body && M.isAnnual(member.category)) {
      const v = clean(req.body.validUntil);
      if (!isDate(v)) throw M.badRequest('Valid until must be a valid date.');
      extraCols.push('valid_until');
      extraVals.push(v);
    }
    if ('adminNote' in req.body) {
      extraCols.push('admin_note');
      extraVals.push(clean(req.body.adminNote) || null);
    }

    const allCols = columns.concat(extraCols);
    const allVals = values.concat(extraVals);
    if (!allCols.length) throw M.badRequest('No fields to update were provided.');

    await client.query(
      `UPDATE members SET ${allCols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = $${allCols.length + 1}`,
      allVals.concat([member.id])
    );
    await mirrorToSource(client, member, columns, values);
    await client.query('COMMIT');

    const settings = await M.loadSettings();
    res.json({ success: true, member: memberToJson(await getMember(member.id), settings) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Deactivate: the member is emailed (if we have an email) and the secretary
// always is. The reason is internal: it goes to the secretary only.
router.post('/members/:id/deactivate', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const member = (await client.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!member) {
      await client.query('ROLLBACK');
      return notFound(res);
    }
    if (!member.is_active) throw M.badRequest('This member is already deactivated.');

    const reason = clean(req.body.reason) || null;
    const updated = (await client.query(
      `UPDATE members SET is_active = false, deactivated_at = now(), deactivated_by = $1,
              deactivated_reason = $2, updated_at = now() WHERE id = $3 RETURNING *`,
      [userId(req), reason, member.id]
    )).rows[0];
    await mirrorDeactivation(client, member, false, userId(req));
    await client.query('COMMIT');

    const notify = Boolean(updated.email_address);
    emails.memberDeactivated(updated);
    emails.secretaryMemberStatus(updated, { active: false, by: userName(req), reason, memberEmailed: notify });
    res.json({ success: true, message: 'Member deactivated.', memberEmailed: notify });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Reactivate. With kind = renewal | upgrade (and the payment fields) it
// also records that payment, all in one step (as in SLICNA). One email to
// the member (reactivated, with the payment if one was recorded) and one
// to the secretary.
router.post('/members/:id/reactivate', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const member = (await client.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!member) {
      await client.query('ROLLBACK');
      return notFound(res);
    }
    if (member.is_active) throw M.badRequest('This member is already active.');

    let current = (await client.query(
      `UPDATE members SET is_active = true, deactivated_at = NULL, deactivated_by = NULL,
              deactivated_reason = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [member.id]
    )).rows[0];
    await mirrorDeactivation(client, member, true, null);

    let request = null;
    if (clean(req.body.kind)) {
      const applied = await recordPayment(client, current, req.body, userId(req));
      current = applied.member;
      request = applied.request;
    }
    await client.query('COMMIT');

    const notify = Boolean(current.email_address);
    emails.memberReactivated(current, request);
    emails.secretaryMemberStatus(current, { active: true, by: userName(req), request, memberEmailed: notify });
    res.json({
      success: true,
      message: request ? 'Member reactivated and payment recorded.' : 'Member reactivated.',
      memberEmailed: notify,
      renewal: request ? renewalToJson(request) : null,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

async function mirrorDeactivation(client, member, active, by) {
  const table = member.application_id ? 'membership_applications' : member.legacy_member_id ? 'legacy_lifetime_members' : null;
  if (!table) return;
  await client.query(
    `UPDATE ${table} SET is_active = $1, deactivated_at = ${active ? 'NULL' : 'now()'},
            deactivated_by = $2, updated_at = now() WHERE id = $3`,
    [active, active ? null : by, member.application_id || member.legacy_member_id]
  );
}

router.post('/members/:id/renewal-link', async (req, res, next) => {
  try {
    const member = (await pool.query('SELECT * FROM members WHERE id = $1', [req.params.id])).rows[0];
    if (!member) return notFound(res);
    if (member.category === 'LT') throw M.badRequest('Lifetime members do not need to renew.');
    const url = M.renewalUrl(await M.createRenewalToken(member.id));

    let emailed = null;
    if (req.body.send_email === true || req.body.send_email === 'true') {
      if (!member.email_address) throw M.badRequest('This member has no email address on record.');
      const result = await emails.renewalLink(member, url);
      emailed = Boolean(result.sent);
    }
    res.json({ success: true, url, emailed });
  } catch (err) {
    next(err);
  }
});

// ---------- Renewals and upgrades ----------

function renewalToJson(r) {
  return {
    id: Number(r.id),
    memberId: Number(r.member_id),
    kind: r.kind,
    fromCategory: r.from_category,
    toCategory: r.to_category,
    toCategoryLabel: M.CATEGORIES[r.to_category],
    amount: Number(r.amount),
    discountAmount: Number(r.discount_amount),
    paymentDate: M.toDateString(r.payment_date),
    paymentReference: r.payment_reference,
    hasReceipt: Boolean(r.receipt_key),
    status: r.status,
    statusNote: r.status_note,
    emailAddress: r.email_address,
    mobileNumber: r.mobile_number,
    currentWorkingPlace: r.current_working_place,
    previousValidUntil: M.toDateString(r.previous_valid_until),
    newValidUntil: M.toDateString(r.new_valid_until),
    previousMembershipNumber: r.previous_membership_number,
    newMembershipNumber: r.new_membership_number,
    recordedByAdmin: r.recorded_by_admin,
    reviewedAt: r.reviewed_at,
    reviewedByName: r.reviewed_by_name || null,
    createdAt: r.created_at,
    // joined from members for the list
    membershipNumber: r.membership_number,
    memberName: r.full_name ? (r.name_with_initials || r.full_name) : undefined,
  };
}

// Applies a verified renewal / upgrade to the member (inside a transaction):
// extends validity, or moves to the new category with a new number (the old
// number is reserved), and copies any corrected contact details.
async function applyRenewal(client, member, request, { by, membershipNumber }) {
  const settings = await M.loadSettings(client);
  const updates = {};
  let newNumber = member.membership_number;

  if (request.kind === 'renewal') {
    updates.valid_until = M.renewedValidUntil(member, settings);
  } else {
    const to = request.to_category;
    newNumber = await M.checkMembershipNumber(
      clean(membershipNumber) || await M.suggestMembershipNumber(to, client), to, member.id, client
    );
    await client.query(
      `INSERT INTO retired_membership_numbers (membership_number, member_id, reason) VALUES ($1, $2, 'upgrade')
       ON CONFLICT DO NOTHING`,
      [member.membership_number, member.id]
    );
    updates.category = to;
    updates.membership_number = newNumber;
    updates.category_since = M.today();
    updates.valid_until = M.upgradedValidUntil(member, to, settings);
  }

  if (request.email_address) updates.email_address = request.email_address;
  if (request.mobile_number) updates.mobile_number = request.mobile_number;
  if (request.current_working_place) updates.current_working_place = request.current_working_place;

  const cols = Object.keys(updates);
  await client.query(
    `UPDATE members SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = $${cols.length + 1}`,
    cols.map((c) => updates[c]).concat([member.id])
  );

  // Contact details go to the original row too.
  const contactCols = ['email_address', 'mobile_number', 'current_working_place'].filter((c) => updates[c]);
  await mirrorToSource(client, member, contactCols, contactCols.map((c) => updates[c]));

  const verified = (await client.query(
    `UPDATE renewal_requests
        SET status = 'verified', status_note = coalesce($1, status_note), reviewed_by = $2, reviewed_at = now(),
            new_valid_until = $3, previous_membership_number = $4, new_membership_number = $5
      WHERE id = $6 RETURNING *`,
    [request.status_note || null, by, updates.valid_until || null, member.membership_number, newNumber, request.id]
  )).rows[0];

  const updatedMember = (await client.query('SELECT * FROM members WHERE id = $1', [member.id])).rows[0];
  return { request: verified, member: updatedMember };
}

// Records a payment made offline (cash / bank transfer told to the office)
// for `member` inside the caller's transaction; verified straight away.
// An Associate upgrading to General / Lifetime also gives their work
// details, saved to the member record. Returns { request, member }.
async function recordPayment(client, member, body, by) {
  const kind = clean(body.kind);
  if (!['renewal', 'upgrade'].includes(kind)) throw M.badRequest('Please choose renewal or upgrade.');
  if (kind === 'renewal' && member.category === 'LT') throw M.badRequest('Lifetime members do not need to renew.');
  const to = kind === 'upgrade' ? clean(body.to_category).toUpperCase() : member.category;
  if (kind === 'upgrade' && !M.UPGRADES[member.category].includes(to)) throw M.badRequest('This member cannot be upgraded to that category.');

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) throw M.badRequest('Please enter the amount paid.');
  const paymentDate = clean(body.payment_date);
  if (!isDate(paymentDate)) throw M.badRequest('Please enter the payment date.');

  const pending = (await client.query("SELECT 1 FROM renewal_requests WHERE member_id = $1 AND status = 'pending'", [member.id])).rows[0];
  if (pending) throw M.badRequest('This member has a renewal waiting to be verified. Please review that first (Renewals).');

  if (M.needsWorkDetails(member, kind, to)) {
    await M.saveWorkDetails(client, member, M.readWorkDetails(body));
  }

  const [fees, settings] = await Promise.all([M.loadFees(client), M.loadSettings(client)]);
  const discount = kind === 'upgrade' ? M.upgradeQuote(member, to, fees, settings).discount : 0;

  const request = (await client.query(
    `INSERT INTO renewal_requests (member_id, kind, from_category, to_category, amount, discount_amount,
       payment_reference, payment_date, status_note, previous_valid_until, recorded_by_admin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true) RETURNING *`,
    [member.id, kind, member.category, to, amount, discount,
      clean(body.payment_reference) || M.paymentReference(member), paymentDate,
      clean(body.status_note) || null, member.valid_until]
  )).rows[0];

  return applyRenewal(client, member, request, { by, membershipNumber: body.membership_number });
}

router.post('/members/:id/payments', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const member = (await client.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!member) {
      await client.query('ROLLBACK');
      return notFound(res);
    }
    if (!member.is_active) throw M.badRequest('Reactivate this member before recording a payment.');

    const applied = await recordPayment(client, member, req.body, userId(req));
    await client.query('COMMIT');

    emails.renewalReviewed(applied.member, applied.request);
    emails.secretaryRenewalVerified(applied.member, applied.request, userName(req));
    res.status(201).json({ success: true, message: 'Payment recorded.', renewal: renewalToJson(applied.request) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.get('/renewals', async (req, res, next) => {
  try {
    const status = clean(req.query.status) || 'pending';
    const params = [];
    let where = '';
    if (['pending', 'verified', 'rejected'].includes(status)) {
      params.push(status);
      where = 'WHERE r.status = $1';
    }
    const rows = (await pool.query(
      `SELECT r.*, m.membership_number, m.full_name, m.name_with_initials, u.username AS reviewed_by_name
         FROM renewal_requests r
         JOIN members m ON m.id = r.member_id
         LEFT JOIN users u ON u.id = r.reviewed_by
         ${where}
        ORDER BY r.created_at DESC LIMIT 300`,
      params
    )).rows;
    res.json({ success: true, renewals: rows.map(renewalToJson) });
  } catch (err) {
    next(err);
  }
});

router.get('/renewals/counts', async (req, res, next) => {
  try {
    const rows = (await pool.query('SELECT status, count(*)::int AS n FROM renewal_requests GROUP BY status')).rows;
    const counts = { pending: 0, verified: 0, rejected: 0, all: 0 };
    rows.forEach((r) => { counts[r.status] = r.n; counts.all += r.n; });
    res.json({ success: true, counts });
  } catch (err) {
    next(err);
  }
});

router.get('/renewals/:id/receipt', async (req, res, next) => {
  try {
    const row = (await pool.query('SELECT receipt_key, receipt_original_name FROM renewal_requests WHERE id = $1', [req.params.id])).rows[0];
    if (!row || !row.receipt_key) return notFound(res, 'Payment slip');
    if (!row.receipt_key.startsWith(RECEIPT_PREFIX) || row.receipt_key.includes('..')) {
      return res.status(400).json({ success: false, error: 'Invalid stored file.' });
    }
    let object;
    try {
      object = await getPrivateObject(row.receipt_key);
    } catch (error) {
      if (isNotFoundError(error)) return notFound(res, 'Payment slip file');
      throw error;
    }
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (object.ContentType) res.setHeader('Content-Type', object.ContentType);
    res.setHeader('Content-Disposition', `inline; filename="${String(row.receipt_original_name || 'payment-slip').replace(/[^a-zA-Z0-9._-]/g, '-')}"`);
    return object.Body.pipe(res);
  } catch (err) {
    return next(err);
  }
});

router.patch('/renewals/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const status = clean(req.body.status);
    if (!['verified', 'rejected'].includes(status)) throw M.badRequest('Please choose verify or reject.');

    await client.query('BEGIN');
    const request = (await client.query('SELECT * FROM renewal_requests WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return notFound(res, 'Renewal');
    }
    if (request.status !== 'pending') throw M.badRequest('This renewal has already been reviewed.');
    const member = (await client.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [request.member_id])).rows[0];

    let result;
    if (status === 'rejected') {
      const note = clean(req.body.status_note);
      if (!note) throw M.badRequest('Please give a reason (it is emailed to the member).');
      const rejected = (await client.query(
        `UPDATE renewal_requests SET status = 'rejected', status_note = $1, reviewed_by = $2, reviewed_at = now()
          WHERE id = $3 RETURNING *`,
        [note, userId(req), request.id]
      )).rows[0];
      result = { request: rejected, member };
    } else {
      if (!member.is_active) throw M.badRequest('Reactivate this member before verifying the renewal.');
      request.status_note = clean(req.body.status_note) || request.status_note;
      result = await applyRenewal(client, member, request, { by: userId(req), membershipNumber: req.body.membership_number });
    }
    await client.query('COMMIT');

    emails.renewalReviewed(result.member, result.request);
    if (status === 'verified') emails.secretaryRenewalVerified(result.member, result.request, userName(req));
    res.json({ success: true, renewal: renewalToJson(result.request) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ---------- Settings and reminders ----------

router.get('/settings', async (req, res, next) => {
  try {
    const settings = await M.loadSettings();
    res.json({
      success: true,
      graceDays: settings.graceDays,
      noticeDays: settings.noticeDays,
      upgradeDiscounts: settings.upgradeDiscounts,
      upgradePaths: Object.entries(M.UPGRADES).flatMap(([from, tos]) => tos.map((to) => ({
        key: `${from}-${to}`, from, to, label: `${M.CATEGORIES[from]} → ${M.CATEGORIES[to]}`,
      }))),
      emailEnabled: String(process.env.EMAIL_ENABLED || '').trim().toLowerCase() !== 'false' && Boolean(process.env.RESEND_API_KEY),
    });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', async (req, res, next) => {
  try {
    const updates = [];
    if ('graceDays' in req.body) {
      const v = Number(req.body.graceDays);
      if (!Number.isInteger(v) || v < 0 || v > 365) throw M.badRequest('Grace period must be between 0 and 365 days.');
      updates.push(['grace_days', v]);
    }
    if ('noticeDays' in req.body) {
      const v = Number(req.body.noticeDays);
      if (!Number.isInteger(v) || v < 7 || v > 90) throw M.badRequest('Renewal notice must be between 7 and 90 days.');
      updates.push(['notice_days', v]);
    }
    if ('upgradeDiscounts' in req.body) {
      updates.push(['upgrade_discounts', M.cleanDiscounts(req.body.upgradeDiscounts)]);
    }
    for (const [key, value] of updates) {
      await pool.query(
        `INSERT INTO membership_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)]
      );
    }
    const settings = await M.loadSettings();
    res.json({ success: true, message: 'Settings saved.', graceDays: settings.graceDays, noticeDays: settings.noticeDays, upgradeDiscounts: settings.upgradeDiscounts });
  } catch (err) {
    next(err);
  }
});

router.post('/reminders/run', async (req, res, next) => {
  try {
    res.json({ success: true, summary: await runReminders() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
// Used by the Excel export (routes/member-directory.js).
module.exports.loadMembers = loadMembers;
module.exports.filterByState = filterByState;
