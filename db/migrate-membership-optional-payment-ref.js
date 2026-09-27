// db/migrate-membership-optional-payment-ref.js
const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.membership_applications
        ALTER COLUMN payment_reference DROP NOT NULL,
        ALTER COLUMN transfer_date DROP NOT NULL;
    `);

    console.log('membership_applications.payment_reference / transfer_date are now optional.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
