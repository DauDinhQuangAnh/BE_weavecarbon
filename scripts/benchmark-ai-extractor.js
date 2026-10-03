const fs = require('fs');
const path = require('path');
const { analyzeEvidenceFile } = require('../src/modules/evidence/aiExtractor');

const SAMPLES_DIR = path.resolve(__dirname, '../test-evidence-samples');

async function runBenchmark() {
  console.log('=================================================================================');
  console.log('      WEAVECARBON AI EVIDENCE EXTRACTION BENCHMARK & COMPLETENESS AUDIT           ');
  console.log('=================================================================================\n');

  const files = [
    {
      name: 'evn_3prices_production_invoice.txt',
      mime: 'text/plain',
      description: 'Hóa đơn tiền điện sản xuất 3 giá EVN Bắc Ninh (BT, CĐ, TĐ, kvarh, Pmax)'
    },
    {
      name: 'petrolimex_fuel_receipt_nd123.txt',
      mime: 'text/plain',
      description: 'Hóa đơn điện tử xăng dầu Petrolimex NĐ 123 (Dầu Diesel DO 0.05S, xe 51C-889.24)'
    },
    {
      name: 'polo_shirt_bom_specification.csv',
      mime: 'text/csv',
      description: 'Bảng định mức BOM nguyên vật liệu áo Polo xuất khẩu EU (Organic Cotton)'
    },
    {
      name: 'ocean_bill_of_lading_maersk_catlai_rotterdam.txt',
      mime: 'text/plain',
      description: 'Vận đơn đường biển quốc tế Maersk (B/L Cát Lái -> Rotterdam, Container 40HC)'
    },
    {
      name: 'gots_organic_cotton_certificate.txt',
      mime: 'text/plain',
      description: 'Chứng chỉ xanh dệt may quốc tế GOTS (Control Union Cert CU849201GOTS)'
    },
    {
      name: 'mau-hoa-don-tien-dien-moi-9838.jpg',
      mime: 'image/jpeg',
      description: 'Hóa đơn tiền điện EVN Sài Gòn thực tế của người dùng (ảnh JPG scan)'
    }
  ];

  const results = [];

  for (const item of files) {
    const filePath = path.join(SAMPLES_DIR, item.name);
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      continue;
    }

    const buffer = fs.readFileSync(filePath);
    const start = Date.now();

    try {
      const res = await analyzeEvidenceFile({
        buffer,
        mimeType: item.mime,
        filename: item.name
      });
      const durationMs = Date.now() - start;

      results.push({
        filename: item.name,
        description: item.description,
        detected_kind: res.detected_kind,
        document_title: res.document_title,
        completeness_percent: res.completeness.score_percent,
        extracted_fields_count: res.completeness.extracted_fields_count,
        total_expected_fields: res.completeness.total_expected_fields,
        extracted_fields: res.completeness.extracted_fields,
        missing_fields: res.completeness.missing_fields,
        durationMs,
        confidence: Math.round(res.confidence * 100) + '%',
        ghg_scope: res.ghg_scope,
        calculated_tco2e: res.calculated_tco2e,
        summary: res.summary
      });
    } catch (err) {
      console.error(`Error processing ${item.name}:`, err.message);
    }
  }

  // Display Table Summary
  console.log('\n--- BẢNG TỔNG HỢP HIỆU NĂNG & ĐỘ HOÀN THIỆN TRÍCH XUẤT (% COMPLETENESS) ---\n');
  console.table(
    results.map((r, i) => ({
      'STT': i + 1,
      'Chứng từ': r.filename,
      'Loại nhận diện': r.detected_kind,
      '% Hoàn thiện': `${r.completeness_percent}% (${r.extracted_fields_count}/${r.total_expected_fields})`,
      'Độ tin cậy': r.confidence,
      'Thời gian': `${r.durationMs} ms`,
      'Phát thải (tCO₂e)': r.calculated_tco2e ?? 'N/A'
    }))
  );

  console.log('\n--- BÁO CÁO CHI TIẾT TỪNG CHỨNG TỪ: LẤY ĐƯỢC NHỮNG THÔNG TIN NÀO ---\n');
  for (const r of results) {
    console.log(`\n========================================================================`);
    console.log(`[CHỨNG TỪ ${r.filename}] - ${r.description}`);
    console.log(`- Loại văn bản: ${r.detected_kind} ("${r.document_title}")`);
    console.log(`- Tỷ lệ thông tin trích xuất: ${r.completeness_percent}% (${r.extracted_fields_count}/${r.total_expected_fields} trường)`);
    console.log(`- Độ tin cậy: ${r.confidence} | Thời gian xử lý: ${r.durationMs} ms`);
    console.log(`- Phân loại phát thải: ${r.ghg_scope || 'N/A'}`);
    console.log(`- Lượng phát thải CO₂e tính toán: ${r.calculated_tco2e != null ? r.calculated_tco2e + ' tCO₂e' : 'N/A'}`);
    console.log(`- Tóm tắt: ${r.summary}`);

    console.log(`\n  + CÁC TRƯỜNG THÔNG TIN ĐÃ TRÍCH XUẤT THÀNH CÔNG:`);
    for (const f of r.extracted_fields) {
      let valDisplay = typeof f.value === 'object' ? JSON.stringify(f.value) : f.value;
      console.log(`    * [${f.label}] (${f.field}): ${valDisplay}`);
    }

    if (r.missing_fields.length > 0) {
      console.log(`\n  + CÁC TRƯỜNG KHUYẾT THIẾU TRÊN CHỨNG TỪ:`);
      for (const m of r.missing_fields) {
        console.log(`    - [${m.label}] (${m.field}): Không xuất hiện trên chứng từ gốc`);
      }
    }
  }

  console.log('\n=================================================================================');
  console.log('                      HOÀN TẤT KIỂM THỬ BENCHMARK                                ');
  console.log('=================================================================================\n');
}

runBenchmark().catch(console.error);
