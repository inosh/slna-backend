// db/migrate-cpd-events-end-date.js
// One-time migration: adds cpd_events.end_date, an optional admin-entered
// override for when a programme actually finishes. When blank, the app
// falls back to computing an end date from event_date + duration_number/
// duration_unit -- this column only exists for when the admin knows the
// exact finish date and wants it used instead of that approximation.
//
// Run with: node db/migrate-cpd-events-end-date.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.cpd_events
        ADD COLUMN IF NOT EXISTS end_date date;
    `);

    console.log('cpd_events.end_date ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
