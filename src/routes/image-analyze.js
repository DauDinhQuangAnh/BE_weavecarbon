const express = require("express");
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const router = express.Router();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Multer setup
const upload = multer({
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only images allowed"));
      return;
    }
    cb(null, true);
  },
});

/**
 * POST /b2c/gemini-test
 * Test endpoint for Gemini image analysis
 */
router.post("/analyze-donation-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image provided" });
    }

    // Get image data
    const imageBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const base64Image = imageBuffer.toString("base64");

    // Initialize model
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Create prompt
    const prompt = `Analyze this image and detect all clothing/textile items for donation.

For EACH item in the image, extract:
1. item_name: Clear name (e.g., "Blue Cotton T-shirt")
2. item_type: Category (shirt, pants, jacket, shoes, bag, dress, sweater, etc.)
3. material_id: Material type (cotton, polyester, wool, silk, linen, nylon, leather, mixed)
4. condition: "good", "fair", or "poor"
5. weight_kg: Estimated weight in kg
6. confidence: Your confidence 0-1

IMPORTANT: Return ONLY this JSON structure, no other text:
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

    // Call Gemini
    const response = await model.generateContent([
      {
        inlineData: {
          data: base64Image,
          mimeType: mimeType,
        },
      },
      prompt,
    ]);

    const analysisText = response.response.text();
    console.log("Raw Gemini response:", analysisText);

    // Parse JSON from response
    let analysisResult;
    try {
      // Try direct parse
      analysisResult = JSON.parse(analysisText);
    } catch (e) {
      // Try extracting JSON from text
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    }

    // Validate
    const validated = validateResult(analysisResult);

    console.log("Analysis successful:", validated);
    res.json(validated);
  } catch (error) {
    console.error("❌ Gemini error:", error);
    res.status(500).json({
      error: error.message || "Analysis failed",
      products: [],
      total_items_detected: 0,
      overall_confidence: 0,
    });
  }
});

/**
 * Validate and format result
 */
function validateResult(result) {
  if (!result || !Array.isArray(result.products)) {
    return {
      products: [],
      total_items_detected: 0,
      overall_confidence: 0,
    };
  }

  const validProducts = result.products
    .filter(
      (p) => p.item_name && p.item_type && p.material_id && p.weight_kg > 0,
    )
    .slice(0, 20)
    .map((p) => ({
      item_name: String(p.item_name).trim(),
      item_type: String(p.item_type).trim(),
      material_id: String(p.material_id).trim().toLowerCase(),
      custom_material_name: (p.custom_material_name || "").trim(),
      condition: ["good", "fair", "poor"].includes(p.condition)
        ? p.condition
        : "good",
      weight_kg: Math.max(0.01, Number(p.weight_kg)),
      confidence: Math.min(1, Math.max(0, Number(p.confidence))),
    }));

  const avgConfidence =
    validProducts.length > 0
      ? validProducts.reduce((sum, p) => sum + p.confidence, 0) /
        validProducts.length
      : 0;

  return {
    products: validProducts,
    total_items_detected: validProducts.length,
    overall_confidence: parseFloat(avgConfidence.toFixed(2)),
  };
}

module.exports = router;
