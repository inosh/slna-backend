// lib/membership.js
// Membership rules shared by the public and admin routes and the reminder
// job: categories, dates, a member's current state, membership numbers,
// fees (with the upgrade loyalty discount) and renewal tokens.
// Ported from SLICNA's lib/membership.js, adapted to SLNA's categories
// (Lifetime, General, Associate) and numbering ("LT 2200", "GM 0001", "AM 0001").

const crypto = require('crypto');
const pool = require('../db/pool');

const CATEGORIES = {
  LT: 'Lifetime Membership',
  GM: 'General Membership',
  AM: 'Associate Membership',
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);

// membership_applications.membership_type and membership_fee_settings.key
// use words; members.category uses the codes.
const TYPE_TO_CATEGORY = { lifetime: 'LT', general: 'GM', associate: 'AM' };
const CATEGORY_TO_TYPE = { LT: 'lifetime', GM: 'general', AM: 'associate' };

const isAnnual = (category) => category !== 'LT';

// Upgrades open to each category. An upgrade gives a number in the new
// category's series (the old one stays reserved); General then runs for 12
// months like a renewal, Lifetime never expires.
const UPGRADES = { AM: ['GM', 'LT'], GM: ['LT'], LT: [] };

const STATE_LABELS = {
  active: 'Active',
  renewal_due: 'Renewal due',
  grace: 'Grace period',
  lapsed: 'Lapsed',
  deactivated: 'Deactivated',
};

