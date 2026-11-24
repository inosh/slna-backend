// lib/reminders.js
// Daily renewal reminders for annual members (General, Associate). For each
// member it works out the single most urgent reminder that is due and has
// not been sent for the current membership period, sends it with a fresh
// renewal link, and logs the attempt in reminder_log. Safe to run more than
// once a day. Ported from SLICNA.
//
//   notice_30     up to "notice days" (default 30) before expiry
//   notice_7      7 days or less before expiry
//   expired       expired, now in the grace period
//   grace_ending  14 days or less left in the grace period
//   lapsed        grace period over (only within 30 days of lapsing)
//
// Members with a pending renewal, deactivated members and Lifetime members
// are skipped.

const pool = require('../db/pool');
const M = require('./membership');
const emails = require('./membership-emails');

function dueReminder(validUntil, settings, on) {
  const daysLeft = M.daysBetween(on, validUntil);
  const graceEnd = M.addDays(validUntil, settings.graceDays);
  const graceLeft = M.daysBetween(on, graceEnd);

  if (daysLeft < 0 && graceLeft < 0) return graceLeft >= -30 ? 'lapsed' : null;
  if (daysLeft < 0) return graceLeft <= 14 ? 'grace_ending' : 'expired';
  if (daysLeft <= 7) return 'notice_7';
  if (daysLeft <= settings.noticeDays) return 'notice_30';
  return null;
}

async function runReminders({ on = M.today() } = {}) {
  const settings = await M.loadSettings();
  const members = (await pool.query(
    `SELECT m.* FROM members m
      WHERE m.is_active AND m.category <> 'LT' AND m.valid_until IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM renewal_requests r WHERE r.member_id = m.id AND r.status = 'pending')`
  )).rows;

  const summary = { checked: members.length, sent: 0, skipped: 0, failed: 0, details: [] };

  for (const member of members) {
    const validUntil = M.toDateString(member.valid_until);
    const kind = dueReminder(validUntil, settings, on);
    if (!kind) continue;

    const alreadySent = (await pool.query(
      "SELECT 1 FROM reminder_log WHERE member_id = $1 AND kind = $2 AND period_key = $3 AND status = 'sent'",
      [member.id, kind, validUntil]
    )).rows[0];
    if (alreadySent) continue;

    // Skipped / failed attempts are logged once per day, not every run.
    const triedToday = (await pool.query(
      `SELECT 1 FROM reminder_log
        WHERE member_id = $1 AND kind = $2 AND period_key = $3 AND status <> 'sent'
          AND (created_at AT TIME ZONE 'Asia/Colombo')::date = $4::date`,
      [member.id, kind, validUntil, on]
    )).rows[0];
    if (triedToday) continue;

    let result;
    if (!member.email_address) {
      result = { status: 'skipped', detail: 'No email address on record' };
    } else {
      const token = await M.createRenewalToken(member.id);
      const graceEnd = M.addDays(validUntil, settings.graceDays);
      const mail = await emails.renewalReminder(kind, member, M.renewalUrl(token), graceEnd);
      result = mail.sent
        ? { status: 'sent', detail: null }
        : mail.error
          ? { status: 'failed', detail: String(mail.error.message || mail.error).slice(0, 300) }
          : { status: 'skipped', detail: 'Email sending is turned off or not configured' };
    }

    await pool.query(
      'INSERT INTO reminder_log (member_id, kind, period_key, status, detail) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [member.id, kind, validUntil, result.status, result.detail]
    );
    summary[result.status] += 1;
    summary.details.push({ membershipNumber: member.membership_number, kind, status: result.status, detail: result.detail });
  }

  return summary;
}

module.exports = { runReminders, dueReminder };
