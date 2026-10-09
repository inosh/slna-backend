// db/migrate-event-registrations-slnc-optional.js
// One-time migration: SLNC registration is not yet mandatory (same change
// as membership applications -- see migrate-membership-slnc-optional.js).
// Drops the NOT NULL constraint on event_registrations.slnc_registration_number
// so registrants without an SLNC number yet can still register for events.
//
// Run with: node db/migrate-event-registrations-slnc-optional.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.event_registrations
        ALTER COLUMN slnc_registration_number DROP NOT NULL;
    `);

    console.log('event_registrations.slnc_registration_number is now nullable.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
