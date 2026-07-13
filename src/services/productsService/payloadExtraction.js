const { toPayloadObject } = require('./shared');

const extractDestinationMarketFromPayload = (payload = {}, targetMarkets = []) => {
    const resolveString = (value) => {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        return null;
    };

    const resolveRecursive = (value) => {
        const direct = resolveString(value);
        if (direct) return direct;

        if (Array.isArray(value)) {
            const selected = value.find((entry) =>
                entry &&
                typeof entry === 'object' &&
                (
                    entry.selected === true ||
                    entry.isSelected === true ||
                    entry.default === true ||
                    entry.current === true ||
                    entry.active === true ||
                    (typeof entry.status === 'string' && entry.status.trim().toLowerCase() === 'selected')
                )
            );
            if (selected) {
                const selectedValue = resolveRecursive(selected);
                if (selectedValue) return selectedValue;
            }

            for (const entry of value) {
                const resolved = resolveRecursive(entry);
                if (resolved) return resolved;
            }
            return null;
        }

        if (value && typeof value === 'object') {
            const directCandidates = [
                value.destinationMarket,
                value.destination_market,
                value.destinationMarketCode,
                value.destination_market_code,
                value.marketCode,
                value.market_code,
                value.targetMarket,
                value.target_market,
                value.market,
                value.destinationCountry,
                value.destination_country,
                value.country
            ];

            for (const candidate of directCandidates) {
                const resolved = resolveRecursive(candidate);
                if (resolved) return resolved;
            }

            const nestedCandidates = [
                value.step4_logistics,
                value.logistics,
                value.destination,
                value.destinationAddress,
                value.destination_address,
                value.selected,
                value.current,
                value.default,
                value.value,
                value.code,
                value.id,
                value.name,
                value.label,
                value.options,
                value.items,
                value.values,
                value.markets,
                value.destinationMarkets,
                value.destination_markets
            ];
            for (const candidate of nestedCandidates) {
                const resolved = resolveRecursive(candidate);
                if (resolved) return resolved;
            }
        }

        return null;
    };

    const resolvedFromPayload = resolveRecursive(payload);
    if (resolvedFromPayload) {
        return resolvedFromPayload;
    }

    if (Array.isArray(targetMarkets) && targetMarkets.length > 0) {
        const fallbackCode = resolveString(targetMarkets[0]);
        if (fallbackCode) {
            return fallbackCode.toUpperCase();
        }
    }

    return '';
};

const extractV2MetadataFromPayload = (payload = {}) => {
    const snapshot = toPayloadObject(payload);
    return {
        hsCode: snapshot.hsCode || snapshot.hs_code || snapshot.cnCode || snapshot.cn_code || null,
        cnCode: snapshot.cnCode || snapshot.cn_code || snapshot.hsCode || snapshot.hs_code || null,
        facility: snapshot.facility || snapshot.factory || null,
        evidenceLookupCode: snapshot.evidenceLookupCode || snapshot.evidence_lookup_code || null,
        supplierCountry: snapshot.supplierCountry || snapshot.supplier_country || null,
        supplyGap: Boolean(snapshot.supplyGap || snapshot.supply_gap),
        customsDeclarationNo: snapshot.customsDeclarationNo || snapshot.customs_declaration_no || null,
        poContractId: snapshot.poContractId || snapshot.po_contract_id || null,
        billOfLadingNo: snapshot.billOfLadingNo || snapshot.bill_of_lading_no || null,
        containerNo: snapshot.containerNo || snapshot.container_no || null
    };
};

module.exports = {
    extractDestinationMarketFromPayload,
    extractV2MetadataFromPayload
};
