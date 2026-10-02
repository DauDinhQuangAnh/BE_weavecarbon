const axios = require('axios');
const chatService = require('../shared/rag');
const logger = require('../shared/logger');

const VALID_KINDS = new Set([
  'electricity_bill',
  'fuel_receipt',
  'bom',
  'material_invoice',
  'warehouse_receipt',
  'supplier_certificate',
  'supplier_declaration',
  'logistics_invoice',
  'bill_of_lading',
  'air_waybill',
  'export_invoice',
  'packing_list',
  'emission_factor_source',
  'methodology',
  'pcf_source',
  'other'
]);

const KIND_DISPLAY_NAMES = {
  electricity_bill: 'Hóa đơn tiền điện (EVN)',
  fuel_receipt: 'Hóa đơn nhiên liệu (Xăng/Dầu/Khí)',
  bom: 'Định mức nguyên vật liệu (BOM)',
  material_invoice: 'Hóa đơn nguyên phụ liệu',
  warehouse_receipt: 'Phiếu nhập/xuất kho',
  supplier_certificate: 'Chứng chỉ nhà cung cấp (GOTS/GRS/ISO)',
  supplier_declaration: 'Tờ khai nhà cung cấp',
  logistics_invoice: 'Hóa đơn vận chuyển',
  bill_of_lading: 'Vận đơn đường biển (B/L)',
  air_waybill: 'Vận đơn hàng không (AWB)',
  export_invoice: 'Hóa đơn xuất khẩu',
  packing_list: 'Phiếu đóng gói (Packing List)',
  emission_factor_source: 'Nguồn hệ số phát thải',
  methodology: 'Tài liệu phương pháp tính',
  pcf_source: 'Nguồn PCF bao quát',
  other: 'Chứng từ khác'
};

const PROMPT_TEMPLATE = `Bạn là chuyên gia thẩm định hồ sơ kiểm toán carbon theo ISO 14064, ISO 14067 và cơ chế CBAM Châu Âu.
Nhiệm vụ: Phân tích kỹ hình ảnh hoặc tài liệu chứng từ được cung cấp, nhận diện chính xác loại chứng từ và trích xuất toàn bộ dữ liệu định lượng.

Hãy phân loại trường "detected_kind" thành MỘT trong các giá trị sau:
- electricity_bill: Hóa đơn tiền điện (EVN, điện lực...)
- fuel_receipt: Hóa đơn nhiên liệu (xăng, dầu diesel, LPG, than, sinh khối...)
- bom: Bảng định mức nguyên vật liệu sản phẩm (Bill of Materials)
- material_invoice: Hóa đơn mua bán nguyên phụ liệu, hóa chất, sợi, vải...
- warehouse_receipt: Phiếu nhập kho, xuất kho
- supplier_certificate: Chứng chỉ nguồn gốc / môi trường (GOTS, GRS, OEKO-TEX, ISO 14064, ISO 14067...)
- supplier_declaration: Tờ khai phát thải / cam kết nhà cung ứng
- logistics_invoice: Hóa đơn cước vận tải nội địa hoặc quốc tế
- bill_of_lading: Vận đơn đường biển (B/L, Seaway Bill, Booking note)
- air_waybill: Vận đơn hàng không (AWB)
- export_invoice: Hóa đơn thương mại xuất khẩu (Commercial Invoice)
- packing_list: Phiếu đóng gói hàng hóa
- emission_factor_source: Báo cáo công bố hệ số phát thải
- methodology: Hướng dẫn / phương pháp tính toán phát thải
- other: Các loại tài liệu khác

Trả về định dạng JSON thuần túy (không bọc trong markdown, không thêm lời dẫn giải):
{
  "detected_kind": "loại chứng từ theo danh sách trên",
  "document_title": "tên tiêu đề chứng từ nhận diện được",
  "supplier_name": "tên công ty / đơn vị phát hành hoặc bán hàng (hoặc null)",
  "period_start": "YYYY-MM-DD hoặc null",
  "period_end": "YYYY-MM-DD hoặc null",
  "billing_period": "YYYY-MM hoặc YYYY-QX hoặc null",
  "facility_name": "tên cơ sở / nhà máy / trạm / chi nhánh nếu có (hoặc null)",
  "kwh_total": số kWh điện tiêu thụ nếu là hóa đơn điện (hoặc null),
  "fuel_type": "diesel | petrol | lpg | cng | coal | biomass | other (hoặc null)",
  "fuel_liters": số lượng lít hoặc kg nhiên liệu nếu là hóa đơn nhiên liệu (hoặc null),
  "emission_factor": số hệ số phát thải nếu có trên tài liệu (hoặc null),
  "emission_factor_source": "nguồn hệ số nếu ghi trên tài liệu (hoặc null)",
  "total_amount": tổng tiền thanh toán dạng số (hoặc null),
  "currency": "VND | USD | EUR | v.v. (hoặc null)",
  "meter_number": "mã công tơ hoặc mã trạm đo nếu có (hoặc null)",
  "invoice_number": "số hóa đơn hoặc số tham chiếu (hoặc null)",
  "confidence": số thực từ 0.5 đến 1.0 biểu thị độ tin cậy nhận diện,
  "summary": "1 câu tóm tắt bằng tiếng Việt mô tả nội dung chứng từ"
}`;

