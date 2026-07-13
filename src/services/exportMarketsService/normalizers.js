const MATERIAL_CERTIFICATION_TYPE_HINTS = new Set([
    'material_certification',
    'material_certificate',
    'material_compliance',
    'material_cert',
    'certificate_material',
    'certification_material',
    'material_group_certification',
    'material_certification_group'
]);

const normalizeDocumentToken = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

const normalizeLooseDocumentToken = (value) => normalizeDocumentToken(value).replace(/_/g, '');

const parseJsonObject = (value) => {
    if (!value || typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

const toNullableTrimmedString = (value) => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text.length > 0 ? text : null;
};

const toNonNegativeNumberOrNull = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const buildProductScopeNotes = (productData = {}, existingNotes = null) => {
    const previous = parseJsonObject(existingNotes) || {};
    const legacyNote = previous.note || (existingNotes && !parseJsonObject(existingNotes) ? existingNotes : null);
    const metadata = {
        note: toNullableTrimmedString(productData.notes) || legacyNote || null,
        production_site:
            toNullableTrimmedString(productData.production_site) ||
            toNullableTrimmedString(previous.production_site),
        export_volume:
            toNonNegativeNumberOrNull(productData.export_volume) ??
            toNonNegativeNumberOrNull(previous.export_volume),
        unit:
            toNullableTrimmedString(productData.unit) ||
            toNullableTrimmedString(previous.unit) ||
            'pcs'
    };

    return JSON.stringify(metadata);
};

const resolveComplianceDocumentGroup = (document = {}) => {
    const normalizedCode = normalizeDocumentToken(document.document_code || document.code || document.id);
    const normalizedType = normalizeDocumentToken(document.document_type || document.type);
    const looseCode = normalizeLooseDocumentToken(normalizedCode);
    const looseType = normalizeLooseDocumentToken(normalizedType);
    const looksLikeMaterialCertification =
        normalizedCode.startsWith('cert_') ||
        (looseCode.includes('material') && (looseCode.includes('cert') || looseCode.includes('certificate'))) ||
        MATERIAL_CERTIFICATION_TYPE_HINTS.has(normalizedType) ||
        (looseType.includes('material') && (looseType.includes('cert') || looseType.includes('certificate')));

    return looksLikeMaterialCertification ? 'material_certification' : 'export_compliance';
};

module.exports = {
    normalizeDocumentToken,
    normalizeLooseDocumentToken,
    parseJsonObject,
    toNullableTrimmedString,
    toNonNegativeNumberOrNull,
    buildProductScopeNotes,
    resolveComplianceDocumentGroup
};
