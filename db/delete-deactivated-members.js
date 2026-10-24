// db/delete-deactivated-members.js
//
// Manual cleanup script -- permanently erases every member currently
// flagged deactivated (is_active = false) in both lifetime-member
// sources: membership_applications and legacy_lifetime_members. For each
// membership_applications row deleted, also removes its private R2
// objects (payment receipt, ID photo, and the legacy signature-photo
// column if it was ever populated) -- legacy_lifetime_members never had
// file uploads, so those rows are a plain DB delete.
//
// This is NOT run automatically anywhere and has no schedule -- someone
// deactivates a member from the admin dashboard (Member Directory ->
// Newly Accepted / Legacy Members -> Deactivate), and a deactivated
// record stays fully visible and recoverable-by-support-ticket in the
// Deactivated Members view indefinitely. Run this script by hand, only
// when you specifically want to purge that backlog for good.
//
// Defaults to a dry run -- it only lists what WOULD be deleted. Nothing
// is deleted, and no R2 object is touched, unless you pass --confirm.
//
// Usage:
//   node db/delete-deactivated-members.js            (dry run -- lists only)
//   node db/delete-deactivated-members.js --confirm   (actually deletes)

const pool = require('./pool');
const { deletePrivateObject, isNotFoundError } = require('../lib/r2');

const CONFIRMED = process.argv.includes('--confirm');

async function main() {
  const client = await pool.connect();

  try {
    const applications = (
      await client.query(
        `SELECT
            reference_number,
            membership_number,
            full_name,
            payment_receipt_path,
            id_photo_path,
            signature_photo_path
         FROM membership_applications
         WHERE is_active = false`
      )
    ).rows;

    const legacyMembers = (
      await client.query(
        `SELECT id, membership_number, full_name
         FROM legacy_lifetime_members
         WHERE is_active = false`
      )
    ).rows;

    console.log(`Deactivated digital applications found: ${applications.length}`);
    applications.forEach((row) => {
      console.log(`  - ${row.reference_number} (${row.membership_number || 'no membership #'}) ${row.full_name}`);
    });

    console.log(`Deactivated legacy members found: ${legacyMembers.length}`);
    legacyMembers.forEach((row) => {
      console.log(`  - #${row.id} (${row.membership_number || 'no membership #'}) ${row.full_name}`);
    });

    if (!CONFIRMED) {
      console.log('\nDry run only -- nothing was deleted. Re-run with --confirm to actually delete these records and their R2 files.');
      return;
    }

    console.log('\n--confirm passed -- deleting now.');

    let r2Deleted = 0;
    let r2Failed = 0;

    for (const application of applications) {
      const keys = [
        application.payment_receipt_path,
        application.id_photo_path,
        application.signature_photo_path
      ].filter(Boolean);

      for (const key of keys) {
        try {
          await deletePrivateObject(key);
          r2Deleted += 1;
        } catch (error) {
          if (!isNotFoundError(error)) {
            r2Failed += 1;
            console.error(`  R2 delete failed for ${key}:`, error.message || error);
          }
        }
      }

      await client.query(
        'DELETE FROM membership_applications WHERE reference_number = $1',
        [application.reference_number]
      );
    }

    for (const member of legacyMembers) {
      await client.query('DELETE FROM legacy_lifetime_members WHERE id = $1', [member.id]);
    }

    console.log(`\nDeleted ${applications.length} digital application row(s), ${legacyMembers.length} legacy member row(s), and ${r2Deleted} R2 file(s).`);
    if (r2Failed > 0) {
      console.log(`${r2Failed} R2 file(s) failed to delete -- see errors above.`);
    }
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