// ---------- Dates (all as "YYYY-MM-DD" strings, Sri Lanka time) ----------

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// A date or timestamp from Postgres -> "YYYY-MM-DD" (Sri Lanka time).
function toDateString(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const toUtc = (dateStr) => new Date(dateStr + 'T00:00:00Z');
const fromUtc = (d) => d.toISOString().slice(0, 10);

function addDays(dateStr, days) {
  const d = toUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

// One year later; 29 Feb becomes 28 Feb in a non-leap year.
function addYear(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

function daysBetween(fromStr, toStr) {
  return Math.round((toUtc(toStr) - toUtc(fromStr)) / 86400000);
}

// Whole years from one date to another ("2023-05-10" -> "2026-05-09" is 2).
function completedYears(fromStr, toStr) {
  if (!fromStr || !toStr || toStr < fromStr) return 0;
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return Math.max(0, years);
}

// ---------- Settings and fees ----------

// Loyalty discount tiers per upgrade path, e.g.
//   { "GM-LT": [{ "years": 3, "amount": 1000 }, { "years": 5, "amount": 2000 }] }
// "years" = completed years as a member of the current category.
function cleanDiscounts(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  Object.entries(UPGRADES).forEach(([from, targets]) => {
    targets.forEach((to) => {
      const tiers = Array.isArray(value[`${from}-${to}`]) ? value[`${from}-${to}`] : [];
      const cleaned = tiers
        .map((t) => ({ years: Math.floor(Number(t.years)), amount: Math.round(Number(t.amount) * 100) / 100 }))
        .filter((t) => Number.isFinite(t.years) && t.years >= 1 && t.years <= 60 && Number.isFinite(t.amount) && t.amount > 0)
        .sort((a, b) => a.years - b.years);
      if (cleaned.length) out[`${from}-${to}`] = cleaned;
    });
  });
  return out;
}

async function loadSettings(client = pool) {
  const rows = (await client.query('SELECT key, value FROM membership_settings')).rows;
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    graceDays: num(s.grace_days, 30),
    noticeDays: num(s.notice_days, 30),
    upgradeDiscounts: cleanDiscounts(s.upgrade_discounts),
  };
}

// { LT: { category, label, amount, is_annual }, GM: ..., AM: ... }
async function loadFees(client = pool) {
  const rows = (await client.query(
    "SELECT key, label, amount, is_tba FROM membership_fee_settings WHERE key IN ('lifetime', 'general', 'associate')"
  )).rows;
  const fees = {};
  rows.forEach((r) => {
    const category = TYPE_TO_CATEGORY[r.key];
    fees[category] = {
      category,
      label: CATEGORIES[category],
      amount: r.is_tba ? null : Number(r.amount),
      is_annual: isAnnual(category),
    };
  });
  return fees;
}

// ---------- Member state ----------

// active | renewal_due | grace | lapsed | deactivated, worked out from the
// dates so that lapsing needs no scheduled job.
function memberState(member, settings, on = today()) {
  if (!member.is_active) return 'deactivated';
  const validUntil = toDateString(member.valid_until);
  if (member.category === 'LT' || !validUntil) return 'active';
  if (on <= validUntil) {
    return daysBetween(on, validUntil) <= settings.noticeDays ? 'renewal_due' : 'active';
  }
  return on <= addDays(validUntil, settings.graceDays) ? 'grace' : 'lapsed';
}

// Members in these states get member treatment (e.g. renewal not yet overdue).
const IN_GOOD_STANDING = ['active', 'renewal_due', 'grace'];

function graceEnds(member, settings) {
  const validUntil = toDateString(member.valid_until);
  return validUntil ? addDays(validUntil, settings.graceDays) : null;
}

// Validity after a renewal is verified on `on`: renewing before the end of
// the grace period continues from the old expiry date (no lost or free
// days); renewing after lapsing starts a fresh year from that day.
function renewedValidUntil(member, settings, on = today()) {
  const validUntil = toDateString(member.valid_until);
  if (!validUntil) return addYear(on);
  const graceEnd = addDays(validUntil, settings.graceDays);
  return on <= graceEnd ? addYear(validUntil) : addYear(on);
}

// Valid until after an upgrade to `toCategory`: same as a renewal, or none
// for Lifetime.
function upgradedValidUntil(member, toCategory, settings, on = today()) {
  return toCategory === 'LT' ? null : renewedValidUntil(member, settings, on);
}

// ---------- Fees for renewals and upgrades ----------

// Renewal: the member's own category fee.
function renewalFee(member, fees) {
  const fee = fees[member.category];
  return fee ? fee.amount : null;
}

// Upgrade: the full fee of the new category, less the best loyalty
// discount tier the member qualifies for (years in the current category).
// Returns { amount, base, discount, years } (amount null if the fee is TBA).
function upgradeQuote(member, toCategory, fees, settings, on = today()) {
  const base = fees[toCategory] ? fees[toCategory].amount : null;
  const since = toDateString(member.category_since || member.joined_on);
  const years = completedYears(since, on);
  const tiers = settings.upgradeDiscounts[`${member.category}-${toCategory}`] || [];
  const tier = tiers.filter((t) => years >= t.years).pop();
  const discount = base === null || !tier ? 0 : Math.min(tier.amount, base);
  return {
    amount: base === null ? null : Math.max(0, base - discount),
    base,
    discount,
    years,
  };
}

// ---------- Membership numbers: "LT 2200", "GM 0001", "AM 0001" ----------

// Every category uses at least four digits: "GM 0001", "AM 0012",
// "LT 0085", "LT 2200".
function formatMembershipNumber(category, serial) {
  return `${category} ${String(serial).padStart(4, '0')}`;
}

// For comparing numbers: "lt 0012", "LT12" and "LT 12" are equal, and a
// bare number is a Lifetime number ("2085" = "LT 2085" = "LT2085"), since
// old legacy numbers were stored without the "LT " prefix.
function compactNumber(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    .replace(/^(\d)/, 'LT$1')
    .replace(/^([A-Z]+)0+(\d)/, '$1$2');
}

const COMPACT_SQL = (col) =>
  `regexp_replace(regexp_replace(regexp_replace(upper(${col}), '[^A-Z0-9]', '', 'g'), '^([0-9])', 'LT\\1'), '^([A-Z]+)0+([0-9])', '\\1\\2')`;

// Next free number in the category's series ("GM n"). Lifetime continues the
// existing "LT n" sequence. Numbers retired on an upgrade count as used, so
// they are never handed out again.
async function suggestMembershipNumber(category, client = pool) {
  const prefix = category.toUpperCase();
  const pattern = `^${prefix}\\s*0*([0-9]+)$`;
  const { rows: [row] } = await client.query(
    `SELECT COALESCE(MAX((substring(n FROM '${pattern}'))::int), 0) AS max
       FROM (
         SELECT upper(trim(membership_number)) AS n FROM members
         UNION ALL SELECT upper(trim(membership_number)) FROM retired_membership_numbers
         UNION ALL SELECT upper(trim(membership_number)) FROM membership_applications WHERE membership_number IS NOT NULL
         UNION ALL SELECT upper(trim(membership_number)) FROM legacy_lifetime_members
       ) all_numbers
      WHERE n ~ '${pattern}'`
  );
  let next = Number(row.max) + 1;
  // Paranoia: skip anything already taken in another spelling.
  for (let i = 0; i < 50; i += 1) {
    const candidate = formatMembershipNumber(prefix, next);
    if (!(await numberTaken(candidate, null, client))) return candidate;
    next += 1;
  }
  return formatMembershipNumber(prefix, next);
}

// Is this number used by another member, or retired after an upgrade
// (unless retired by this same member)? Old legacy and application rows are
// all in members after the migration, so members covers them.
async function numberTaken(number, memberId = null, client = pool) {
  const compact = compactNumber(number);
  const { rows: [row] } = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM members WHERE ${COMPACT_SQL('membership_number')} = $1 AND ($2::bigint IS NULL OR id <> $2)) AS member,
       EXISTS (SELECT 1 FROM retired_membership_numbers WHERE ${COMPACT_SQL('membership_number')} = $1 AND ($2::bigint IS NULL OR member_id IS DISTINCT FROM $2)) AS retired`,
    [compact, memberId]
  );
  return row.member || row.retired;
}

// Checks an admin-typed number for a member of `category`. Throws a 400
// with a clear message, or returns the cleaned number.
async function checkMembershipNumber(number, category, memberId = null, client = pool) {
  let cleaned = String(number || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) throw badRequest('Please enter a membership number.');
  if (category !== 'LT') {
    const match = new RegExp(`^${category}\\s*(\\d+)$`, 'i').exec(cleaned);
    if (!match) throw badRequest(`A ${CATEGORIES[category]} number must look like "${category} 0012".`);
    // "GM 12" is saved as "GM 0012".
    cleaned = formatMembershipNumber(category, Number(match[1]));
  }
  if (category === 'LT' && /^(GM|AM)\b/i.test(cleaned)) {
    throw badRequest('A Lifetime membership number must not start with GM or AM.');
  }
  if (category === 'LT') {
    // "85", "2085" or "LT 85" -> "LT 0085" / "LT 2085". Old letter formats
    // from the paper records ("G 23", "K 293/LT 1994") are kept as typed.
    const match = /^(?:LT\s*)?(\d+)$/i.exec(cleaned);
    if (match) cleaned = formatMembershipNumber('LT', Number(match[1]));
  }
  if (await numberTaken(cleaned, memberId, client)) {
    throw badRequest(`Membership number ${cleaned} is already used (or reserved after an upgrade). Please use another number.`);
  }
  return cleaned.toUpperCase();
}

// The member with this membership number (current or retired after an
// upgrade), or null.
async function findMemberByNumber(value, client = pool) {
  const compact = compactNumber(value);
  if (!compact) return null;
  const member = (await client.query(`SELECT * FROM members WHERE ${COMPACT_SQL('membership_number')} = $1`, [compact])).rows[0];
  if (member) return member;
  const retired = (await client.query(
    `SELECT m.* FROM retired_membership_numbers r JOIN members m ON m.id = r.member_id
      WHERE ${COMPACT_SQL('r.membership_number')} = $1 LIMIT 1`,
    [compact]
  )).rows[0];
  return retired || null;
}

// ---------- Work details on an Associate upgrade ----------
// Associates (students) apply without job details. Upgrading to General or
// Lifetime (registered nurses) asks for them; they are saved to the member
// straight away (and to the original application row). SLNC registration
// is optional, as on the join form.
const WORK_FIELDS = [
  // [bodyKey, column, label, required, isDate]
  ['currentWorkingPlace', 'current_working_place', 'Current working place', true, false],
  ['officialAddress', 'official_address', 'Official address', true, false],
  ['designation', 'designation', 'Designation', true, false],
  ['firstAppointmentDate', 'first_appointment_date', 'First appointment date', true, true],
  ['firstAppointmentPlace', 'first_appointment_place', 'First appointment place', true, false],
  ['slncRegistrationNumber', 'slnc_registration_number', 'SLNC registration number', false, false],
  ['slncRegistrationDate', 'slnc_registration_date', 'SLNC registration date', false, true],
];

const needsWorkDetails = (member, kind, toCategory) =>
  kind === 'upgrade' && member.category === 'AM' && (toCategory === 'GM' || toCategory === 'LT');

// Reads and checks the work fields -> { columns, values }. Throws a 400.
function readWorkDetails(body) {
  const columns = [];
  const values = [];
  WORK_FIELDS.forEach(([key, column, label, required, isDate]) => {
    const raw = body[key] !== undefined ? body[key] : body[column];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (required && !value) throw badRequest(`${label} is required for General or Lifetime membership.`);
    if (value && isDate && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today())) {
      throw badRequest(`${label} must be a valid date (not in the future).`);
    }
    columns.push(column);
    values.push(value || null);
  });
  return { columns, values };
}

// Saves the work fields to the member and its original application row.
async function saveWorkDetails(client, member, details) {
  const { columns, values } = details;
  const sets = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
  await client.query(`UPDATE members SET ${sets}, updated_at = now() WHERE id = $${columns.length + 1}`, values.concat([member.id]));
  if (member.application_id) {
    await client.query(
      `UPDATE membership_applications SET ${sets}, updated_at = now() WHERE id = $${columns.length + 1}`,
      values.concat([member.application_id])
    );
  }
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// ---------- Renewal tokens ----------

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Creates a renewal link token for a member; only its hash is stored.
// viaLookup: made from a membership number typed on the renewal page, so
// the page masks the member's contact details.
async function createRenewalToken(memberId, validDays = 90, client = pool, { viaLookup = false } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  await client.query(
    `INSERT INTO renewal_tokens (member_id, token_hash, expires_at, via_lookup)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, $4)`,
    [memberId, hashToken(token), String(validDays), viaLookup]
  );
  return token;
}

// The member, plus via_lookup from the token.
async function memberForToken(token, client = pool) {
  if (!token || String(token).length < 20) return null;
  const row = (await client.query(
    `SELECT m.*, t.via_lookup FROM renewal_tokens t JOIN members m ON m.id = t.member_id
      WHERE t.token_hash = $1 AND t.expires_at > now()`,
    [hashToken(token)]
  )).rows[0];
  return row || null;
}

function siteUrl() {
  return (process.env.SITE_URL || '').replace(/\/+$/, '');
}

function renewalUrl(token) {
  return `${siteUrl()}/pages/renew-membership.html?t=${encodeURIComponent(token)}`;
}

// e.g. "GM12-2611" (number + year + month) for the bank transfer reference.
function paymentReference(member, on = today()) {
  return `${compactNumber(member.membership_number)}-${on.slice(2, 4)}${on.slice(5, 7)}`;
}

module.exports = {
  CATEGORIES, CATEGORY_KEYS, TYPE_TO_CATEGORY, CATEGORY_TO_TYPE, UPGRADES, STATE_LABELS, IN_GOOD_STANDING,
  isAnnual, today, toDateString, addDays, addYear, daysBetween, completedYears,
  cleanDiscounts, loadSettings, loadFees,
  memberState, graceEnds, renewedValidUntil, upgradedValidUntil, renewalFee, upgradeQuote,
  compactNumber, COMPACT_SQL, formatMembershipNumber, suggestMembershipNumber, numberTaken, checkMembershipNumber, findMemberByNumber,
  WORK_FIELDS, needsWorkDetails, readWorkDetails, saveWorkDetails,
  badRequest, createRenewalToken, memberForToken, siteUrl, renewalUrl, paymentReference,
};
