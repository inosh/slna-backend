// lib/r2.js
// Thin wrapper around the S3-compatible Cloudflare R2 API. Two buckets:
// one public (gallery/news/event photos, attachments, payment receipts --
// anything served to visitors), one private (membership application
// documents, which contain PII and are only ever streamed through an
// authenticated admin route, never exposed as a direct URL).

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  // R2 doesn't support the newer AWS flexible-checksum headers that recent
  // SDK versions send by default -- without this, uploads fail.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const PUBLIC_BUCKET = process.env.R2_BUCKET_PUBLIC;
const PRIVATE_BUCKET = process.env.R2_BUCKET_PRIVATE;
const PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

function publicUrlForKey(key) {
  return `${PUBLIC_BASE_URL}/${key}`;
}

async function putObject(bucket, key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return key;
}

function putPublicObject(key, body, contentType) {
  return putObject(PUBLIC_BUCKET, key, body, contentType);
}

function putPrivateObject(key, body, contentType) {
  return putObject(PRIVATE_BUCKET, key, body, contentType);
}

function getObject(bucket, key) {
  return s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
}

function getPublicObject(key) {
  return getObject(PUBLIC_BUCKET, key);
}

function getPrivateObject(key) {
  return getObject(PRIVATE_BUCKET, key);
}

async function deleteObject(bucket, key) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

function deletePublicObject(key) {
  return deleteObject(PUBLIC_BUCKET, key);
}

function deletePrivateObject(key) {
  return deleteObject(PRIVATE_BUCKET, key);
}

// Used only when a CPD event attachment's key has to change after the event
// row gets its real id (see routes/events.js). R2 has no rename -- copy to
// the new key, then drop the old one.
async function renamePublicObject(oldKey, newKey) {
  await s3.send(new CopyObjectCommand({
    Bucket: PUBLIC_BUCKET,
    CopySource: `${PUBLIC_BUCKET}/${oldKey}`,
    Key: newKey,
  }));
  await deletePublicObject(oldKey);
}

// Reads a GetObject response body fully into a string (used only for the
// small .txt news-document auto-extraction case).
async function objectBodyToString(object) {
  return object.Body.transformToString('utf-8');
}

function isNotFoundError(error) {
  return error && (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404);
}

module.exports = {
  s3,
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  publicUrlForKey,
  putPublicObject,
  putPrivateObject,
  getPublicObject,
  getPrivateObject,
  deleteObject,
  deletePublicObject,
  deletePrivateObject,
  renamePublicObject,
  objectBodyToString,
  isNotFoundError,
};
