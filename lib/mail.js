// lib/mail.js
// Thin wrapper around Resend. Callers just use sendMail() -- if the
// provider ever changes again, only the client call here needs to change.

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const MAIL_FROM = process.env.MAIL_FROM || 'noreply@slna.lk';

// Secretary notification recipient(s) and the frontend base URL used to
// build the admin-login link in those notifications. SECRETARY_EMAIL may be
// a single address or a comma-separated list. Leave it blank to skip the
// secretary email entirely; leave SITE_URL blank to omit the link.
const SECRETARY_EMAIL = (process.env.SECRETARY_EMAIL || '')
  .split(',')
  .map((email) => email.trim())
  .filter(Boolean);
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
const ADMIN_LOGIN_URL = SITE_URL ? `${SITE_URL}/pages/admin-login.html` : '/pages/admin-login.html';

// Master switch for all outgoing email. Defaults to enabled; set
// EMAIL_ENABLED=false (also accepts "0"/"no"/"off", any case) to turn off
// sending entirely (e.g. in environments without mail credentials, or to
// mute notifications during testing).
const DISABLED_VALUES = new Set(['false', '0', 'no', 'off']);
const EMAIL_ENABLED = !DISABLED_VALUES.has((process.env.EMAIL_ENABLED || '').trim().toLowerCase());

// Reused in rejection / more-information emails so the recipient has a way
// to ask questions beyond just "submit again" (matches the published
// contact details in partials/header.html).
const CONTACT_LINE = 'If you have any questions, please contact SLNA at +94 112 693 662, +94 713 385 768 or info@slna.lk.';

// Resolves even when mail isn't configured or sending fails -- a
// notification email must never block or fail the request that triggered it.
async function sendMail({ to, subject, text, html }) {
  if (!EMAIL_ENABLED) {
    console.warn(`[mail] EMAIL_ENABLED=false -- skipped email to ${to} ("${subject}").`);
    return { sent: false };
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn(`[mail] RESEND_API_KEY not configured -- skipped email to ${to} ("${subject}").`);
    return { sent: false };
  }

  try {
    const { error } = await resend.emails.send({
      from: MAIL_FROM,
      to,
      subject,
      text,
      html,
    });

    if (error) throw new Error(error.message || JSON.stringify(error));

    return { sent: true };
  } catch (error) {
    console.error(`[mail] Failed to send email to ${to}:`, error.message);
    return { sent: false, error };
  }
}

module.exports = { sendMail, SECRETARY_EMAIL, ADMIN_LOGIN_URL, CONTACT_LINE };
