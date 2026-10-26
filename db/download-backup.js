// db/download-backup.js
// Lists or downloads a nightly database backup from R2 (see
// db/backup-to-r2.js) and decompresses it into a plain .sql file ready for
// `psql -f` -- see the restore steps that print at the end.
//
// Usage:
//   node db/download-backup.js --list
//   node db/download-backup.js --latest [--out <path>]
//   node db/download-backup.js <key> [--out <path>]
//     e.g. node db/download-backup.js backups/slna_db_20261026T151659Z.sql.gz
//
// Uses the same BACKUP_R2_* env vars as the backup job itself.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.BACKUP_R2_BUCKET;
const PREFIX = 'backups/';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.BACKUP_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.BACKUP_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.BACKUP_R2_SECRET_ACCESS_KEY,
  },
});

// Filenames are slna_db_<UTC timestamp>.sql.gz, so a plain string sort is
// also a chronological sort.
async function listBackups() {
  const objects = [];
  let ContinuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken }));
    for (const obj of page.Contents || []) objects.push(obj);
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  objects.sort((a, b) => a.Key.localeCompare(b.Key));
  return objects;
}

async function downloadAndDecompress(key, outPath) {
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const gz = Buffer.from(await obj.Body.transformToByteArray());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, zlib.gunzipSync(gz));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.length === 0) {
    const objects = await listBackups();
    if (!objects.length) {
      console.log(`No backups found in ${BUCKET}/${PREFIX}`);
      return;
    }
    for (const o of objects) {
      console.log(`${o.Key}  ${(o.Size / 1024).toFixed(0)} KB  ${o.LastModified.toISOString()}`);
    }
    console.log(`\n${objects.length} backup(s). Run again with --latest or a specific key to download.`);
    return;
  }

  const outIdx = args.indexOf('--out');
  const outArg = outIdx !== -1 ? args[outIdx + 1] : null;

  let key = args[0];
  if (args.includes('--latest')) {
    const objects = await listBackups();
    if (!objects.length) throw new Error('No backups found.');
    key = objects[objects.length - 1].Key;
  }
  if (!key || key === '--latest') throw new Error('Pass --list, --latest, or a specific backup key.');

  const outPath = outArg || path.join(__dirname, 'backups', path.basename(key).replace(/\.gz$/, ''));
  await downloadAndDecompress(key, outPath);

  console.log(`Downloaded and decompressed ${key} -> ${outPath}`);
  console.log(`\nTo restore into an EMPTY database:`);
  console.log(`  psql -h <host> -p <port> -U <user> -d <dbname> -f "${outPath}"`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
