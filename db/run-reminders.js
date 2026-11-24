// db/run-reminders.js
// Sends due membership renewal reminders (Ordinary and Associate members).
// Schedule it to run once a day as a Railway cron service, like the nightly
// backup (start command: npm run reminders). Admins can also send them from
// the dashboard (Membership Settings -> Send due reminders now).
//
//   npm run reminders

const pool = require('./pool');
const { runReminders } = require('../lib/reminders');

runReminders()
  .then((summary) => {
    console.log(`[reminders] checked ${summary.checked} members: ${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed.`);
    summary.details.forEach((d) => console.log(`  ${d.membershipNumber} ${d.kind}: ${d.status}${d.detail ? ' (' + d.detail + ')' : ''}`));
  })
  .catch((err) => {
    console.error('[reminders] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
