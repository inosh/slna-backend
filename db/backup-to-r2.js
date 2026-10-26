// db/backup-to-r2.js
// Nightly full-database backup. Runs `pg_dump` against the same Postgres
// database the API uses, gzips the output, and streams it straight to a
// dedicated R2 bucket (nothing touches local disk). Afterwards deletes any
// backup older than BACKUP_RETENTION_DAYS.
//
// Meant to run as its own scheduled (cron) Railway service -- not inside
// the always-on API process -- so a deploy/restart of the API can never
// skip or corrupt a backup run. That service builds from Dockerfile.backup
// (Builder: Dockerfile, Dockerfile path: Dockerfile.backup) instead of
// Railway's default builder, so its pg_dump always matches the Postgres
// server's major version -- see that file for why.
//
// Required env vars:
//   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME   (same as the API -- see db/pool.js)
//   BACKUP_R2_ENDPOINT, BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY, BACKUP_R2_BUCKET
//     -- a separate, narrowly-scoped R2 token (Object Read & Write on the
//     backups bucket only), deliberately not the app's normal R2_* keys.
// Optional:
//   BACKUP_RETENTION_DAYS   (default 14)
//   BACKUP_ALERT_EMAIL      (default: SECRETARY_EMAIL from lib/mail.js)
//
// On any failure, emails an alert (via the existing Resend setup in
// lib/mail.js) and exits 1, so the Railway cron run itself shows as failed.
//
// Run locally with: node db/backup-to-r2.js

require('dotenv').config();

const { spawn } = require('child_process');
const zlib = require('zlib');
const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { sendMail, SECRETARY_EMAIL } = require('../lib/mail');

const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 14);
const BUCKET = process.env.BACKUP_R2_BUCKET;
const PREFIX = 'backups/';
const ALERT_EMAIL = process.env.BACKUP_ALERT_EMAIL || SECRETARY_EMAIL;

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing environment variable ${name}`);
  return process.env[name];
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.BACKUP_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.BACKUP_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.BACKUP_R2_SECRET_ACCESS_KEY,
  },
  // Same R2 checksum workaround as lib/r2.js.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

// e.g. 20260427T020000Z -- sorts lexicographically in the same order as
// chronologically, which is all the cleanup step relies on.
function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

// Spawns pg_dump and streams its (gzipped) stdout straight into an R2
// multipart upload -- the dump is never buffered in memory or written to
// disk.
async function dumpAndUpload() {
  const key = `${PREFIX}slna_db_${timestamp()}.sql.gz`;

  const pgDump = spawn('pg_dump', [
    '-h', process.env.DB_HOST,
    '-p', process.env.DB_PORT || '5432',
    '-U', process.env.DB_USER || 'postgres',
    '-d', process.env.DB_NAME || 'slna_db',
    '--no-owner',
    '--no-privileges',
  ], {
    env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD },
  });

  let stderr = '';
  pgDump.stderr.on('data', (chunk) => { stderr += chunk; });

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: key,
      Body: pgDump.stdout.pipe(zlib.createGzip()),
      ContentType: 'application/gzip',
    },
  });

  const [exitCode] = await Promise.all([
    new Promise((resolve, reject) => {
      pgDump.on('error', reject); // e.g. pg_dump binary missing
      pgDump.on('close', resolve);
    }),
    upload.done(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`pg_dump exited with code ${exitCode}: ${stderr.trim()}`);
  }

  return key;
}

async function listBackups() {
  const objects = [];
  let ContinuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken }));
    for (const obj of page.Contents || []) objects.push({ key: obj.Key, lastModified: obj.LastModified });
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return objects;
}

async function cleanupOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const stale = (await listBackups()).filter((o) => o.lastModified && o.lastModified.getTime() < cutoff);
  if (!stale.length) return 0;

  // R2 supports batch delete up to 1000 keys per request; we'll never be
  // anywhere near that with one dump a day.
  await s3.send(new DeleteObjectsCommand({
    Bucket: BUCKET,
    Delete: { Objects: stale.map((o) => ({ Key: o.key })) },
  }));
  return stale.length;
}

async function main() {
  requireEnv('DB_HOST');
  requireEnv('DB_PASSWORD');
  requireEnv('BACKUP_R2_ENDPOINT');
  requireEnv('BACKUP_R2_ACCESS_KEY_ID');
  requireEnv('BACKUP_R2_SECRET_ACCESS_KEY');
  requireEnv('BACKUP_R2_BUCKET');

  const start = Date.now();
  const key = await dumpAndUpload();
  const deleted = await cleanupOldBackups();
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[backup] uploaded ${key} in ${seconds}s, deleted ${deleted} backup(s) older than ${RETENTION_DAYS} days.`);
}

main().then(() => process.exit(0)).catch(async (err) => {
  console.error('[backup] FAILED:', err.message);
  try {
    await sendMail({
      to: ALERT_EMAIL,
      subject: 'SLNA database backup FAILED',
      text:
        `The nightly database backup job failed at ${new Date().toISOString()}.\n\n` +
        `Error: ${err.message}\n\n` +
        'No new backup was uploaded to R2 today -- check the Railway logs for the backup service.',
    });
  } catch (mailErr) {
    console.error('[backup] additionally failed to send failure alert email:', mailErr.message);
  }
  process.exit(1);
});