/**
 * Normalizes kind string to one of the supported kinds.
 */
function normalizeKind(kind) {
  const k = String(kind || '').trim().toLowerCase();
  return VALID_KINDS.has(k) ? k : 'other';
}

/**
 * Robust JSON parser from LLM text output.
 */
function extractJsonFromText(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try regex extraction of first JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Direct Gemini Vision extraction via Google Generative Language REST API.
 */
async function callGeminiDirect({ buffer, mimeType, filename }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const isImage = (mimeType || '').startsWith('image/');
  const isPdf = (mimeType || '').includes('pdf') || (filename || '').toLowerCase().endsWith('.pdf');

  const parts = [];

  if (isImage) {
    parts.push({
      inline_data: {
        mime_type: mimeType || 'image/jpeg',
        data: buffer.toString('base64')
      }
    });
  } else if (isPdf) {
    // Gemini 1.5+ and 3.x support application/pdf via inline_data
    parts.push({
      inline_data: {
        mime_type: 'application/pdf',
        data: buffer.toString('base64')
      }
    });
  } else {
    // Plain text / CSV / JSON representation
    const textSnippet = buffer.toString('utf-8', 0, Math.min(buffer.length, 12000));
    parts.push({
      text: `Nội dung tệp (${filename}):\n${textSnippet}`
    });
  }

  parts.push({ text: PROMPT_TEMPLATE });

  const response = await axios.post(
    url,
    {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    },
    { timeout: 35000 }
  );

  const candidate = response.data?.candidates?.[0];
  const responseText = candidate?.content?.parts?.[0]?.text;
  const parsed = extractJsonFromText(responseText);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini API did not return a valid JSON object.');
  }

  return parsed;
}

/**
 * Rule-based heuristic analyzer for offline / network failure resilience.
 */
function heuristicAnalyze({ buffer, filename, hintKind }) {
  const lowerName = String(filename || '').toLowerCase();
  const textContent = buffer.toString('utf-8', 0, Math.min(buffer.length, 8000)).toLowerCase();

  let detectedKind = hintKind && VALID_KINDS.has(hintKind) ? hintKind : 'other';
  let title = 'Tài liệu chứng từ';
  let supplier = null;
  let kwh = null;
  let fuelType = null;
  let fuelLiters = null;
  let billingPeriod = null;

  // Electricity heuristics
  if (lowerName.includes('dien') || lowerName.includes('evn') || lowerName.includes('kwh') || textContent.includes('điện lực') || textContent.includes('evn') || textContent.includes('kwh')) {
    detectedKind = 'electricity_bill';
    title = 'Hóa đơn tiền điện (EVN)';
    supplier = 'Tổng công ty Điện lực (EVN)';
    const kwhMatch = textContent.match(/(\d+[\d.,]*)\s*kwh/i) || lowerName.match(/(\d+)\s*kwh/i);
    if (kwhMatch) {
      kwh = parseFloat(kwhMatch[1].replace(/,/g, ''));
    }
  } else if (lowerName.includes('xang') || lowerName.includes('dau') || lowerName.includes('nhien_lieu') || lowerName.includes('petro') || textContent.includes('petrolimex') || textContent.includes('diesel')) {
    detectedKind = 'fuel_receipt';
    title = 'Hóa đơn nhiên liệu';
    supplier = 'Petrolimex';
    fuelType = 'diesel';
    const literMatch = textContent.match(/(\d+[\d.,]*)\s*(l|lít|liters)/i) || lowerName.match(/(\d+)\s*(l|lit)/i);
    if (literMatch) {
      fuelLiters = parseFloat(literMatch[1].replace(/,/g, ''));
    }
  } else if (lowerName.includes('bom') || textContent.includes('bill of material')) {
    detectedKind = 'bom';
    title = 'Định mức BOM nguyên vật liệu';
  } else if (lowerName.includes('vận đơn') || lowerName.includes('bill') || lowerName.includes('bol') || lowerName.includes('lading')) {
    detectedKind = 'bill_of_lading';
    title = 'Vận đơn đường biển (B/L)';
  }

  // Period heuristics
  const periodMatch = textContent.match(/(202\d[-/]\d{2})/) || lowerName.match(/(202\d[-_]\d{2})/);
  if (periodMatch) {
    billingPeriod = periodMatch[1].replace('_', '-').replace('/', '-');
  }

  return {
    detected_kind: detectedKind,
    document_title: title,
    supplier_name: supplier,
    period_start: billingPeriod ? `${billingPeriod}-01` : null,
    period_end: billingPeriod ? `${billingPeriod}-28` : null,
    billing_period: billingPeriod,
    facility_name: 'Main Facility',
    kwh_total: kwh,
    fuel_type: fuelType,
    fuel_liters: fuelLiters,
    emission_factor: detectedKind === 'electricity_bill' ? 0.4290 : (fuelType === 'diesel' ? 2.688 : null),
    emission_factor_source: detectedKind === 'electricity_bill' ? 'VN Ministry of Natural Resources 2024' : null,
    total_amount: null,
    currency: 'VND',
    meter_number: null,
    invoice_number: null,
    confidence: 0.65,
    summary: `Nhận diện theo cấu trúc: ${title} (${filename})`
  };
}

