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

const uploadNewsPhoto = multer({
  storage: makeStorage('news'),
  fileFilter: imageFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
});

const uploadNewsDocument = multer({
  storage: makeStorage('news'),
  fileFilter: documentFilter,
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

module.exports = {
  uploadNewsPhoto,
  uploadNewsDocument,
  uploadAlbumPhotos,
  uploadEventPhoto,
};
