'use strict';

/**
 * Đề xuất giảm phát thải theo điểm nóng THẬT của từng sản phẩm (LOI-036).
 * Thay cho bộ đề xuất mẫu chung từ dịch vụ RAG: mỗi đề xuất chỉ xuất hiện khi giai đoạn
 * tương ứng đáng kể, và % giảm được tính từ tỷ trọng giai đoạn × mức cắt giảm giả định
 * (ghi rõ giả định trong mô tả). Đây là quy tắc tính toán, không phải mô hình AI.
 */

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const RECYCLED_OR_LOW_IMPACT = /recycled|rpet|organic|hemp|linen|tencel|lyocell|tái chế|hữu cơ/i;
const RENEWABLE_SOURCES = new Set(['solar', 'wind']);

const roundPercent = (value) => Math.max(0, Math.round(value * 10) / 10);
const formatKg = (value) => (Math.round(value * 1000) / 1000).toLocaleString('vi-VN');

function buildProductHotspotSuggestions(input = {}) {
  const perProduct = input.perProduct || {};
  const stages = {
    material: toNumber(perProduct.materials),
    manufacturing: toNumber(perProduct.production) + toNumber(perProduct.energy),
    transport: toNumber(perProduct.transport),
    packaging: toNumber(perProduct.packaging)
  };
  const stageSum = Object.values(stages).reduce((sum, value) => sum + value, 0);
  const total = toNumber(perProduct.total) > 0 ? Math.max(toNumber(perProduct.total), stageSum) : stageSum;
  if (!(total > 0)) return [];

  const share = (key) => stages[key] / total;
  const materials = Array.isArray(input.materials) ? input.materials : [];
  const energySources = Array.isArray(input.energySources) ? input.energySources : [];
  const transportLegs = Array.isArray(input.transportLegs) ? input.transportLegs : [];
  const suggestions = [];

  // Vật liệu
  if (share('material') >= 0.1) {
    const lowImpactShare = materials.reduce((sum, material) => {
      const label = `${material.materialType || ''} ${material.name || ''}`;
      return RECYCLED_OR_LOW_IMPACT.test(label) ? sum + toNumber(material.percentage) : sum;
    }, 0) / 100;
    if (lowImpactShare < 0.5) {
      const switchable = Math.min(0.3, 0.5 - lowImpactShare);
      const reduction = share('material') * switchable * 0.4 * 100;
      suggestions.push({
        id: 'material-low-impact-fibre',
        type: 'material',
        title: 'Thay một phần vật liệu chính bằng sợi tái chế / hữu cơ',
        description: `Vật liệu chiếm ${Math.round(share('material') * 100)}% phát thải (${formatKg(stages.material)} kg CO₂e/sp). Thay ${Math.round(switchable * 100)}% khối lượng bằng sợi tái chế có chứng nhận (giả định hệ số thấp hơn ~40%) giảm khoảng ${roundPercent(reduction)}% tổng phát thải.`,
        potentialReduction: Math.round(reduction),
        difficulty: 'medium',
        basis: { stage: 'materials', stageShare: share('material'), assumption: 'switch_share_x_40pct_lower_factor' }
      });
    } else {
      suggestions.push({
        id: 'material-primary-data',
        type: 'material',
        title: 'Thu thập dữ liệu sơ cấp từ nhà cung cấp vật liệu',
        description: `Sản phẩm đã dùng ${Math.round(lowImpactShare * 100)}% vật liệu tái chế/hữu cơ. Bước tiếp theo là thay hệ số trung bình bằng số liệu PCF của nhà cung cấp để phản ánh đúng mức giảm thực tế (không tự làm giảm phát thải).`,
        potentialReduction: 0,
        difficulty: 'easy',
        basis: { stage: 'materials', stageShare: share('material'), assumption: 'data_quality_only' }
      });
    }
  }

  // Sản xuất / năng lượng
  if (share('manufacturing') >= 0.1) {
    const renewableShare = energySources.reduce((sum, energy) => (
      RENEWABLE_SOURCES.has(String(energy.source || '').toLowerCase()) && !energy.recsSold
        ? sum + toNumber(energy.percentage)
        : sum
    ), 0) / 100;
    if (renewableShare < 0.3) {
      const added = 0.3 - renewableShare;
      const reduction = share('manufacturing') * added * 0.9 * 100;
      suggestions.push({
        id: 'manufacturing-rooftop-solar',
        type: 'manufacturing',
        title: 'Tăng điện tái tạo (điện mặt trời áp mái hoặc hợp đồng DPPA)',
        description: `Sản xuất và năng lượng chiếm ${Math.round(share('manufacturing') * 100)}% phát thải (${formatKg(stages.manufacturing)} kg CO₂e/sp), điện tái tạo hiện ${Math.round(renewableShare * 100)}%. Nâng lên 30% (điện mặt trời thấp hơn lưới ~90%) giảm khoảng ${roundPercent(reduction)}% tổng phát thải.`,
        potentialReduction: Math.round(reduction),
        difficulty: 'hard',
        basis: { stage: 'manufacturing', stageShare: share('manufacturing'), assumption: 'raise_renewable_to_30pct' }
      });
    }
    const efficiencyReduction = share('manufacturing') * 0.1 * 100;
    suggestions.push({
      id: 'manufacturing-efficiency',
      type: 'manufacturing',
      title: 'Giảm điện năng ở công đoạn tiêu thụ nhiều nhất',
      description: `Biến tần cho động cơ, thu hồi nhiệt nước nhuộm và bảo trì hơi nén thường giảm ~10% điện năng công đoạn, tương đương khoảng ${roundPercent(efficiencyReduction)}% tổng phát thải sản phẩm này.`,
      potentialReduction: Math.round(efficiencyReduction),
      difficulty: 'medium',
      basis: { stage: 'manufacturing', stageShare: share('manufacturing'), assumption: 'efficiency_10pct' }
    });
  }

  // Vận chuyển
  const hasAirLeg = transportLegs.some((leg) => String(leg.mode || '').toLowerCase() === 'air');
  if (hasAirLeg && share('transport') > 0) {
    const reduction = share('transport') * 0.85 * 100;
    suggestions.push({
      id: 'transport-air-to-sea',
      type: 'transport',
      title: 'Chuyển chặng hàng không sang đường biển',
      description: `Vận chuyển chiếm ${Math.round(share('transport') * 100)}% phát thải và có chặng hàng không. Đường biển phát thải thấp hơn hàng không khoảng 85–95%/tấn.km, giảm khoảng ${roundPercent(reduction)}% tổng phát thải.`,
      potentialReduction: Math.round(reduction),
      difficulty: 'medium',
      basis: { stage: 'transport', stageShare: share('transport'), assumption: 'air_to_sea_85pct' }
    });
  } else if (share('transport') >= 0.1) {
    const reduction = share('transport') * 0.1 * 100;
    suggestions.push({
      id: 'transport-load-optimisation',
      type: 'transport',
      title: 'Tối ưu tải trọng và ghép container',
      description: `Vận chuyển chiếm ${Math.round(share('transport') * 100)}% phát thải. Tăng hệ số chất xếp / ghép hàng thường giảm ~10% phát thải vận chuyển, khoảng ${roundPercent(reduction)}% tổng.`,
      potentialReduction: Math.round(reduction),
      difficulty: 'easy',
      basis: { stage: 'transport', stageShare: share('transport'), assumption: 'load_factor_10pct' }
    });
  }

  // Bao bì
  if (share('packaging') >= 0.05) {
    const reduction = share('packaging') * 0.3 * 100;
    suggestions.push({
      id: 'packaging-lightweight',
      type: 'packaging',
      title: 'Giảm khối lượng bao bì, dùng vật liệu tái chế',
      description: `Bao bì chiếm ${Math.round(share('packaging') * 100)}% phát thải. Giảm 30% phát thải bao bì giảm khoảng ${roundPercent(reduction)}% tổng.`,
      potentialReduction: Math.round(reduction),
      difficulty: 'easy',
      basis: { stage: 'packaging', stageShare: share('packaging'), assumption: 'packaging_30pct' }
    });
  }

  return suggestions
    .sort((a, b) => b.potentialReduction - a.potentialReduction)
    .slice(0, 4);
}

module.exports = { buildProductHotspotSuggestions };
