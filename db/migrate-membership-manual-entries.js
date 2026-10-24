// db/migrate-membership-manual-entries.js
//
// Supports manually-added members in the admin dashboard's Member
// Directory -> Newly Accepted tab: a record for someone who submitted a
// paper/PDF application directly to SLNA rather than through the online
// join form. These go into membership_applications like any other
// application (already approved), but without a payment receipt, ID
// photo, or most of the other fields the online form collects -- those
// can be filled in later via the existing "Edit" action, same as legacy
// members.
const pool = require('./pool');

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE public.membership_applications
        ALTER COLUMN title DROP NOT NULL,
        ALTER COLUMN nic_number DROP NOT NULL,
        ALTER COLUMN date_of_birth DROP NOT NULL,
        ALTER COLUMN sex DROP NOT NULL,
        ALTER COLUMN marital_status DROP NOT NULL,
        ALTER COLUMN permanent_address DROP NOT NULL,
        ALTER COLUMN current_working_place DROP NOT NULL,
        ALTER COLUMN mobile_number DROP NOT NULL,
        ALTER COLUMN email_address DROP NOT NULL,
        ALTER COLUMN designation DROP NOT NULL,
        ALTER COLUMN payment_receipt_path DROP NOT NULL,
        ALTER COLUMN payment_receipt_original_name DROP NOT NULL,
        ALTER COLUMN id_photo_path DROP NOT NULL,
        ALTER COLUMN id_photo_original_name DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS is_manual_entry boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS manual_entry_created_by bigint,
        ADD COLUMN IF NOT EXISTS manual_entry_created_at timestamp with time zone;
    `);

    console.log('membership_applications now supports manually-added members.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
