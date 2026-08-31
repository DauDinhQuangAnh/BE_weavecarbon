const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { UPLOADS_ROOT } = require('../shared/runtime');

function safeCompanySegment(companyId) {
  const value = String(companyId || '').toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) {
    throw new Error('Invalid company identifier for evidence storage.');
  }
  return value;
}

function safeExtension(originalFilename) {
  const extension = path.extname(String(originalFilename || '')).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
}

function resolveStoragePath(storageKey, uploadsRoot = UPLOADS_ROOT) {
  const root = path.resolve(uploadsRoot);
  const filePath = path.resolve(root, ...String(storageKey || '').split('/'));
  const relativePath = path.relative(root, filePath);

  if (!storageKey || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Evidence storage path escapes UPLOADS_ROOT.');
  }
  return filePath;
}

async function storeEvidenceFile({
  companyId,
  originalFilename,
  buffer,
  uploadsRoot = UPLOADS_ROOT,
  now = new Date(),
}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Evidence file buffer is empty.');
  }

  const companySegment = safeCompanySegment(companyId);
  const year = String(now.getUTCFullYear());
  const storageKey = [
    'evidence',
    companySegment,
    year,
    `${crypto.randomUUID()}${safeExtension(originalFilename)}`,
  ].join('/');
  const filePath = resolveStoragePath(storageKey, uploadsRoot);
  const partialPath = `${filePath}.partial-${crypto.randomUUID()}`;

  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    await fs.promises.writeFile(partialPath, buffer, { flag: 'wx', mode: 0o600 });
    await fs.promises.rename(partialPath, filePath);
  } catch (error) {
    await fs.promises.rm(partialPath, { force: true }).catch(() => {});
    throw error;
  }

  return { storageKey, filePath };
}

async function removeEvidenceFile(storageKey, uploadsRoot = UPLOADS_ROOT) {
  const filePath = resolveStoragePath(storageKey, uploadsRoot);
  await fs.promises.rm(filePath, { force: true });
}

module.exports = {
  removeEvidenceFile,
  resolveStoragePath,
  safeExtension,
  storeEvidenceFile,
};
