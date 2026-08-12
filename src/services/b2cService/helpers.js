const fs = require('fs');

const DONATION_IMAGE_LEVELS = [
  { minimum: 2000, label: 'Champion' },
  { minimum: 1000, label: 'Advocate' },
  { minimum: 400, label: 'Explorer' },
  { minimum: 0, label: 'Beginner' }
];

const ALLOWED_CATEGORIES = new Set(['charity', 'recycle']);
const ALLOWED_DELIVERY_METHODS = new Set(['drop_off', 'shipping']);
const MAX_GPS_DISTANCE_KM = 0.2;
const IMAGE_ANALYSIS_ITEM_KEYWORDS = [
  { pattern: /(shirt|tee|tshirt|t-shirt|áo)/i, itemName: 'Textile shirt', itemType: 'shirt', weightKg: 0.25, materialHint: 'cotton' },
  { pattern: /(jean|pants|trouser|quần)/i, itemName: 'Pants', itemType: 'pants', weightKg: 0.6, materialHint: 'cotton' },
  { pattern: /(jacket|coat|áo khoác)/i, itemName: 'Jacket', itemType: 'jacket', weightKg: 0.9, materialHint: 'polyester' },
  { pattern: /(bag|tote|túi)/i, itemName: 'Reusable bag', itemType: 'bag', weightKg: 0.35, materialHint: 'cotton' },
  { pattern: /(shoe|sneaker|giày)/i, itemName: 'Shoes', itemType: 'shoes', weightKg: 0.8, materialHint: 'leather' },
  { pattern: /(dress|váy|đầm)/i, itemName: 'Dress', itemType: 'dress', weightKg: 0.45, materialHint: 'polyester' }
];

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundTo = (value, decimals = 4) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

// Disposition-adjusted CO₂ savings for donations. The per-material
// `co2_saved_per_kg` is a virgin cradle-to-gate factor; crediting it 1:1 assumes
// 100% reuse with perfect displacement, which over-credits and is a greenwashing
// risk under the EU Green Claims Directive (ECGT). We scale by the realistic
// end-of-life pathway, grounded in WRAP "Valuing Our Clothes":
//   - reuse (charity):    virgin EF × conservative displacement rate (cotton → ~4.0 kg/kg)
//   - recycle (downcycle): flat ~0.7 kg CO₂e/kg, independent of the original fibre
// Keep in sync with the frontend (`Weavecarbon/lib/b2cCo2.ts`).
const REUSE_DISPLACEMENT_FACTOR = 0.5;
const RECYCLE_NET_EF_PER_KG = 0.7;
const REUSE_CATEGORY = 'charity';

const computeDonationCo2Saved = (category, virginEfPerKg, weightKg) => {
  const ef = toNumber(virginEfPerKg, 0);
  const weight = toNumber(weightKg, 0);
  if (!(weight > 0)) {
    return 0;
  }
  if (category === REUSE_CATEGORY) {
    return ef * REUSE_DISPLACEMENT_FACTOR * weight;
  }
  return RECYCLE_NET_EF_PER_KG * weight;
};

// Actual end-of-life disposition, recorded at the sorting centre. At donation
// time CO₂ is credited from `category` as a proxy; once an item is physically
// sorted the real pathway is known and the saving is recomputed:
//   - reuse:   virgin EF × conservative displacement (same basis as charity)
//   - recycle: flat mechanical-downcycling saving
//   - waste:   incineration — no net saving credited (conservative)
const DISPOSITION_REUSE = 'reuse';
const DISPOSITION_RECYCLE = 'recycle';
const DISPOSITION_WASTE = 'waste';
const ALLOWED_DISPOSITIONS = new Set([
  DISPOSITION_REUSE,
  DISPOSITION_RECYCLE,
  DISPOSITION_WASTE
]);

const dispositionCo2Saved = (disposition, virginEfPerKg, weightKg) => {
  const ef = toNumber(virginEfPerKg, 0);
  const weight = toNumber(weightKg, 0);
  if (!(weight > 0)) {
    return 0;
  }
  if (disposition === DISPOSITION_REUSE) {
    return ef * REUSE_DISPLACEMENT_FACTOR * weight;
  }
  if (disposition === DISPOSITION_RECYCLE) {
    return RECYCLE_NET_EF_PER_KG * weight;
  }
  return 0;
};

const normalizeOptionalString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const calculateDistanceKm = (latitudeA, longitudeA, latitudeB, longitudeB) => {
  const toRadians = (value) => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const latDistance = toRadians(latitudeB - latitudeA);
  const lngDistance = toRadians(longitudeB - longitudeA);
  const originLat = toRadians(latitudeA);
  const destinationLat = toRadians(latitudeB);

  const haversine =
    Math.sin(latDistance / 2) ** 2 +
    Math.cos(originLat) *
      Math.cos(destinationLat) *
      Math.sin(lngDistance / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
};

const resolveLevel = (totalPoints) => {
  for (const candidate of DONATION_IMAGE_LEVELS) {
    if (totalPoints >= candidate.minimum) {
      return candidate.label;
    }
  }
  return 'Beginner';
};

const createBusinessError = (code, message, statusCode = 400, details) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
};

