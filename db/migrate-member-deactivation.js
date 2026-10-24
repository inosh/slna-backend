// db/migrate-member-deactivation.js
//
// Adds member deactivation support: an is_active flag (plus audit
// timestamp/admin) on both lifetime-member sources -- the digital
// applications table and the pre-digital legacy roll. Approved/legacy
// members are deactivated rather than deleted (see routes), so this is a
// soft flag, not a workflow status: membership_applications.application_status
// stays 'approved' either way, it just stops showing up in the active
// Member Directory views once is_active is false.
const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.membership_applications
        ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS deactivated_at timestamp with time zone,
        ADD COLUMN IF NOT EXISTS deactivated_by bigint;

      ALTER TABLE public.legacy_lifetime_members
        ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS deactivated_at timestamp with time zone,
        ADD COLUMN IF NOT EXISTS deactivated_by bigint;
    `);

    console.log('membership_applications and legacy_lifetime_members now support deactivation.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
