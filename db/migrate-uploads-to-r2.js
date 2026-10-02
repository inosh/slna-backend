// db/migrate-uploads-to-r2.js
// One-time migration: copies every file currently sitting in the local
// uploads/ and private-uploads/ folders up to Cloudflare R2, using the
// exact same relative key structure the app already expects (albums/...,
// news/..., events/..., events/payments/..., events/attachements/...,
// membership-applications/...). Nothing in the database is touched --
// stored photo_url/receipt_url/*_path values already match these keys,
// so once the files exist in R2 the app (now reading from R2 instead of
// local disk) keeps working without any DB changes.
//
// Safe to re-run: each file is just re-uploaded to the same key.
//
// Run with: node db/migrate-uploads-to-r2.js

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { putPublicObject, putPrivateObject } = require('../lib/r2');

const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');
const PRIVATE_UPLOADS_ROOT = path.join(__dirname, '..', 'private-uploads');

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ogv': 'video/ogg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// Recursively lists every file under `dir`, returning paths relative to
// `dir` with forward slashes (so they match R2 key conventions regardless
// of OS).
function listFilesRelative(dir) {
  const results = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name !== '.gitkeep') {
        results.push(path.relative(dir, fullPath).split(path.sep).join('/'));
      }
    }
  }

  if (fs.existsSync(dir)) {
    walk(dir);
  }

  return results;
}

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    console.error('Fill it in .env before running this migration.');
    process.exit(1);
  }
}

async function migrateFolder(rootDir, label, putFn) {
  const relativePaths = listFilesRelative(rootDir);
  console.log(`\n${label}: ${relativePaths.length} file(s) to upload`);

  let uploaded = 0;
  for (const relativePath of relativePaths) {
    const fullPath = path.join(rootDir, ...relativePath.split('/'));
    const buffer = fs.readFileSync(fullPath);

    await putFn(relativePath, buffer, contentTypeFor(relativePath));
    uploaded += 1;
    console.log(`  [${uploaded}/${relativePaths.length}] ${relativePath}`);
  }

  return uploaded;
}

async function main() {
  requireEnv('R2_ACCESS_KEY_ID');
  requireEnv('R2_SECRET_ACCESS_KEY');
  requireEnv('R2_ENDPOINT');
  requireEnv('R2_BUCKET_PUBLIC');
  requireEnv('R2_BUCKET_PRIVATE');

  const publicCount = await migrateFolder(UPLOADS_ROOT, 'Public bucket (uploads/)', putPublicObject);
  const privateCount = await migrateFolder(PRIVATE_UPLOADS_ROOT, 'Private bucket (private-uploads/)', putPrivateObject);

  console.log(`\nDone. Uploaded ${publicCount} public file(s) and ${privateCount} private file(s).`);
  console.log('Local uploads/ and private-uploads/ folders were left untouched.');
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
