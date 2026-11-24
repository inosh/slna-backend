// lib/membership-emails.js
// Emails for renewals, upgrades and reminders (Ordinary and Associate
// memberships). Application emails stay in routes/membership-applications.js.
// Every function returns a promise from sendMail, which never throws and
// does nothing when EMAIL_ENABLED=false.

const M = require('./membership');
const { sendMail, SECRETARY_EMAIL, ADMIN_LOGIN_URL, contactDetails } = require('./mail');

const SIGN_OFF = 'Regards,\nSri Lanka Nurses Association';

// "2027-11-24" -> "24 November 2027"
function fmt(value) {
  const dateStr = M.toDateString(value);
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

const money = (n) => 'LKR ' + Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nameOf = (member) => member.name_with_initials || member.full_name;
// "an Ordinary", "an Associate", "a Lifetime"
const withArticle = (word) => (/^[aeiou]/i.test(word) ? 'an ' : 'a ') + word;
const validityLine = (member) => (member.valid_until ? `Valid until: ${fmt(member.valid_until)}` : 'Valid for life');
const renewPage = () => `${M.siteUrl()}/pages/renew-membership.html`;

function contactLine() {
  const c = contactDetails();
  return `If you have any questions, please email ${c.email}${c.phoneDisplay ? ` or call ${c.phoneDisplay}` : ''}.`;
}

function toSecretary(subject, text) {
  if (!SECRETARY_EMAIL.length) return Promise.resolve({ sent: false });
  return sendMail({ to: SECRETARY_EMAIL, subject, text: `${text}\n\n${SIGN_OFF}` });
}

// ---------- Reminders ----------

const REMINDER_SUBJECTS = {
  notice: 'Your SLNA membership is due for renewal',
  expired: 'Your SLNA membership has expired: renew now',
  grace_ending: 'Final reminder: renew your SLNA membership',
  lapsed: 'Your SLNA membership has lapsed',
};

function reminderText(kind, member, graceEnd) {
  const label = M.CATEGORIES[member.category];
  switch (kind) {
    case 'notice':
      return `Your ${label} (${member.membership_number}) expires on ${fmt(member.valid_until)}.`;
    case 'expired':
      return `Your ${label} (${member.membership_number}) expired on ${fmt(member.valid_until)}. ` +
        `You can still renew until ${fmt(graceEnd)} without losing your membership.`;
    case 'grace_ending':
      return `This is a final reminder: your ${label} (${member.membership_number}) will lapse on ` +
        `${fmt(graceEnd)} unless it is renewed.`;
    default:
      return `Your ${label} (${member.membership_number}) has lapsed. You can renew at any time to ` +
        'reactivate it; your membership number stays the same.';
  }
}

// kind: notice_30 | notice_7 | expired | grace_ending | lapsed
function renewalReminder(kind, member, link, graceEnd) {
  const base = kind.startsWith('notice') ? 'notice' : kind;
  return sendMail({
    to: member.email_address,
    subject: REMINDER_SUBJECTS[base],
    text:
      `Dear ${nameOf(member)},\n\n` +
      `${reminderText(base, member, graceEnd)}\n\n` +
      'Renew online with your personal link (no login needed):\n' +
      `${link}\n\n` +
      'If you have already paid, you can ignore this message; we will confirm once ' +
      'your payment is verified.\n\n' +
      `${contactLine()}\n\n${SIGN_OFF}`,
  });
}

// An admin-made renewal link, emailed from the Member Directory.
function renewalLink(member, link) {
  return sendMail({
    to: member.email_address,
    subject: 'Renew your SLNA membership',
    text:
      `Dear ${nameOf(member)},\n\n` +
      `You can renew${M.UPGRADES[member.category].length ? ' or upgrade' : ''} your ` +
      `${M.CATEGORIES[member.category]} (${member.membership_number}) online with this personal link ` +
      '(no login needed, valid for 90 days):\n' +
      `${link}\n\n` +
      `${validityLine(member)}\n\n` +
      `${contactLine()}\n\n${SIGN_OFF}`,
  });
}

// ---------- Renewal / upgrade requests ----------

const requestWhat = (request) => (request.kind === 'upgrade'
  ? `upgrade to ${M.CATEGORIES[request.to_category]}`
  : 'membership renewal');

function renewalSubmitted(member, request) {
  return sendMail({
    to: request.email_address || member.email_address,
    subject: 'SLNA membership renewal received',
    text:
      `Dear ${nameOf(member)},\n\n` +
      `We have received your ${requestWhat(request)} and payment slip ` +
      `(${money(request.amount)}, reference ${request.payment_reference}).\n\n` +
      'We will verify the payment and confirm by email, usually within a few working days.\n\n' +
      `${contactLine()}\n\n${SIGN_OFF}`,
  });
}

function secretaryRenewalSubmitted(member, request) {
  return toSecretary(
    `Membership renewal received: ${member.membership_number} (${nameOf(member)})`,
    `A member submitted ${request.kind === 'upgrade' ? `an upgrade to ${M.CATEGORIES[request.to_category]}` : 'a renewal'} with a payment slip.\n\n` +
    `Member: ${member.full_name} (${nameOf(member)})\n` +
    `Membership number: ${member.membership_number}\n` +
    `Category: ${M.CATEGORIES[member.category]}\n` +
    `Current validity: ${member.valid_until ? fmt(member.valid_until) : 'Lifetime'}\n` +
    `Amount: ${money(request.amount)}${Number(request.discount_amount) > 0 ? ` (after a ${money(request.discount_amount)} loyalty discount)` : ''}, paid on ${fmt(request.payment_date) || '-'}\n` +
    `Reference: ${request.payment_reference}\n\n` +
    'Check the payment slip and verify or reject it in the staff admin dashboard (Renewals):\n' +
    ADMIN_LOGIN_URL
  );
}

// To the member once an admin verifies or rejects their request (or
// records a payment for them).
function renewalReviewed(member, request) {
  if (request.status === 'verified') {
    return sendMail({
      to: member.email_address,
      subject: request.kind === 'upgrade'
        ? `Welcome to SLNA ${M.CATEGORIES[request.to_category]}`
        : 'SLNA membership renewed',
      text:
        `Dear ${nameOf(member)},\n\n` +
        `Your payment (reference ${request.payment_reference}) has been verified` +
        (request.kind === 'upgrade' ? ` and your membership has been upgraded to ${M.CATEGORIES[member.category]}` : '') +
        '.\n\n' +
        `Membership number: ${member.membership_number}` +
        (request.previous_membership_number && request.previous_membership_number !== member.membership_number
          ? ` (previously ${request.previous_membership_number})`
          : '') +
        '\n' +
        `Category: ${M.CATEGORIES[member.category]}\n` +
        `${validityLine(member)}\n\n` +
        `Thank you for staying with SLNA.\n\n${SIGN_OFF}`,
    });
  }

  return sendMail({
    to: request.email_address || member.email_address,
    subject: 'SLNA membership renewal: action needed',
    text:
      `Dear ${nameOf(member)},\n\n` +
      `We could not verify your ${requestWhat(request)} payment (reference ${request.payment_reference}).\n\n` +
      (request.status_note ? `Reason - ${request.status_note}\n\n` : '') +
      `Please submit it again from ${renewPage()}\n\n` +
      `${contactLine()}\n\n${SIGN_OFF}`,
  });
}

function secretaryRenewalVerified(member, request, verifiedBy) {
  return toSecretary(
    `Membership renewal verified: ${member.membership_number} (${nameOf(member)})`,
    `${request.kind === 'upgrade' ? `An upgrade to ${M.CATEGORIES[request.to_category]}` : 'A renewal'} was verified` +
    `${verifiedBy ? ` by ${verifiedBy}` : ''}${request.recorded_by_admin ? ' (payment recorded in the admin dashboard)' : ''}.\n\n` +
    `Member: ${member.full_name} (${nameOf(member)})\n` +
    `Membership number: ${member.membership_number}` +
    (request.previous_membership_number && request.previous_membership_number !== member.membership_number
      ? ` (previously ${request.previous_membership_number}, now reserved)`
      : '') +
    '\n' +
    `Category: ${M.CATEGORIES[member.category]}\n` +
    `${member.valid_until ? `Now valid until: ${fmt(member.valid_until)}` : 'Valid for life'}\n` +
    `Amount: ${money(request.amount)}, paid on ${fmt(request.payment_date) || '-'}\n` +
    `Reference: ${request.payment_reference}`
  );
}

// ---------- Deactivation and reactivation ----------

// To the member. The deactivation reason is internal and not included.
function memberDeactivated(member) {
  if (!member.email_address) return Promise.resolve({ sent: false });
  return sendMail({
    to: member.email_address,
    subject: 'Your SLNA membership is inactive',
    text:
      `Dear ${nameOf(member)},\n\n` +
      `Your SLNA membership (${member.membership_number}) has been marked inactive. ` +
      'You will no longer receive renewal reminders while it is inactive.\n\n' +
      'If you think this is a mistake, or you would like to become active again, ' +
      `please contact us. ${contactLine()}\n\n${SIGN_OFF}`,
  });
}

// To the member. With a payment recorded at the same time, it also confirms
// the renewal or upgrade.
function memberReactivated(member, request) {
  if (!member.email_address) return Promise.resolve({ sent: false });
  return sendMail({
    to: member.email_address,
    subject: 'Your SLNA membership is active again',
    text:
      `Dear ${nameOf(member)},\n\n` +
      'Your SLNA membership is active again.' +
      (request
        ? ` Your payment (reference ${request.payment_reference}) has been recorded` +
          (request.kind === 'upgrade' ? ` and you are now ${withArticle(M.CATEGORIES[request.to_category].replace(' Membership', ''))} member` : '') +
          '.'
        : '') +
      '\n\n' +
      `Membership number: ${member.membership_number}\n` +
      `Category: ${M.CATEGORIES[member.category]}\n` +
      `${validityLine(member)}\n\n` +
      `Welcome back.\n\n${SIGN_OFF}`,
  });
}

// To the secretary for every deactivation and reactivation.
function secretaryMemberStatus(member, { active, by, reason, request, memberEmailed }) {
  return toSecretary(
    `Member ${active ? 'reactivated' : 'deactivated'}: ${member.membership_number} (${nameOf(member)})`,
    `${member.membership_number} was ${active ? 'reactivated' : 'deactivated'}${by ? ` by ${by}` : ''}.\n\n` +
    `Member: ${member.full_name} (${nameOf(member)})\n` +
    `Membership number: ${member.membership_number}\n` +
    `Category: ${M.CATEGORIES[member.category]}\n` +
    `${validityLine(member)}\n` +
    (reason ? `Reason: ${reason}\n` : '') +
    (request ? `Payment recorded: ${requestWhat(request)}, ${money(request.amount)}, reference ${request.payment_reference}\n` : '') +
    `Member emailed: ${memberEmailed ? 'yes' : member.email_address ? 'no' : 'no (no email address on record)'}\n\n` +
    `Staff admin dashboard: ${ADMIN_LOGIN_URL}`
  );
}

module.exports = {
  fmt,
  memberDeactivated,
  memberReactivated,
  secretaryMemberStatus,
  renewalReminder,
  renewalLink,
  renewalSubmitted,
  secretaryRenewalSubmitted,
  renewalReviewed,
  secretaryRenewalVerified,
};
