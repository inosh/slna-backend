// db/import-legacy-members.js
// One-off import of the pre-digital lifetime membership roll from
// "SLNA LIFETIME MEMBERSHIP LIST.xlsx" (Sheet1: NO, Name of the Member,
// Working Place, SLNA Reg. NO) into legacy_lifetime_members.
//
// Only full_name, current_working_place, membership_number, and
// source_row_no are populated here -- that's all the spreadsheet has.
// Everything else (NIC, DOB, address, etc.) stays NULL until an admin
// fills it in from the dashboard.
//
// Safe to re-run: upserts on membership_number, so correcting the source
// file and re-running just updates the name/working place/source row
// rather than creating duplicates.
//
// Run with: node db/import-legacy-members.js [path-to-xlsx]

const path = require('path');
const ExcelJS = require('exceljs');
const pool = require('./pool');

const DEFAULT_FILE = 'C:\\Users\\inosh_121216\\Desktop\\Website\\SLNA LIFETIME MEMBERSHIP LIST.xlsx';

async function main() {
  const filePath = process.argv[2] || DEFAULT_FILE;
  console.log('Reading:', filePath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];

  const candidates = [];
  const problems = [];

  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const no = row.getCell(1).value;
    const name = row.getCell(2).value;
    const workingPlace = row.getCell(3).value;
    const regNo = row.getCell(4).value;

    // Skip title/header rows -- real data rows always have a numeric NO.
    if (typeof no !== 'number') continue;

    const fullName = String(name || '').trim();
    const membershipNumber = regNo === null || regNo === undefined
        ? ''
        : String(regNo).trim();

    if (!fullName) {
      problems.push(`row ${r} (NO ${no}): missing name -- skipped.`);
      continue;
    }

    if (!membershipNumber) {
      problems.push(`row ${r} (NO ${no}, "${fullName}"): missing SLNA Reg. NO -- skipped.`);
      continue;
    }

    candidates.push({
      sourceRowNo: no,
      fullName,
      workingPlace: String(workingPlace || '').trim() || null,
      membershipNumber
    });
  }

  // Flag (but still import) duplicate membership numbers within the sheet
  // -- last one wins on upsert, so surface this instead of silently
  // overwriting.
  const seen = new Map();
  for (const c of candidates) {
    if (seen.has(c.membershipNumber)) {
      problems.push(
          `Duplicate SLNA Reg. NO "${c.membershipNumber}": row ${seen.get(c.membershipNumber)} ` +
          `and row ${c.sourceRowNo >= 0 ? c.sourceRowNo : ''} both use it -- the later row will overwrite the earlier one.`
      );
    }
    seen.set(c.membershipNumber, c.sourceRowNo);
  }

  if (problems.length) {
    console.log(`\n${problems.length} row(s) need attention:`);
    problems.forEach((p) => console.log('  - ' + p));
  }

  console.log(`\nImporting ${candidates.length} member(s)...`);

  let inserted = 0;
  let updated = 0;

  for (const c of candidates) {
    const result = await pool.query(
        `INSERT INTO legacy_lifetime_members
            (membership_number, full_name, current_working_place, source_row_no)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (membership_number) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            current_working_place = EXCLUDED.current_working_place,
            source_row_no = EXCLUDED.source_row_no,
            updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [c.membershipNumber, c.fullName, c.workingPlace, c.sourceRowNo]
    );

    if (result.rows[0].inserted) inserted++;
    else updated++;
  }

  console.log(`\nDone. ${inserted} inserted, ${updated} updated (already existed).`);
  await pool.end();
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
