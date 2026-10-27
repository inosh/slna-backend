// db/migrate-cpd-events-duration.js
// One-time migration: adds cpd_events.duration_number / duration_unit, so
// a programme can be described as "3 Months" or "2 Years" and not just a
// single from/to time on one date (e.g. a multi-session certificate
// programme). Existing rows default to 1 "day", matching what every
// current CPD event actually is.
//
// Run with: node db/migrate-cpd-events-duration.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.cpd_events
        ADD COLUMN IF NOT EXISTS duration_number integer NOT NULL DEFAULT 1;
    `);

    await client.query(`
      ALTER TABLE public.cpd_events
        ADD COLUMN IF NOT EXISTS duration_unit text NOT NULL DEFAULT 'day';
    `);

    await client.query(`
      ALTER TABLE public.cpd_events
        DROP CONSTRAINT IF EXISTS cpd_events_duration_number_check;
    `);

    await client.query(`
      ALTER TABLE public.cpd_events
        ADD CONSTRAINT cpd_events_duration_number_check
        CHECK (duration_number > 0);
    `);

    await client.query(`
      ALTER TABLE public.cpd_events
        DROP CONSTRAINT IF EXISTS cpd_events_duration_unit_check;
    `);

    await client.query(`
      ALTER TABLE public.cpd_events
        ADD CONSTRAINT cpd_events_duration_unit_check
        CHECK (duration_unit = ANY (ARRAY['day'::text, 'month'::text, 'year'::text]));
    `);

    console.log('cpd_events.duration_number / duration_unit ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
