// lib/mail.js
// Thin wrapper around nodemailer. For now (before the slna.lk domain and a
// real transactional provider are set up) this sends through a Gmail
// account via an App Password. When that changes, only the transport built
// here needs to change -- callers just use sendMail().

const dns = require('dns');
const nodemailer = require('nodemailer');

const SMTP_HOST = 'smtp.gmail.com';

const FROM_NAME = process.env.MAIL_FROM_NAME || 'SLNA';
const FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS || process.env.GMAIL_USER;

// Secretary notification recipient and the frontend base URL used to build
// the admin-login link in those notifications. Both come from .env since
// neither exists yet (no slna.lk domain, no deployed frontend URL) -- leave
// them blank to skip the secretary email / omit the link.
const SECRETARY_EMAIL = process.env.SECRETARY_EMAIL || '';
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

// nodemailer resolves a hostname's A/AAAA records itself and picks a
// RANDOM address from the combined list -- it ignores dns.setDefaultResultOrder
// and any `family` transport option. On a host with no IPv6 route (Railway),
// that means roughly half of all sends fail with ENETUNREACH. Resolving the
// A record ourselves and handing nodemailer a literal IPv4 address sidesteps
// its resolver entirely (it only resolves when `host` isn't already an IP).
async function resolveSmtpIPv4() {
  const addresses = await dns.promises.resolve4(SMTP_HOST);
  return addresses[Math.floor(Math.random() * addresses.length)];
}

async function createTransporter() {
  const ip = await resolveSmtpIPv4();

  return nodemailer.createTransport({
    host: ip,
    port: 465,
    secure: true,
    tls: {
      // Connecting by IP means the cert hostname check needs an explicit
      // servername -- otherwise it fails validation against the raw IP.
      servername: SMTP_HOST,
    },
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

// Resolves even when mail isn't configured or sending fails -- a
// notification email must never block or fail the request that triggered it.
async function sendMail({ to, subject, text, html }) {
  if (!EMAIL_ENABLED) {
    console.warn(`[mail] EMAIL_ENABLED=false -- skipped email to ${to} ("${subject}").`);
    return { sent: false };
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn(`[mail] GMAIL_USER/GMAIL_APP_PASSWORD not configured -- skipped email to ${to} ("${subject}").`);
    return { sent: false };
  }

  try {
    const transporter = await createTransporter();

    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
      to,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (error) {
    console.error(`[mail] Failed to send email to ${to}:`, error.message);
    return { sent: false, error };
  }
}

module.exports = { sendMail, SECRETARY_EMAIL, ADMIN_LOGIN_URL, CONTACT_LINE };
