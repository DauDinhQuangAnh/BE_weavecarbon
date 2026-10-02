jest.mock('axios');
const axios = require('axios');
const {
  analyzeEvidenceFile,
  normalizeKind,
  VALID_KINDS,
  KIND_DISPLAY_NAMES
} = require('../../../src/modules/evidence/aiExtractor');

describe('aiExtractor module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constants', () => {
    test('defines required kinds and display names', () => {
      expect(VALID_KINDS.has('electricity_bill')).toBe(true);
      expect(VALID_KINDS.has('fuel_receipt')).toBe(true);
      expect(VALID_KINDS.has('bom')).toBe(true);
      expect(KIND_DISPLAY_NAMES.electricity_bill).toBeDefined();
      expect(KIND_DISPLAY_NAMES.fuel_receipt).toBeDefined();
    });
  });

  describe('normalizeKind', () => {
    test('returns valid kinds as is', () => {
      expect(normalizeKind('electricity_bill')).toBe('electricity_bill');
      expect(normalizeKind('fuel_receipt')).toBe('fuel_receipt');
      expect(normalizeKind('bom')).toBe('bom');
      expect(normalizeKind('other')).toBe('other');
    });

    test('normalizes casing and trims whitespace', () => {
      expect(normalizeKind('  ELECTRICITY_BILL  ')).toBe('electricity_bill');
      expect(normalizeKind('Fuel_Receipt')).toBe('fuel_receipt');
    });

    test('falls back to other for unknown kinds', () => {
      expect(normalizeKind('unknown_document')).toBe('other');
      expect(normalizeKind(null)).toBe('other');
      expect(normalizeKind(undefined)).toBe('other');
    });
  });

  describe('analyzeEvidenceFile with Gemini Vision', () => {
    test('extracts structured JSON when Gemini returns valid response', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      detected_kind: 'electricity_bill',
                      document_title: 'Hóa đơn tiền điện EVN',
                      supplier_name: 'EVN Hà Nội',
                      kwh_total: 15420,
                      billing_period: '2026-03',
                      confidence: 0.98,
                      summary: 'Hóa đơn tiền điện EVN tháng 3/2026 với 15,420 kWh'
                    })
                  }
                ]
              }
            }
          ]
        }
      });

      const result = await analyzeEvidenceFile({
        buffer: Buffer.from('fake-image-bytes'),
        mimeType: 'image/jpeg',
        filename: 'evn_bill.jpg'
      });

      expect(result.success).toBe(true);
      expect(result.source).toBe('gemini-vision');
      expect(result.detected_kind).toBe('electricity_bill');
      expect(result.kwh_total).toBe(15420);
      expect(result.supplier_name).toBe('EVN Hà Nội');
      expect(result.confidence).toBe(0.98);
    });
  });

  describe('analyzeEvidenceFile heuristics fallback', () => {
    beforeEach(() => {
      axios.post.mockRejectedValue(new Error('Network error or API offline'));
    });

    test('identifies electricity bill from filename and text content', async () => {
      const buffer = Buffer.from('Hóa đơn tiền điện EVN Hà Nội. Điện năng tiêu thụ: 12,500 kWh. Kỳ: 2026-03.');
      const result = await analyzeEvidenceFile({
        buffer,
        mimeType: 'text/plain',
        filename: 'hoa_don_tien_dien_evn_t3_2026.pdf'
      });

      expect(result.success).toBe(true);
      expect(result.source).toBe('heuristic');
      expect(result.detected_kind).toBe('electricity_bill');
      expect(result.kwh_total).toBe(12500);
      expect(result.supplier_name).toBe('Tổng công ty Điện lực (EVN)');
      expect(result.emission_factor).toBe(0.4290);
    });

    test('identifies fuel receipt from filename and extracts fuel quantity', async () => {
      const buffer = Buffer.from('Công ty Xăng dầu Petrolimex. Dầu Diesel DO 0.05S. Số lượng: 3,450 lit.');
      const result = await analyzeEvidenceFile({
        buffer,
        mimeType: 'text/plain',
        filename: 'petrolimex_diesel_fuel_invoice.pdf'
      });

      expect(result.success).toBe(true);
      expect(result.source).toBe('heuristic');
      expect(result.detected_kind).toBe('fuel_receipt');
      expect(result.fuel_liters).toBe(3450);
      expect(result.fuel_type).toBe('diesel');
      expect(result.supplier_name).toBe('Petrolimex');
    });

    test('identifies BOM document from filename', async () => {
      const buffer = Buffer.from('Bảng định mức kỹ thuật nguyên vật liệu BOM áo thun cotton.');
      const result = await analyzeEvidenceFile({
        buffer,
        mimeType: 'text/plain',
        filename: 'BOM_cotton_tshirt_v2.xlsx'
      });

      expect(result.success).toBe(true);
      expect(result.source).toBe('heuristic');
      expect(result.detected_kind).toBe('bom');
    });

    test('respects hintKind when file is ambiguous', async () => {
      const buffer = Buffer.from('Random binary content');
      const result = await analyzeEvidenceFile({
        buffer,
        mimeType: 'application/octet-stream',
        filename: 'scan_001.pdf',
        hintKind: 'material_invoice'
      });

      expect(result.success).toBe(true);
      expect(result.detected_kind).toBe('material_invoice');
    });
  });
});
