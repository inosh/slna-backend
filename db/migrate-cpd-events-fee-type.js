// db/migrate-cpd-events-fee-type.js
// One-time migration: adds cpd_events.fee_type ('paid' / 'free' /
// 'free_for_members'), replacing the old convention of inferring "free"
// purely from member_fee/non_member_fee being 0. Existing rows are
// backfilled from their current fee amounts so they land on a sensible
// value instead of defaulting to 'paid'.
//
// Run with: node db/migrate-cpd-events-fee-type.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.cpd_events
        ADD COLUMN IF NOT EXISTS fee_type text NOT NULL DEFAULT 'paid';
    `);

    await client.query(`
      ALTER TABLE public.cpd_events
        DROP CONSTRAINT IF EXISTS cpd_events_fee_type_check;
    `);

    await client.query(`
      ALTER TABLE public.cpd_events
        ADD CONSTRAINT cpd_events_fee_type_check
        CHECK (fee_type = ANY (ARRAY['paid'::text, 'free'::text, 'free_for_members'::text]));
    `);

    await client.query(`
      UPDATE public.cpd_events
      SET fee_type = CASE
        WHEN member_fee <= 0 AND non_member_fee <= 0 THEN 'free'
        WHEN member_fee <= 0 AND non_member_fee > 0 THEN 'free_for_members'
        ELSE 'paid'
      END;
    `);

    console.log('cpd_events.fee_type ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
