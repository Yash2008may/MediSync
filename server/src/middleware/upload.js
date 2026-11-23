import multer from 'multer';

// Memory storage: we check the real file type (magic bytes) before anything touches disk.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const uploadSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
}).single('file');
