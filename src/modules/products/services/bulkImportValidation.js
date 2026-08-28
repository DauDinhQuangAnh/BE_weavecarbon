const pool = require('../../shared/database');
const { toNumber, toPayloadObject } = require('./shared');

const BULK_IMPORT_ENUMS = {
    productType: new Set(['tshirt', 'pants', 'dress', 'jacket', 'shoes', 'bag', 'accessories', 'other']),
    material: new Set([
        'cotton',
        'organic_cotton',
        'recycled_cotton',
        'polyester',
        'recycled_polyester',
        'nylon',
        'wool',
        'silk',
        'linen',
        'bamboo',
        'hemp',
        'tencel',
        'viscose',
        'blend',
        'mixed'
    ]),
    materialSource: new Set(['domestic', 'imported', 'unknown']),
    process: new Set(['knitting', 'weaving', 'cutting_sewing', 'cutting', 'dyeing', 'printing', 'finishing']),
    energySource: new Set(['grid', 'solar', 'wind', 'coal', 'gas', 'mixed']),
    marketType: new Set(['domestic', 'export']),
    exportCountry: new Set(['eu', 'us', 'jp', 'kr', 'other']),
    transportMode: new Set(['road', 'sea', 'air', 'rail', 'multimodal'])
};

const readBulkField = (row, fields, fallback = '') => {
    const payload = toPayloadObject(row);
    for (const field of fields) {
        if (payload[field] !== undefined && payload[field] !== null) {
            return payload[field];
        }
    }
    return fallback;
};

const readBulkString = (row, fields) => String(readBulkField(row, fields, '') || '').trim();

const readBulkNumber = (row, fields, fallback = Number.NaN) =>
    toNumber(readBulkField(row, fields, fallback), fallback);

const splitBulkList = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    return String(value || '')
        .split(/[,;|]/)
        .map((item) => item.trim())
        .filter(Boolean);
};

const addBulkValidationError = (errors, field, message, code = 'INVALID_FIELD') => {
    errors.push({
        field,
        code,
        message,
        severity: 'error'
    });
};

