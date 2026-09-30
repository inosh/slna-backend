// db/migrate-registration-optional-payment.js
// One-time migration: makes the payment fields on event_registrations
// optional, so a registration for a free event (Pay By / paid amount /
// bank receipt all skipped) can be saved without them.
//
// Run with: node db/migrate-registration-optional-payment.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.event_registrations
        ALTER COLUMN pay_by DROP NOT NULL,
        ALTER COLUMN receipt_url DROP NOT NULL,
        ALTER COLUMN receipt_filename DROP NOT NULL;
    `);

    console.log('event_registrations payment fields (pay_by, receipt_url, receipt_filename) are now optional.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