/**
 * Main entrypoint: Analyzes an uploaded evidence file.
 * Tries RAG /extract first if reachable, then direct Gemini Vision, then intelligent heuristic.
 */
async function analyzeEvidenceFile({ buffer, mimeType, filename, hintKind = 'auto' }) {
  let rawResult = null;
  let source = 'gemini-vision';

  // 1. First attempt: Direct Gemini Vision REST API
  if (process.env.GEMINI_API_KEY) {
    try {
      rawResult = await callGeminiDirect({ buffer, mimeType, filename });
      logger.info({ filename, kind: rawResult?.detected_kind }, '[aiExtractor] Direct Gemini Vision analysis succeeded');
    } catch (directErr) {
      logger.warn({ err: directErr.message, filename }, '[aiExtractor] Direct Gemini Vision failed, attempting RAG fallback');
    }
  }

  // 2. Second attempt: RAG /extract endpoint if direct failed or no key
  if (!rawResult) {
    try {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), filename || 'evidence');
      form.append('kind', hintKind !== 'auto' ? hintKind : 'other');
      form.append('language', 'vi');

      const ragResponse = await chatService.callGlobalRagEndpoint('/extract', {
        method: 'POST',
        data: form,
        timeout: 25000
      });

      const fields = ragResponse?.fields ?? ragResponse ?? {};
      if (fields && typeof fields === 'object' && Object.keys(fields).length > 0) {
        source = 'rag-extract';
        rawResult = {
          detected_kind: normalizeKind(fields.kind || hintKind),
          document_title: fields.document_title || KIND_DISPLAY_NAMES[fields.kind] || 'Chứng từ',
          supplier_name: fields.supplier || fields.supplier_name || null,
          period_start: fields.period_start || null,
          period_end: fields.period_end || null,
          billing_period: fields.billing_period || null,
          kwh_total: fields.kwh_total ? Number(fields.kwh_total) : null,
          fuel_type: fields.fuel_type || null,
          fuel_liters: fields.liters ? Number(fields.liters) : null,
          total_amount: fields.amount_vnd ? Number(fields.amount_vnd) : null,
          currency: 'VND',
          confidence: 0.85,
          summary: `Trích xuất từ AI RAG cho chứng từ ${filename}`
        };
      }
    } catch (ragErr) {
      logger.warn({ err: ragErr.message, filename }, '[aiExtractor] RAG /extract failed, falling back to heuristic');
    }
  }

  // 3. Third attempt: Heuristic fallback
  if (!rawResult) {
    source = 'heuristic';
    rawResult = heuristicAnalyze({ buffer, filename, hintKind });
  }

  // Standardize the final payload
  const finalKind = normalizeKind(rawResult.detected_kind || hintKind);
  const displayTitle = rawResult.document_title || KIND_DISPLAY_NAMES[finalKind] || 'Chứng từ thẩm định';

  return {
    success: true,
    source,
    detected_kind: finalKind,
    document_title: displayTitle,
    supplier_name: rawResult.supplier_name || null,
    period_start: rawResult.period_start || null,
    period_end: rawResult.period_end || null,
    billing_period: rawResult.billing_period || (rawResult.period_start ? String(rawResult.period_start).slice(0, 7) : null),
    facility_name: rawResult.facility_name || 'Main Facility',
    kwh_total: rawResult.kwh_total != null ? Number(rawResult.kwh_total) : null,
    fuel_type: rawResult.fuel_type || 'diesel',
    fuel_liters: rawResult.fuel_liters != null ? Number(rawResult.fuel_liters) : null,
    emission_factor: rawResult.emission_factor != null ? Number(rawResult.emission_factor) : (finalKind === 'electricity_bill' ? 0.4290 : null),
    emission_factor_source: rawResult.emission_factor_source || (finalKind === 'electricity_bill' ? 'VN Ministry of Natural Resources 2024' : null),
    total_amount: rawResult.total_amount != null ? Number(rawResult.total_amount) : null,
    currency: rawResult.currency || 'VND',
    meter_number: rawResult.meter_number || null,
    invoice_number: rawResult.invoice_number || null,
    confidence: rawResult.confidence != null ? Math.min(1, Math.max(0.5, Number(rawResult.confidence))) : 0.9,
    summary: rawResult.summary || `Đã trích xuất thông tin ${displayTitle} từ ${filename}`,
    raw_fields: {
      ...rawResult,
      detected_kind: finalKind,
      document_title: displayTitle
    }
  };
}

module.exports = {
  analyzeEvidenceFile,
  normalizeKind,
  VALID_KINDS,
  KIND_DISPLAY_NAMES
};
