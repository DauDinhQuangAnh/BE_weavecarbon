/**
 * Status mapping helper
 * DB: draft, active, archived
 * FE: draft, published, archived
 */
const dbToFeStatus = (dbStatus) => {
    if (dbStatus === 'active') return 'published';
    return dbStatus; // draft, archived stay the same
};

const feToDbStatus = (feStatus) => {
    if (feStatus === 'published') return 'active';
    return feStatus; // draft, archived stay the same
};

/**
 * Confidence level mapping from score
 */
const getConfidenceLevel = (score) => {
    if (score >= 85) return 'high';
    if (score >= 65) return 'medium';
    return 'low';
};

const clampConfidenceScore = (score) => {
    const parsed = Number.parseFloat(score);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, parsed));
};

const buildDomesticComplianceWarning = (validationResult) => ({
    code: 'MISSING_DOMESTIC_DOCUMENTS',
    message: 'Published with missing required domestic documents.',
    details: {
        market_code: validationResult?.marketCode || 'VN',
        required_documents: validationResult?.requiredDocuments || [],
        missing_by_product: validationResult?.missingByProduct || []
    }
});

module.exports = {
    dbToFeStatus,
    feToDbStatus,
    getConfidenceLevel,
    clampConfidenceScore,
    buildDomesticComplianceWarning
};
