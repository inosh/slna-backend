// db/migrate-membership-slnc-optional.js
// One-time migration: SLNC registration is not yet mandatory for lifetime
// membership applicants (per SLNA), so applicants can tick "I don't have my
// SLNC registration yet" on the join form and submit without it.
// slnc_registration_date was already nullable; this drops the NOT NULL
// constraint on slnc_registration_number to match.
//
// Run with: node db/migrate-membership-slnc-optional.js

const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.membership_applications
        ALTER COLUMN slnc_registration_number DROP NOT NULL;
    `);

    console.log('membership_applications.slnc_registration_number is now nullable.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
