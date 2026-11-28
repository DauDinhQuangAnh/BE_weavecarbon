'use strict';

/**
 * Hệ số phát thải lưới điện quốc gia dùng chung cho toàn bộ backend.
 *
 * Nguồn: Cục Biến đổi khí hậu — Công văn 1726/BĐKH-PTCBT (2024) công bố
 * hệ số phát thải lưới điện Việt Nam năm 2023: 0,6592 tCO2/MWh.
 * Giá trị này khớp với danh mục hệ số ở frontend (energy-grid-vn-2023).
 * Lưu ý: QĐ 13/2024/QĐ-TTg là danh mục cơ sở phải kiểm kê KNK, KHÔNG phải
 * văn bản công bố hệ số, nên không được ghi làm nguồn hệ số.
 */
const VN_GRID_EMISSION_FACTOR = Object.freeze({
  id: 'energy-grid-vn-2023',
  value: 0.6592,
  unit: 'kgCO2e/kWh',
  year: 2023,
  source: 'Cục Biến đổi khí hậu — CV 1726/BĐKH-PTCBT (2024), hệ số lưới điện VN 2023'
});

module.exports = { VN_GRID_EMISSION_FACTOR };
