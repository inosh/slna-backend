// db/copy-r2-dev-to-prod.js
// One-time go-live step: copies every object from the dev R2 buckets into
// the new prod buckets, keeping the exact same keys (albums/..., news/...,
// events/..., membership-applications/...). Nothing in the database is
// touched -- stored photo_url/receipt_url/*_path values are bucket-agnostic
// keys, so once the files exist in the prod buckets the app keeps working
// after its R2_BUCKET_* variables are switched over.
//
// Uses its own credentials (COPY_R2_*) so it can't accidentally run with the
// app's normal .env bucket settings. The token needs Object Read & Write on
// all four buckets; create it just for this copy and delete it afterwards.
//
// Safe to re-run: each object is just copied again to the same key.
//
// Run with:
//   COPY_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
//   COPY_R2_ACCESS_KEY_ID=... COPY_R2_SECRET_ACCESS_KEY=... \
//   node db/copy-r2-dev-to-prod.js \
//     --public slna-dev-public:slna-prod-public \
//     --private slna-dev-private:slna-prod-private \
//     [--dry-run]

const {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.COPY_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.COPY_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.COPY_R2_SECRET_ACCESS_KEY,
  },
  // Same R2 checksum workaround as lib/r2.js.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

function parseArgs(argv) {
  const pairs = [];
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--public' || arg === '--private') {
      const [from, to] = (argv[++i] || '').split(':');
      if (!from || !to) throw new Error(`${arg} expects <from-bucket>:<to-bucket>`);
      if (from === to) throw new Error(`${arg}: source and target bucket are the same`);
      pairs.push({ label: arg.slice(2), from, to });
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!pairs.length) throw new Error('Pass at least one of --public or --private.');
  return { pairs, dryRun };
}

async function listAllKeys(bucket) {
  const keys = [];
  let ContinuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken }));
    for (const obj of page.Contents || []) keys.push({ key: obj.Key, size: obj.Size });
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

// Server-side copy first (no download); fall back to download + upload if
// the cross-bucket copy is rejected for any reason.
async function copyObject(from, to, key) {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  try {
    await s3.send(new CopyObjectCommand({ Bucket: to, Key: key, CopySource: `${from}/${encodedKey}` }));
    return 'copied';
  } catch (err) {
    const src = await s3.send(new GetObjectCommand({ Bucket: from, Key: key }));
    const body = Buffer.from(await src.Body.transformToByteArray());
    await s3.send(new PutObjectCommand({ Bucket: to, Key: key, Body: body, ContentType: src.ContentType }));
    return 'downloaded and re-uploaded';
  }
}

async function main() {
  for (const name of ['COPY_R2_ENDPOINT', 'COPY_R2_ACCESS_KEY_ID', 'COPY_R2_SECRET_ACCESS_KEY']) {
    if (!process.env[name]) throw new Error(`Missing environment variable ${name}`);
  }
  const { pairs, dryRun } = parseArgs(process.argv.slice(2));

  for (const { label, from, to } of pairs) {
    const objects = await listAllKeys(from);
    const totalMb = (objects.reduce((sum, o) => sum + (o.size || 0), 0) / 1024 / 1024).toFixed(1);
    console.log(`\n[${label}] ${from} -> ${to}: ${objects.length} objects, ${totalMb} MB${dryRun ? ' (dry run)' : ''}`);

    let done = 0;
    let failed = 0;
    for (const { key } of objects) {
      if (dryRun) {
        console.log(`  would copy ${key}`);
        continue;
      }
      try {
        const how = await copyObject(from, to, key);
        done++;
        if (how !== 'copied') console.log(`  ${key} (${how})`);
      } catch (err) {
        failed++;
        console.error(`  FAILED ${key}: ${err.message}`);
      }
    }
    if (!dryRun) console.log(`[${label}] copied ${done}, failed ${failed}`);
  }
}

main().catch((err) => {
  console.error('\nCopy failed:', err.message);
  process.exit(1);
});
