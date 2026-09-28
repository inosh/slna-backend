// middleware/upload.js
// Configures Multer to handle file uploads (photos and documents),
// saving them to local disk under /uploads. When you move to
// production, this is the only file you'll need to change to
// upload to Cloudflare R2 or S3 instead.

const multer = require('multer');
const path = require('path');
const fs = require('fs');

function makeStorage(subfolder) {
  const dir = path.join(__dirname, '..', 'uploads', subfolder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${timestamp}-${safeName}`);
    },
  });
}

// Storage for files tied to a specific event: named
// timestamp-eventid-eventdate-originalname. The event id comes from the
// route param :id when editing an existing event, or from the event_id
// form field for standalone uploads like registration receipts (that route
// has no :id param). Requires the id/date text fields to be sent before
// the file field in the multipart body, since multer parses in order.
function makeEventFileStorage(subfolder) {
  const dir = path.join(__dirname, '..', 'uploads', subfolder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const eventId = req.params.id || req.body.event_id || 'new';
      const eventDate = String(req.body.event_date || 'unknown-date').slice(0, 10);
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${timestamp}-${eventId}-${eventDate}-${safeName}`);
    },
  });
}

const imageFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only image files (JPEG, PNG, WEBP, GIF, SVG) are allowed.'));
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

const uploadNewsPhoto = multer({
  storage: makeStorage('news'),
  fileFilter: imageFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
});

// News create/update: the "document" field (typed .txt/.pdf/.docx) needs the
// document filter, while "photo" (cover) and "photos" (gallery, becomes a
// linked album) are images -- route each field to the right filter by name.
const newsUploadFilter = (req, file, cb) => {
  if (file.fieldname === 'document') return documentFilter(req, file, cb);
  if (file.fieldname === 'photo' || file.fieldname === 'photos') return imageFilter(req, file, cb);
  cb(new Error('Unexpected upload field.'));
};

const uploadNewsDocument = multer({
  storage: makeStorage('news'),
  fileFilter: newsUploadFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
});

const uploadAlbumPhotos = multer({
  storage: makeStorage('albums'),
  fileFilter: imageFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
});

// Event photos (CPD and Other events)
const uploadEventPhoto = multer({
  storage: makeStorage('events'),
  fileFilter: imageFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
});

// CPD event create/update: handles the optional "photo" (image) and
// "attachment" (PDF) fields together, routing each to its own folder and
// filename convention based on which field it arrived as.
const cpdEventFilesStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subfolder = file.fieldname === 'attachment' ? 'events/attachements' : 'events';
    const dir = path.join(__dirname, '..', 'uploads', subfolder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');

    if (file.fieldname === 'attachment') {
      const eventId = req.params.id || 'new';
      const eventDate = String(req.body.event_date || 'unknown-date').slice(0, 10);
      return cb(null, `${timestamp}-${eventId}-${eventDate}-${safeName}`);
    }

    cb(null, `${timestamp}-${safeName}`);
  },
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

// CPD event registration payment receipts
const uploadEventPayment = multer({
  storage: makeEventFileStorage('events/payments'),
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
