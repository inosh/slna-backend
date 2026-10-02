// middleware/upload.js
// Configures Multer to handle file uploads (photos and documents),
// streaming them straight to Cloudflare R2 instead of local disk -- the
// public bucket for most uploads, the private bucket for anything
// sensitive (currently just event registration payment receipts). Each
// multer file ends up with a `.key` property (the R2 object key, e.g.
// "albums/1699999999-photo.jpg") in place of the old `.filename`. Public
// files are stored as `/uploads/${file.key}`; private ones store the bare
// key directly and are served through an authenticated proxy route.

const multer = require('multer');
const { Upload } = require('@aws-sdk/lib-storage');
const { s3, PUBLIC_BUCKET, PRIVATE_BUCKET, deleteObject } = require('../lib/r2');

// Minimal multer StorageEngine that uploads the incoming file stream
// directly to R2 (via a multipart upload for large files, e.g. gallery
// videos) instead of writing to a local directory. Works against either
// bucket -- most uploads are public, but e.g. event registration payment
// receipts go to the private bucket.
class R2Storage {
  constructor(bucket, keyFn) {
    this.bucket = bucket;
    this.keyFn = keyFn;
  }

  _handleFile(req, file, callback) {
    const key = this.keyFn(req, file);

    const upload = new Upload({
      client: s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: file.stream,
        ContentType: file.mimetype,
      },
    });

    upload.done()
      .then((result) => {
        callback(null, { key, size: result.ContentLength });
      })
      .catch(callback);
  }

  _removeFile(req, file, callback) {
    deleteObject(this.bucket, file.key).then(() => callback(null)).catch(callback);
  }
}

function safeName(originalname) {
  return originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

function makeStorage(subfolder) {
  return new R2Storage(PUBLIC_BUCKET, (req, file) => {
    const timestamp = Date.now();
    return `${subfolder}/${timestamp}-${safeName(file.originalname)}`;
  });
}

// Storage for files tied to a specific event: named
// timestamp-eventid-eventdate-originalname. The event id comes from the
// route param :id when editing an existing event, or from the event_id
// form field for standalone uploads like registration receipts (that route
// has no :id param). Requires the id/date text fields to be sent before
// the file field in the multipart body, since multer parses in order.
function makeEventFileStorage(subfolder, bucket = PUBLIC_BUCKET) {
  return new R2Storage(bucket, (req, file) => {
    const timestamp = Date.now();
    const eventId = req.params.id || req.body.event_id || 'new';
    const eventDate = String(req.body.event_date || 'unknown-date').slice(0, 10);
    return `${subfolder}/${timestamp}-${eventId}-${eventDate}-${safeName(file.originalname)}`;
  });
}

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/ogg'];

const imageFilter = (req, file, cb) => {
  if (IMAGE_MIME_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only image files (JPEG, PNG, WEBP, GIF, SVG) are allowed.'));
};

// Albums accept both photos and videos in the same "photos" field.
const albumMediaFilter = (req, file, cb) => {
  if (IMAGE_MIME_TYPES.includes(file.mimetype) || VIDEO_MIME_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only image (JPEG, PNG, WEBP, GIF, SVG) or video (MP4, WEBM, MOV, AVI, OGG) files are allowed.'));
};

const documentFilter = (req, file, cb) => {
  const allowed = ['text/plain', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only .txt, .pdf, or .docx files are allowed.'));
};

const pdfFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') cb(null, true);
  else cb(new Error('Only PDF files are allowed for event attachments.'));
};

const receiptFilter = (req, file, cb) => {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only PDF, JPEG, or PNG files are allowed for payment receipts.'));
};

// News create/update: "photo" (cover) stays image-only, while "photos"
// (gallery, becomes a linked album) accepts photos and videos like the
// standalone Gallery album uploads do.
const newsPhotoFilter = (req, file, cb) => {
  if (file.fieldname === 'photo') return imageFilter(req, file, cb);
  if (file.fieldname === 'photos') return albumMediaFilter(req, file, cb);
  cb(new Error('Unexpected upload field.'));
};

const uploadNewsPhoto = multer({
  storage: makeStorage('news'),
  fileFilter: newsPhotoFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max (videos are much larger than photos)
});

// News create/update: the "document" field (typed .txt/.pdf/.docx) needs the
// document filter, "photo" (cover) is image-only, and "photos" (gallery,
// becomes a linked album) accepts photos and videos -- route each field to
// the right filter by name.
const newsUploadFilter = (req, file, cb) => {
  if (file.fieldname === 'document') return documentFilter(req, file, cb);
  if (file.fieldname === 'photo') return imageFilter(req, file, cb);
  if (file.fieldname === 'photos') return albumMediaFilter(req, file, cb);
  cb(new Error('Unexpected upload field.'));
};

const uploadNewsDocument = multer({
  storage: makeStorage('news'),
  fileFilter: newsUploadFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max (videos are much larger than photos)
});

const uploadAlbumPhotos = multer({
  storage: makeStorage('albums'),
  fileFilter: albumMediaFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max (videos are much larger than photos)
});

// Event photos (CPD and Other events)
const uploadEventPhoto = multer({
  storage: makeStorage('events'),
  fileFilter: imageFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
});

// CPD event create/update: handles the optional "photo" (image) and
// "attachment" (PDF) fields together, routing each to its own key prefix
// and filename convention based on which field it arrived as.
const cpdEventFilesStorage = new R2Storage(PUBLIC_BUCKET, (req, file) => {
  const timestamp = Date.now();

  if (file.fieldname === 'attachment') {
    const eventId = req.params.id || 'new';
    const eventDate = String(req.body.event_date || 'unknown-date').slice(0, 10);
    return `events/attachements/${timestamp}-${eventId}-${eventDate}-${safeName(file.originalname)}`;
  }

  return `events/${timestamp}-${safeName(file.originalname)}`;
});

const uploadCpdEventFiles = multer({
  storage: cpdEventFilesStorage,
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'photo') return imageFilter(req, file, cb);
    if (file.fieldname === 'attachment') return pdfFilter(req, file, cb);
    cb(new Error('Unexpected upload field.'));
  },
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
}).fields([
  { name: 'photo', maxCount: 1 },
  { name: 'attachment', maxCount: 1 }
]);

// CPD event registration payment receipts -- these contain bank/payment
// details, so they go to the private bucket, not the public one.
const uploadEventPayment = multer({
  storage: makeEventFileStorage('event-registrations', PRIVATE_BUCKET),
  fileFilter: receiptFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
});

module.exports = {
  uploadNewsPhoto,
  uploadNewsDocument,
  uploadAlbumPhotos,
  uploadEventPhoto,
  uploadCpdEventFiles,
  uploadEventPayment,
};
