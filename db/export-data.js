// db/export-data.js
// One-time utility: reads all rows from the local slna_db and writes them
// out as plain INSERT statements (plus sequence resets) to
// db/data-export.sql, so that file can be run against the new Railway
// database to carry over existing data. Safe to re-run -- it only reads
// from the local DB and overwrites the output file
//
// Run with: node db/export-data.js

const fs = require('fs');
const path = require('path');
const pool = require('./pool');

// Dependency order matters for FK constraints on the way back in.
const TABLES = [
  'users',
  'albums',
  'album_photos',
  'news',
  'events',
  'cpd_events',
  'event_registrations',
  'membership_applications',
  'contact_queries',
];

// serial/bigserial columns per table, so sequences can be reset after the
// explicit-id inserts below.
const SEQUENCES = {
  users: 'id',
  albums: 'id',
  album_photos: 'id',
  news: 'id',
  events: 'id',
  cpd_events: 'id',
  event_registrations: 'id',
  membership_applications: 'id',
  contact_queries: 'id',
};

function escapeLiteral(value) {
  if (value === null || value === undefined) return 'NULL';

  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';

  if (typeof value === 'number') return String(value);

  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }

  // numeric columns come back from pg as strings already formatted fine.
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function exportTable(client, table) {
  const { rows } = await client.query(`SELECT * FROM ${table} ORDER BY id ASC`);

  if (!rows.length) {
    return `-- ${table}: no rows\n`;
  }

  const columns = Object.keys(rows[0]);
  const lines = [`-- ${table}: ${rows.length} row(s)`];

  for (const row of rows) {
    const values = columns.map((col) => escapeLiteral(row[col])).join(', ');
    lines.push(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values}) ON CONFLICT (id) DO NOTHING;`
    );
  }

  const seqCol = SEQUENCES[table];
  if (seqCol) {
    lines.push(
      `SELECT setval(pg_get_serial_sequence('${table}', '${seqCol}'), COALESCE((SELECT MAX(${seqCol}) FROM ${table}), 1));`
    );
  }

  return lines.join('\n') + '\n';
}

async function main() {
  const client = await pool.connect();
  const outputPath = path.join(__dirname, 'data-export.sql');

  try {
    const sections = [];

    for (const table of TABLES) {
      console.log(`Exporting ${table}...`);
      sections.push(await exportTable(client, table));
    }

    const header =
      '-- Data export from local slna_db for migration to Railway.\n' +
      `-- Generated: ${new Date().toISOString()}\n` +
      '-- Run this AFTER db/schema.sql has created the tables.\n\n';

    fs.writeFileSync(outputPath, header + sections.join('\n'), 'utf8');

    console.log(`\nDone. Wrote ${outputPath}`);
  } catch (error) {
    console.error('Export failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
