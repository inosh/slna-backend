// db/migrate-registration-paid-amount.js
// One-time migration: adds the paid_amount column to event_registrations.
//
// Run with: node db/migrate-registration-paid-amount.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.event_registrations
        ADD COLUMN IF NOT EXISTS paid_amount numeric(10,2) NOT NULL DEFAULT 0;
    `);

    console.log('event_registrations.paid_amount ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
