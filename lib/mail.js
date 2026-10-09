// lib/mail.js
// Thin wrapper around nodemailer. For now (before the slna.lk domain and a
// real transactional provider are set up) this sends through a Gmail
// account via an App Password. When that changes, only the transport built
// here needs to change -- callers just use sendMail().

const dns = require('dns');
const nodemailer = require('nodemailer');

// Without this, Node resolves smtp.gmail.com's AAAA (IPv6) record first.
// Railway (and many container hosts) have no IPv6 egress, so that connect
// fails with ENETUNREACH before ever falling back to IPv4. Preferring IPv4
// results avoids that outright.
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const FROM_NAME = process.env.MAIL_FROM_NAME || 'SLNA';
const FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS || process.env.GMAIL_USER;

// Secretary notification recipient and the frontend base URL used to build
// the admin-login link in those notifications. Both come from .env since
// neither exists yet (no slna.lk domain, no deployed frontend URL) -- leave
// them blank to skip the secretary email / omit the link.
const SECRETARY_EMAIL = process.env.SECRETARY_EMAIL || '';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
const ADMIN_LOGIN_URL = SITE_URL ? `${SITE_URL}/pages/admin-login.html` : '/pages/admin-login.html';

// Reused in rejection / more-information emails so the recipient has a way
// to ask questions beyond just "submit again" (matches the published
// contact details in partials/header.html).
const CONTACT_LINE = 'If you have any questions, please contact SLNA at +94 112 693 662, +94 713 385 768 or info@slna.lk.';

let transporter = null;

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    family: 4,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  return transporter;
}

// Resolves even when mail isn't configured or sending fails -- a
// notification email must never block or fail the request that triggered it.
async function sendMail({ to, subject, text, html }) {
  const activeTransporter = getTransporter();

  if (!activeTransporter) {
    console.warn(`[mail] GMAIL_USER/GMAIL_APP_PASSWORD not configured -- skipped email to ${to} ("${subject}").`);
    return { sent: false };
  }

  try {
    await activeTransporter.sendMail({
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