async function validateBulkImportRows(companyId, rows = []) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const seenSkus = new Set();
    const candidateSkus = safeRows
        .map((row) => readBulkString(row, ['sku', 'productCode', 'product_code']))
        .filter(Boolean);
    const existingSkus = new Set();

    if (candidateSkus.length > 0) {
        const existingResult = await pool.query(
            `
            SELECT sku
            FROM products
            WHERE company_id = $1
              AND sku = ANY($2::text[])
            `,
            [companyId, [...new Set(candidateSkus)]]
        );
        existingResult.rows.forEach((row) => existingSkus.add(String(row.sku)));
    }

    const validRows = [];
    const invalidRows = [];
    const warnings = [];

    safeRows.forEach((row, index) => {
        const rowNumber = index + 1;
        const errors = [];
        const sku = readBulkString(row, ['sku', 'productCode', 'product_code']);
        const productName = readBulkString(row, ['productName', 'product_name', 'name']);
        const productType = readBulkString(row, ['productType', 'product_type', 'category']).toLowerCase();
        const hsCode = readBulkString(row, ['hsCode', 'hs_code', 'cnCode', 'cn_code']);
        const evidenceLookupCode = readBulkString(row, ['evidenceLookupCode', 'evidence_lookup_code']);
        const supplyGap = readBulkString(row, ['supplyGap', 'supply_gap']).toLowerCase();
        const poContractId = readBulkString(row, ['poContractId', 'po_contract_id']);
        const billOfLadingNo = readBulkString(row, ['billOfLadingNo', 'bill_of_lading_no']);
        const containerNo = readBulkString(row, ['containerNo', 'container_no']);
        const quantity = readBulkNumber(row, ['quantity'], Number.NaN);
        const weightPerUnit = readBulkNumber(row, ['weightPerUnit', 'weight_per_unit'], Number.NaN);
        const primaryMaterial = readBulkString(row, ['primaryMaterial', 'primary_material']).toLowerCase();
        const secondaryMaterial = readBulkString(row, ['secondaryMaterial', 'secondary_material']).toLowerCase();
        const primaryPct = readBulkNumber(
            row,
            ['primaryMaterialPercentage', 'primary_material_percentage'],
            Number.NaN
        );
        const secondaryPct = readBulkNumber(
            row,
            ['secondaryMaterialPercentage', 'secondary_material_percentage'],
            0
        );
        const materialSource = readBulkString(row, ['materialSource', 'material_source']).toLowerCase();
        const processes = splitBulkList(readBulkField(row, ['processes', 'productionProcesses'], []))
            .map((item) => item.toLowerCase());
        const energySource = readBulkString(row, ['energySource', 'energy_source']).toLowerCase();
        const marketType = readBulkString(row, ['marketType', 'market_type']).toLowerCase();
        const exportCountry = readBulkString(row, ['exportCountry', 'export_country']).toLowerCase();
        const transportMode = readBulkString(row, ['transportMode', 'transport_mode']).toLowerCase();
        const transportDistance = readBulkNumber(
            row,
            ['transportDistanceKm', 'transport_distance_km'],
            Number.NaN
        );

        if (!sku) {
            addBulkValidationError(errors, 'sku', 'SKU is required', 'REQUIRED');
        } else if (seenSkus.has(sku)) {
            addBulkValidationError(errors, 'sku', 'Duplicate SKU in import payload', 'DUPLICATE_IN_PAYLOAD');
        } else if (existingSkus.has(sku)) {
            addBulkValidationError(errors, 'sku', 'SKU already exists', 'DUPLICATE_SKU');
        }
        if (sku) {
            seenSkus.add(sku);
        }

        if (!productName) {
            addBulkValidationError(errors, 'productName', 'Product name is required', 'REQUIRED');
        }
        if (!productType || !BULK_IMPORT_ENUMS.productType.has(productType)) {
            addBulkValidationError(errors, 'productType', 'Product type is invalid');
        }
        if (hsCode && !/^[0-9]{6,10}$/.test(hsCode)) {
            addBulkValidationError(errors, 'hsCode', 'HS/CN code must contain 6 to 10 digits');
        }
        if (supplyGap && !['true', 'false', 'yes', 'no', '1', '0', 'missing', 'gap'].includes(supplyGap)) {
            addBulkValidationError(errors, 'supplyGap', 'Supply gap must be true/false');
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
            addBulkValidationError(errors, 'quantity', 'Quantity must be greater than 0');
        }
        if (!Number.isFinite(weightPerUnit) || weightPerUnit <= 0) {
            addBulkValidationError(errors, 'weightPerUnit', 'Weight per unit must be greater than 0');
        }
        if (!primaryMaterial || !BULK_IMPORT_ENUMS.material.has(primaryMaterial)) {
            addBulkValidationError(errors, 'primaryMaterial', 'Primary material is invalid');
        }
        if (secondaryMaterial && !BULK_IMPORT_ENUMS.material.has(secondaryMaterial)) {
            addBulkValidationError(errors, 'secondaryMaterial', 'Secondary material is invalid');
        }
        if (!Number.isFinite(primaryPct) || primaryPct <= 0 || primaryPct > 100) {
            addBulkValidationError(errors, 'primaryMaterialPercentage', 'Primary material percentage must be between 1 and 100');
        }
        if (!Number.isFinite(secondaryPct) || secondaryPct < 0 || secondaryPct > 100) {
            addBulkValidationError(errors, 'secondaryMaterialPercentage', 'Secondary material percentage must be between 0 and 100');
        }
        if (Number.isFinite(primaryPct) && Number.isFinite(secondaryPct) && primaryPct + secondaryPct > 100) {
            addBulkValidationError(errors, 'materialPercentage', 'Material percentages cannot exceed 100');
        }
        if (!materialSource || !BULK_IMPORT_ENUMS.materialSource.has(materialSource)) {
            addBulkValidationError(errors, 'materialSource', 'Material source is invalid');
        }
        if (processes.length === 0) {
            addBulkValidationError(errors, 'processes', 'At least one production process is required', 'REQUIRED');
        } else {
            processes
                .filter((process) => !BULK_IMPORT_ENUMS.process.has(process))
                .forEach((process) => addBulkValidationError(errors, 'processes', `Unknown production process: ${process}`));
        }
        if (!energySource || !BULK_IMPORT_ENUMS.energySource.has(energySource)) {
            addBulkValidationError(errors, 'energySource', 'Energy source is invalid');
        }
        if (!marketType || !BULK_IMPORT_ENUMS.marketType.has(marketType)) {
            addBulkValidationError(errors, 'marketType', 'Market type is invalid');
        }
        if (marketType === 'export' && exportCountry && !BULK_IMPORT_ENUMS.exportCountry.has(exportCountry)) {
            addBulkValidationError(errors, 'exportCountry', 'Export country is invalid');
        }
        if (transportMode && !BULK_IMPORT_ENUMS.transportMode.has(transportMode)) {
            addBulkValidationError(errors, 'transportMode', 'Transport mode is invalid');
        }
        if (Number.isFinite(transportDistance) && transportDistance < 0) {
            addBulkValidationError(errors, 'transportDistanceKm', 'Transport distance cannot be negative');
        }
        if (transportMode && (!Number.isFinite(transportDistance) || transportDistance <= 0)) {
            warnings.push({
                row: rowNumber,
                field: 'transportDistanceKm',
                message: 'Transport mode is set but distance is missing; import will rely on route defaults where available.',
                severity: 'warning'
            });
        }
        if (marketType === 'export' && (!poContractId || !billOfLadingNo || !containerNo)) {
            warnings.push({
                row: rowNumber,
                field: 'exportDocuments',
                message: 'Export product is missing PO/Bill of Lading/Container metadata for the v2 export portal.',
                severity: 'warning'
            });
        }
        if (!evidenceLookupCode) {
            warnings.push({
                row: rowNumber,
                field: 'evidenceLookupCode',
                message: 'Evidence lookup code is missing; audit readiness will be lower until evidence is linked.',
                severity: 'warning'
            });
        }

        if (errors.length > 0) {
            invalidRows.push({ row: rowNumber, data: row, errors });
        } else {
            validRows.push(row);
        }
    });

    return {
        isValid: invalidRows.length === 0,
        totalRows: safeRows.length,
        validCount: validRows.length,
        errorCount: invalidRows.length,
        warningCount: warnings.length,
        validRows,
        invalidRows,
        warnings
    };
}

module.exports = {
    BULK_IMPORT_ENUMS,
    readBulkField,
    readBulkString,
    readBulkNumber,
    splitBulkList,
    addBulkValidationError,
    validateBulkImportRows
};
