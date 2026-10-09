// db/migrate-event-registrations-rejection-reason.js
// One-time migration: adds event_registrations.rejection_reason, set by the
// admin when rejecting a registration and shown to the registrant in their
// rejection notification email.
//
// Run with: node db/migrate-event-registrations-rejection-reason.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.event_registrations
        ADD COLUMN IF NOT EXISTS rejection_reason text;
    `);

    console.log('event_registrations.rejection_reason ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
