// db/backfill-legacy-name-with-initials.js
// One-off backfill: the spreadsheet import only ever populated full_name,
// but most of those values are actually already in "name with initials"
// format (e.g. "A. A. I. K. PREMATISSA"), not a spelled-out full name. For
// those, name_with_initials should just be a copy of full_name. For the
// handful of rows that ARE genuine spelled-out full names (e.g. "UDARA
// SAMADI WELGAMA"), name_with_initials is derived from it instead.
//
// Only touches rows where name_with_initials IS NULL, so it won't clobber
// anything an admin has already filled in by hand.
//
// Run with: node db/backfill-legacy-name-with-initials.js [--apply]
// Without --apply, it only prints the plan (dry run).

const pool = require('./pool');

const TITLE_RE = /^(prof|dr|mr|mrs|miss|ms)\.?$/i;

function deriveNameWithInitials(fullName) {
  const name = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!name) return name;

  const words = name.split(' ');

  let titlePrefix = '';
  let rest = words;

  if (words.length > 1 && TITLE_RE.test(words[0])) {
    titlePrefix = (words[0].endsWith('.') ? words[0] : words[0] + '.') + ' ';
    rest = words.slice(1);
  }

  // If any non-title part already contains a period, at least one name
  // part is already an abbreviated initial -- leave the whole thing alone
  // rather than guessing which of the remaining words are droppable given
  // names vs. meaningful name parts (e.g. "A. Nirosha Palliyaguru" must
  // NOT become "A. N. Palliyaguru" -- "Nirosha" isn't safe to assume is
  // abbreviatable just because "A." already is).
  if (rest.join(' ').includes('.')) return name;

  // A single remaining word (a mononym) -- nothing meaningful to do.
  if (rest.length <= 1) return name;

  const initials = rest.slice(0, -1)
      .map((w) => w.charAt(0).toUpperCase() + '.')
      .join(' ');
  const surname = rest[rest.length - 1];

  return titlePrefix + initials + ' ' + surname;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const result = await pool.query(
      'SELECT id, full_name, name_with_initials FROM legacy_lifetime_members ORDER BY full_name ASC'
  );

  const toUpdate = [];

  for (const row of result.rows) {
    if (row.name_with_initials !== null) continue; // already set -- don't touch

    const derived = deriveNameWithInitials(row.full_name);
    toUpdate.push({ id: row.id, fullName: row.full_name, derived });
  }

  console.log(`${result.rows.length} total row(s), ${toUpdate.length} need name_with_initials set.\n`);

  for (const row of toUpdate) {
    const changed = row.derived !== row.fullName ? '  <-- derived' : '';
    console.log(`  [${row.id}] "${row.fullName}" -> "${row.derived}"${changed}`);
  }

  if (!apply) {
    console.log('\nDry run only -- rerun with --apply to write these changes.');
    await pool.end();
    return;
  }

  for (const row of toUpdate) {
    await pool.query(
        'UPDATE legacy_lifetime_members SET name_with_initials = $1, updated_at = now() WHERE id = $2',
        [row.derived, row.id]
    );
  }

  console.log(`\nApplied. ${toUpdate.length} row(s) updated.`);
  await pool.end();
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
