const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  removeEvidenceFile,
  resolveStoragePath,
  safeExtension,
  storeEvidenceFile,
} = require('../../src/services/evidenceFileStorage');

describe('evidenceFileStorage', () => {
  let uploadsRoot;

  beforeEach(async () => {
    uploadsRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wc-evidence-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(uploadsRoot, { recursive: true, force: true });
  });

  it('atomically stores evidence beneath the company and year path', async () => {
    const buffer = Buffer.from('synthetic evidence bytes');
    const stored = await storeEvidenceFile({
      companyId: '123e4567-e89b-12d3-a456-426614174000',
      originalFilename: 'Invoice.PDF',
      buffer,
      uploadsRoot,
      now: new Date('2026-08-27T10:00:00Z'),
    });

    expect(stored.storageKey).toMatch(
      /^evidence\/123e4567-e89b-12d3-a456-426614174000\/2026\/[a-f0-9-]+\.pdf$/
    );
    await expect(fs.promises.readFile(stored.filePath)).resolves.toEqual(buffer);
    expect(path.relative(uploadsRoot, stored.filePath)).not.toMatch(/^\.\./);
  });

  it('removes only a path resolved inside the uploads root', async () => {
    const stored = await storeEvidenceFile({
      companyId: '123e4567-e89b-12d3-a456-426614174000',
      originalFilename: 'invoice.csv',
      buffer: Buffer.from('a,b\n1,2\n'),
      uploadsRoot,
    });

    await removeEvidenceFile(stored.storageKey, uploadsRoot);
    await expect(fs.promises.access(stored.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects traversal paths and unsafe extensions', () => {
    expect(() => resolveStoragePath('../outside.txt', uploadsRoot)).toThrow('escapes UPLOADS_ROOT');
    expect(safeExtension('invoice.pdf.exe')).toBe('.exe');
    expect(safeExtension('invoice.very-long-extension')).toBe('');
    expect(safeExtension('../../invoice.PDF')).toBe('.pdf');
  });
});
