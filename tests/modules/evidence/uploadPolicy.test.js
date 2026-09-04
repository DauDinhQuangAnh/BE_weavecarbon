const JSZip = require('jszip');
const {
  assertSafeEvidenceUpload,
  sanitizeUploadFilename
} = require('../../../src/modules/evidence/uploadPolicy');

describe('evidence upload policy', () => {
  test('accepts a real PDF signature and sanitizes path/control characters', async () => {
    const result = await assertSafeEvidenceUpload({
      originalname: '../unsafe\u0000 invoice.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nbody')
    });
    expect(result.filename).toBe('unsafe invoice.pdf');
    expect(sanitizeUploadFilename('../../x<script>.pdf')).toBe('x_script_.pdf');
  });

  test.each([
    ['malware.exe', 'application/octet-stream', Buffer.from('MZ')],
    ['fake.pdf', 'application/pdf', Buffer.from('MZ executable')],
    ['image.jpg', 'image/png', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ['bad.txt', 'text/plain', Buffer.from([0x61, 0x00, 0x62])]
  ])('rejects unsafe or mismatched upload %s', async (originalname, mimetype, buffer) => {
    await expect(assertSafeEvidenceUpload({ originalname, mimetype, buffer }))
      .rejects.toMatchObject({ statusCode: 415, code: 'UNSAFE_UPLOAD' });
  });

  test('checks OOXML package content instead of trusting ZIP magic', async () => {
    const fakeZip = new JSZip();
    fakeZip.file('[Content_Types].xml', '<Types/>');
    fakeZip.file('evil/payload.bin', 'x');
    const fakeBuffer = await fakeZip.generateAsync({ type: 'nodebuffer' });
    await expect(assertSafeEvidenceUpload({
      originalname: 'fake.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: fakeBuffer
    })).rejects.toMatchObject({ code: 'UNSAFE_UPLOAD' });

    const workbook = new JSZip();
    workbook.file('[Content_Types].xml', '<Types/>');
    workbook.file('xl/workbook.xml', '<workbook/>');
    const workbookBuffer = await workbook.generateAsync({ type: 'nodebuffer' });
    await expect(assertSafeEvidenceUpload({
      originalname: 'safe.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: workbookBuffer
    })).resolves.toMatchObject({ extension: '.xlsx' });
  });
});
