const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createAppError } = require('../utils/appError');

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_PRODUCTS = 20;

const ANALYSIS_PROMPT = `Analyze this image and detect all clothing/textile items suitable for donation.

For EACH item in the image, extract:
1. item_name: Clear name (for example "Blue Cotton T-shirt")
2. item_type: Category (shirt, pants, jacket, shoes, bag, dress, sweater, etc.)
3. material_id: Material type (cotton, polyester, wool, silk, linen, nylon, leather, mixed)
4. condition: "good", "fair", or "poor"
5. weight_kg: Estimated weight in kg
6. confidence: Your confidence from 0 to 1

Return ONLY valid JSON in this structure:
{
  "products": [
    {
      "item_name": "string",
      "item_type": "string",
      "material_id": "string",
      "custom_material_name": "",
      "condition": "good|fair|poor",
      "weight_kg": number,
      "confidence": number
    }
  ],
  "total_items_detected": number,
  "overall_confidence": number
}`;

const normalizeText = (value) => String(value || '').trim();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeJsonCandidate = (value) => String(value || '')
  .replace(/^\uFEFF/, '')
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/,\s*([}\]])/g, '$1')
  .trim();

const tryParseJson = (value) => {
  const candidate = normalizeJsonCandidate(value);
  if (!candidate) {
    return null;
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};

const extractJsonObject = (rawText) => {
  const text = normalizeText(rawText);

  if (!text) {
    throw createAppError('Image analysis returned an empty response', {
      statusCode: 502,
      code: 'AI_EMPTY_RESPONSE'
    });
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text;

  const parsedDirect = tryParseJson(candidate);
  if (parsedDirect) {
    return parsedDirect;
  }

  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    throw createAppError('Image analysis returned an invalid JSON payload', {
      statusCode: 502,
      code: 'AI_INVALID_RESPONSE'
    });
  }

  const parsedObject = tryParseJson(objectMatch[0]);
  if (parsedObject) {
    return parsedObject;
  }

  throw createAppError('Image analysis returned malformed JSON', {
    statusCode: 502,
    code: 'AI_INVALID_RESPONSE'
  });
};

const mapProduct = (product) => {
  const weightKg = Number(product?.weight_kg);
  const confidence = Number(product?.confidence);
  const condition = normalizeText(product?.condition).toLowerCase();

  return {
    item_name: normalizeText(product?.item_name),
    item_type: normalizeText(product?.item_type),
    material_id: normalizeText(product?.material_id).toLowerCase(),
    custom_material_name: normalizeText(product?.custom_material_name),
    condition: ['good', 'fair', 'poor'].includes(condition) ? condition : 'good',
    weight_kg: clamp(Number.isFinite(weightKg) ? weightKg : 0, 0.01, 100),
    confidence: clamp(Number.isFinite(confidence) ? confidence : 0, 0, 1)
  };
};

const isValidProduct = (product) => (
  Boolean(product.item_name) &&
  Boolean(product.item_type) &&
  Boolean(product.material_id)
);

class B2CImageAnalysisService {
  constructor() {
    this.client = null;
  }

  getClient() {
    if (this.client) {
      return this.client;
    }

    const apiKey = normalizeText(process.env.GEMINI_API_KEY);
    if (!apiKey) {
      throw createAppError('GEMINI_API_KEY is missing from environment variables', {
        statusCode: 500,
        code: 'AI_PROVIDER_NOT_CONFIGURED'
      });
    }

    this.client = new GoogleGenerativeAI(apiKey);
    return this.client;
  }

  validateAndNormalizeResult(payload) {
    if (!payload || !Array.isArray(payload.products)) {
      return {
        products: [],
        total_items_detected: 0,
        overall_confidence: 0
      };
    }

    const products = payload.products
      .map(mapProduct)
      .filter(isValidProduct)
      .slice(0, MAX_PRODUCTS);

    const averageConfidence = products.length > 0
      ? products.reduce((total, product) => total + product.confidence, 0) / products.length
      : 0;

    return {
      products,
      total_items_detected: products.length,
      overall_confidence: Number(averageConfidence.toFixed(2))
    };
  }

  async analyzeDonationImage(file) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw createAppError('Donation image is required', {
        statusCode: 400,
        code: 'INVALID_DONATION_IMAGE'
      });
    }

    const model = this.getClient().getGenerativeModel({ model: MODEL_NAME });

    let response;
    try {
      response = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: ANALYSIS_PROMPT },
              {
                inlineData: {
                  data: file.buffer.toString('base64'),
                  mimeType: file.mimetype || 'image/jpeg'
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      });
    } catch (error) {
      throw createAppError(error?.message || 'Failed to analyze donation image', {
        statusCode: 502,
        code: 'AI_ANALYSIS_FAILED'
      });
    }

    const responseText = response?.response?.text?.() || '';
    const parsedPayload = extractJsonObject(responseText);
    return this.validateAndNormalizeResult(parsedPayload);
  }
}

module.exports = new B2CImageAnalysisService();
