// db/migrate-legacy-membership-number-lt-prefix.js
// One-off backfill: legacy_lifetime_members.membership_number currently
// stores the pre-digital registration numbers as bare numbers (e.g.
// "1927"), but the current numbering scheme prefixes these with "LT "
// (e.g. "LT 1927"). This backfills the old rows to match.
//
// Three formats are present in the data:
//   - A bare number, e.g. "1927" -> "LT 1927"
//   - An old-format number with a new one assigned after a slash, e.g.
//     "P 474/ 1781" -> "P 474/LT 1781" (also drops the stray space after
//     the slash), "K 293/1994" -> "K 293/LT 1994"
//   - An old-format number with no new one assigned, e.g. "G 23",
//     "S 509" -- left untouched, since there's nothing to migrate to
//
// Anything that doesn't match one of these shapes is skipped and flagged
// for manual review rather than guessed at.
//
// Run with: node db/migrate-legacy-membership-number-lt-prefix.js [--apply]
// Without --apply, it only prints the plan (dry run).

const pool = require('./pool');

function nextMembershipNumber(value) {
  const v = String(value).trim();

  // Bare number, e.g. "1927" -> "LT 1927"
  if (/^\d+$/.test(v)) {
    return 'LT ' + v;
  }

  // Old number + new number after a slash, e.g. "P 474/ 1781" or
  // "K 293/1994" -> "P 474/LT 1781" / "K 293/LT 1994"
  const slashMatch = v.match(/^([A-Za-z]\s\d+)\s*\/\s*(\d+)$/);
  if (slashMatch) {
    return slashMatch[1] + '/LT ' + slashMatch[2];
  }

  // Old number only, no new number assigned -- leave as is, e.g. "G 23"
  if (/^[A-Za-z]\s\d+$/.test(v)) {
    return v;
  }

  // Unrecognized format -- don't guess.
  return null;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const result = await pool.query(
      'SELECT id, membership_number FROM legacy_lifetime_members ORDER BY id ASC'
  );

  const toUpdate = [];
  const unrecognized = [];

  for (const row of result.rows) {
    const next = nextMembershipNumber(row.membership_number);

    if (next === null) {
      unrecognized.push(row);
      continue;
    }

    if (next !== row.membership_number) {
      toUpdate.push({ id: row.id, from: row.membership_number, to: next });
    }
  }

  console.log(`${result.rows.length} total row(s), ${toUpdate.length} need migrating.\n`);

  for (const row of toUpdate) {
    console.log(`  [${row.id}] "${row.from}" -> "${row.to}"`);
  }

  if (unrecognized.length) {
    console.log(`\n${unrecognized.length} row(s) in an unrecognized format -- skipped, needs manual review:`);
    unrecognized.forEach((row) => console.log(`  [${row.id}] "${row.membership_number}"`));
  }

  if (!apply) {
    console.log('\nDry run only -- rerun with --apply to write these changes.');
    await pool.end();
    return;
  }

  for (const row of toUpdate) {
    await pool.query(
        'UPDATE legacy_lifetime_members SET membership_number = $1, updated_at = now() WHERE id = $2',
        [row.to, row.id]
    );
  }

  console.log(`\nApplied. ${toUpdate.length} row(s) updated.`);
  await pool.end();
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