const deleteUploadedFile = (filePath) => {
  if (!filePath) return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup failures for temporary upload files.
  }
};

const mapMaterialReward = (row) => ({
  id: row.id,
  material_name: row.material_name,
  material_category: row.material_category,
  points_per_kg: toNumber(row.points_per_kg),
  co2_saved_per_kg: toNumber(row.co2_saved_per_kg),
  description: row.description,
  is_active: row.is_active === true
});

const resolveAnalysisMaterial = (materials, hint) => {
  const normalizedHint = String(hint || '').toLowerCase();

  if (normalizedHint) {
    const matched = materials.find((material) =>
      String(material.material_name || '').toLowerCase().includes(normalizedHint) ||
      String(material.material_category || '').toLowerCase().includes(normalizedHint)
    );

    if (matched) return matched;
  }

  return (
    materials.find((material) =>
      String(material.material_name || '').toLowerCase().includes('other')
    ) ||
    materials[0] ||
    null
  );
};

const inferAnalysisItems = (fileName, category) => {
  const normalizedFileName = String(fileName || '').toLowerCase();
  const matchedItems = IMAGE_ANALYSIS_ITEM_KEYWORDS
    .filter((candidate) => candidate.pattern.test(normalizedFileName))
    .slice(0, 3);

  if (matchedItems.length > 0) {
    return matchedItems;
  }

  return [
    {
      itemName: category === 'charity' ? 'Donation textile item' : 'Recyclable textile item',
      itemType: 'textile',
      weightKg: category === 'charity' ? 0.45 : 0.6,
      materialHint: 'other'
    }
  ];
};

const mapCoupon = (row) => ({
  id: row.id,
  title: row.title,
  merchant_name: row.merchant_name,
  category: row.category,
  description: row.description,
  points_cost: Math.max(0, Math.trunc(toNumber(row.points_cost))),
  discount_type: row.discount_type,
  discount_value: row.discount_value === null ? null : toNumber(row.discount_value),
  currency: row.currency,
  code: row.code,
  image_url: row.image_url,
  valid_from: row.valid_from,
  valid_until: row.valid_until,
  stock_total: row.stock_total === null ? null : Math.max(0, Math.trunc(toNumber(row.stock_total))),
  stock_remaining:
    row.stock_remaining === null ? null : Math.max(0, Math.trunc(toNumber(row.stock_remaining))),
  redemption_limit_per_user: Math.max(1, Math.trunc(toNumber(row.redemption_limit_per_user, 1))),
  redemption_method: row.redemption_method,
  terms: row.terms,
  tags: Array.isArray(row.tags) ? row.tags : [],
  is_featured: row.is_featured === true,
  is_active: row.is_active === true,
  created_at: row.created_at,
  updated_at: row.updated_at
});

const mapCollectionPointSummary = (row) => {
  if (!row.collection_point_id) {
    return null;
  }

  return {
    id: row.collection_point_id,
    name: row.collection_point_name,
    address: row.collection_point_address,
    city: row.collection_point_city,
    district: row.collection_point_district
  };
};

const mapDonationSummary = (row) => ({
  id: row.id,
  category: row.category,
  delivery_method: row.delivery_method,
  status: row.status,
  disposition: row.disposition || null,
  disposition_note: row.disposition_note || null,
  disposition_at: row.disposition_at || null,
  base_points: Math.max(0, Math.trunc(toNumber(row.base_points))),
  bonus_points: Math.max(0, Math.trunc(toNumber(row.bonus_points))),
  total_points: Math.max(0, Math.trunc(toNumber(row.total_points))),
  co2_saved: roundTo(toNumber(row.co2_saved)),
  total_items: Math.max(0, Math.trunc(toNumber(row.total_items))),
  total_weight_kg: roundTo(toNumber(row.total_weight_kg)),
  item_description: row.item_description,
  shipping_tracking_number: row.shipping_tracking_number,
  confirmation_method: row.confirmation_method,
  created_at: row.created_at,
  confirmed_at: row.confirmed_at,
  completed_at: row.completed_at,
  collection_point: mapCollectionPointSummary(row),
  image_available: Boolean(row.source_image_storage_key),
  source_image: row.source_image_storage_key
    ? {
        original_name: row.source_image_original_name,
        mime_type: row.source_image_mime_type,
        size_bytes: Math.max(0, Math.trunc(toNumber(row.source_image_size_bytes)))
      }
    : null
});

module.exports = {
  DONATION_IMAGE_LEVELS,
  ALLOWED_CATEGORIES,
  ALLOWED_DELIVERY_METHODS,
  MAX_GPS_DISTANCE_KM,
  IMAGE_ANALYSIS_ITEM_KEYWORDS,
  toNumber,
  roundTo,
  REUSE_DISPLACEMENT_FACTOR,
  RECYCLE_NET_EF_PER_KG,
  computeDonationCo2Saved,
  ALLOWED_DISPOSITIONS,
  dispositionCo2Saved,
  normalizeOptionalString,
  calculateDistanceKm,
  resolveLevel,
  createBusinessError,
  deleteUploadedFile,
  mapMaterialReward,
  resolveAnalysisMaterial,
  inferAnalysisItems,
  mapCoupon,
  mapCollectionPointSummary,
  mapDonationSummary
};
