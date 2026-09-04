const path = require('path');
const JSZip = require('jszip');

const ALLOWED_TYPES = Object.freeze({
  '.pdf': { mimes: ['application/pdf'], magic: Buffer.from('%PDF-') },
  '.png': { mimes: ['image/png'], magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  '.jpg': { mimes: ['image/jpeg'], magic: Buffer.from([0xff, 0xd8, 0xff]) },
  '.jpeg': { mimes: ['image/jpeg'], magic: Buffer.from([0xff, 0xd8, 0xff]) },
  '.csv': { mimes: ['text/csv', 'application/csv', 'text/plain'] },
  '.txt': { mimes: ['text/plain'] },
  '.xlsx': {
    mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    zipRoot: 'xl/'
  },
  '.docx': {
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    zipRoot: 'word/'
  }
});

function uploadError(message, code = 'UNSAFE_UPLOAD') {
  const error = new Error(message);
  error.statusCode = 415;
  error.code = code;
  return error;
}

function sanitizeUploadFilename(value) {
  const withoutControls = Array.from(String(value || 'document'))
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint > 31 && codePoint !== 127;
    })
    .join('');
  const base = path.basename(withoutControls)
    .replace(/[^a-zA-Z0-9._() -]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 180)
    .trim();
  return base && base !== '.' && base !== '..' ? base : 'document';
}

function beginsWith(buffer, signature) {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

async function assertSafeEvidenceUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw uploadError('Uploaded evidence file is empty.', 'EMPTY_UPLOAD');
  }

  const filename = sanitizeUploadFilename(file.originalname);
  const extension = path.extname(filename).toLowerCase();
  const policy = ALLOWED_TYPES[extension];
  if (!policy) {
    throw uploadError(`Evidence file type ${extension || '<none>'} is not allowed.`);
  }

  const mime = String(file.mimetype || '').toLowerCase();
  if (!policy.mimes.includes(mime)) {
    throw uploadError(`Evidence MIME type ${mime || '<none>'} does not match ${extension}.`);
  }

  if (policy.magic && !beginsWith(file.buffer, policy.magic)) {
    throw uploadError(`Evidence content does not match ${extension}.`);
  }

  if (policy.zipRoot) {
    if (!beginsWith(file.buffer, Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw uploadError(`Evidence content is not a valid ${extension} package.`);
    }
    let zip;
    try {
      zip = await JSZip.loadAsync(file.buffer, { checkCRC32: true });
    } catch {
      throw uploadError(`Evidence content is not a readable ${extension} package.`);
    }
    const names = Object.keys(zip.files);
    if (!names.includes('[Content_Types].xml') || !names.some((name) => name.startsWith(policy.zipRoot))) {
      throw uploadError(`Evidence package content does not match ${extension}.`);
    }
  }

  if ((extension === '.csv' || extension === '.txt') && file.buffer.includes(0)) {
    throw uploadError('Text evidence contains binary NUL bytes.');
  }

  return { filename, extension, mime };
}

module.exports = {
  ALLOWED_TYPES,
  assertSafeEvidenceUpload,
  sanitizeUploadFilename
};
