const { buildSimpleXlsx } = require('../utils/simpleXlsx');
const { buildExportDocumentPdf } = require('./exportDocumentPdf');
const {
  validateVnCustomsHandoff,
  buildVnCustomsHandoffDataset
} = require('./vnCustomsHandoffControls');
const {
  validateEuImportHandoff,
  buildEuImportHandoffDataset
} = require('./euImportHandoffControls');
const {
  validateIcs2Handoff,
  buildIcs2HandoffDataset
} = require('./ics2HandoffControls');
const {
  validateOriginHandoff,
  buildOriginHandoffDataset
} = require('./originHandoffControls');
const {
  packageNetTotal,
  packageGrossTotal,
  packageCbmTotal
} = require('./exportPackageTotals');

function text(value) { return String(value ?? '').trim(); }
function normalizeHsCode(value) { return text(value).replace(/[^0-9]/g, ''); }

function buildDocumentRows(type, payload) {
  const lines = payload.lines || [];
  const packages = payload.packages || [];
  const containers = payload.containers || [];
  const leafPackages = packages.filter((pkg) => text(pkg.packageType).toLowerCase() !== 'pallet');
  const containerNumbers = containers.map((item) => item.containerNumber).filter(Boolean).join('; ');
  if (type === 'origin_workbook') {
    return (payload.originProfile?.lineAssessments || []).flatMap((assessment) => {
      const line = lines.find((item) => item.id === assessment.exportLineId) || {};
      return (assessment.materials || []).map((material) => ({
        lineNumber: line.lineNumber,
        sku: line.sku,
        exportHsCode: normalizeHsCode(line.hsCode),
        ruleCode: assessment.ruleCode,
        ruleSourcePage: assessment.ruleSourcePage,
        productionProcesses: (assessment.productionProcesses || []).join('; '),
        exWorksPrice: assessment.exWorksPrice,
        materialReference: material.reference,
        materialDescription: material.description,
        materialHsCode: material.hsCode,
        supplierName: material.supplierName,
        materialOriginCountry: material.originCountry,
        materialOriginStatus: material.originStatus,
        cumulationBasis: material.cumulationBasis,
        materialValue: material.value,
        materialWeightKg: material.weightKg,
        evidenceDocumentId: material.evidenceDocumentId
      }));
    });
  }
  if (type === 'vn_customs_handoff') return lines.map((line) => ({
    lineNumber: line.lineNumber,
    sku: line.sku,
    goodsDescription: line.goodsDescription,
    vietnamHsCode: normalizeHsCode(line.hsCode),
    hsSource: line.hsCodeSource,
    hsRuleset: line.hsCodeRuleset,
    hsEffectiveDate: line.hsCodeEffectiveDate,
    originCountry: line.originCountry,
    destinationCountry: payload.vnCustomsProfile?.destinationCountryCode || payload.shipment?.destinationCountry,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    currency: line.currency || payload.profile?.currency,
    lineValue: Number(line.quantity || 0) * Number(line.unitPrice || 0),
    netWeightKg: line.netWeightKg,
    grossWeightKg: line.grossWeightKg,
    packageRefs: JSON.stringify(line.packageRefs || [])
  }));
  if (type === 'eu_import_handoff') return lines.map((line) => {
    const detail = (payload.euImportLineDetails || []).find((item) => item.exportLineId === line.id) || {};
    return {
      lineNumber: line.lineNumber,
      sku: line.sku,
      goodsDescription: line.goodsDescription,
      taricCode: detail.taricCode || '',
      taricSource: detail.taricSource || '',
      taricVersion: detail.taricVersion || '',
      taricEffectiveDate: detail.taricEffectiveDate || '',
      taricConfirmed: detail.taricConfirmed === true,
      taricConfirmedBy: detail.taricConfirmedBy || '',
      taricConfirmedAt: detail.taricConfirmedAt || '',
      supplementaryUnitCode: detail.supplementaryUnitCode || '',
      additionalCodes: JSON.stringify(detail.additionalCodes || []),
      nationalAdditionalCodes: JSON.stringify(detail.nationalAdditionalCodes || []),
      preferenceCode: detail.preferenceCode || '',
      requestedProcedureCode: detail.requestedProcedureCode || payload.euImportProfile?.requestedProcedureCode || '',
      previousProcedureCode: detail.previousProcedureCode || payload.euImportProfile?.previousProcedureCode || '',
      originCountry: line.originCountry,
      quantity: line.quantity,
      unit: line.unit,
      itemValue: Number(line.quantity || 0) * Number(line.unitPrice || 0),
      currency: line.currency || payload.profile?.currency,
      netWeightKg: line.netWeightKg,
      grossWeightKg: line.grossWeightKg,
      packageRefs: JSON.stringify(line.packageRefs || [])
    };
  });
  if (type === 'ics2_dataset') {
    const lineById = new Map(lines.map((line) => [line.id, line]));
    return (payload.ics2Profile?.houseConsignments || []).flatMap((house) =>
      (house.goodsLineIds || []).map((lineId) => {
        const line = lineById.get(lineId) || {};
        return {
          datasetCode: payload.ics2Profile?.messageDatasetCode || '',
          localReferenceNumber: payload.ics2Profile?.localReferenceNumber || '',
          masterTransportDocumentNo: payload.ics2Profile?.masterTransportDocument?.number || '',
          houseTransportDocumentNo: house.transportDocumentNumber || '',
          consignorName: house.consignor?.name || '', consigneeName: house.consignee?.name || '',
          destinationCountry: house.destinationCountry || '', houseGrossMassKg: house.grossMassKg ?? '',
          housePackageCount: house.packageCount ?? '', lineNumber: line.lineNumber || '', sku: line.sku || '',
          goodsDescription: line.goodsDescription || '', hsCode: line.hsCode || '',
          originCountry: line.originCountry || '', quantity: line.quantity ?? '', unit: line.unit || '',
          grossWeightKg: line.grossWeightKg ?? '', containerNo: containerNumbers
        };
      })
    );
  }
  if (type === 'packing_list') return leafPackages.map((pkg) => ({
    containerNumber: pkg.containerNumber, sealNumber: pkg.sealNumber,
    palletNumber: pkg.parentPackageNumber, packageNumber: pkg.packageNumber,
    packageType: pkg.packageType, marks: pkg.marksAndNumbers,
    quantity: pkg.quantity, netWeightKg: packageNetTotal(pkg), grossWeightKg: packageGrossTotal(pkg),
    weightBasis: pkg.weightMeasurementBasis, dimensionBasis: pkg.dimensionMeasurementBasis,
    cbm: packageCbmTotal(pkg),
    dimensions: [pkg.lengthCm, pkg.widthCm, pkg.heightCm].filter((v) => v !== null).join(' x '),
    contents: JSON.stringify(pkg.contents || [])
  }));
  if (type === 'carbon_annex') {
    const carrier = (payload.carrierDocuments || []).find((item) => item.structured?.status === 'confirmed');
    return lines.map((line) => ({
      lineNumber: line.lineNumber, sku: line.sku, hsCode: line.hsCode, quantity: line.quantity,
      embeddedCo2eKg: line.embeddedCo2eKg, carrierDocumentNo: payload.profile.billOfLadingNo,
      carrierDocumentType: carrier?.structured?.documentType || '', carrierIssuer: carrier?.structured?.issuerName || '',
      carrierFileSha256: carrier?.checksumSha256 || '', containerNo: containerNumbers,
      calculationSnapshot: line.carbonAuthority?.snapshotId || '',
      calculationVersion: line.carbonAuthority?.snapshotVersion || '',
      methodology: line.carbonAuthority?.methodologyVersion || '',
      boundary: line.carbonAuthority?.boundary || '', factorRegistry: line.carbonAuthority?.factorRegistryVersion || '',
      factorProvenance: JSON.stringify(line.carbonAuthority?.factorSnapshot || []),
      gwpBasis: line.carbonAuthority?.gwpBasis || '', allocationMethod: line.carbonAuthority?.allocationMethod || '',
      canonicalInputSha256: line.carbonAuthority?.canonicalInputHash || ''
    }));
  }
  return lines.map((line) => ({
    lineNumber: line.lineNumber, sku: line.sku, description: line.goodsDescription,
    styleCode: line.styleCode, sizeLabel: line.sizeLabel, colorLabel: line.colorLabel, lotNumber: line.lotNumber,
    hsCode: line.hsCode, hsBasis: [line.hsCodeSource, line.hsCodeRuleset, line.hsCodeEffectiveDate].filter(Boolean).join(' | '),
    originCountry: line.originCountry, quantity: line.quantity, unit: line.unit,
    unitPrice: line.unitPrice, currency: line.currency || payload.profile.currency,
    lineValue: Number(line.quantity || 0) * Number(line.unitPrice || 0),
    netWeightKg: line.netWeightKg, grossWeightKg: line.grossWeightKg
  }));
}

async function buildDocumentBuffer(type, payload, issued, outputFormat = null, context = {}) {
  const {
    rulesetVersion = 'VN-EU-TEXTILE-2026.09.4',
    carrierRulesetVersion = 'R03-CARRIER-RECONCILIATION-2026.09.1',
    carrierReconciliationSha256 = () => '',
    isCurrentIssuedSupportingDocument = () => false,
    originHandoffSchema = {
      id: 'EVFTA_ORIGIN_SUPPORT_HANDOFF',
      version: '2026.09',
      rulesetVersion: 'VN-EU-ORIGIN-EVFTA-2026.09.1',
      regulatoryBasisVersion: 'EVFTA Protocol 1 (OJ L 186/2020)'
    },
    ics2HandoffSchema = {
      id: 'EU_ICS2_FILER_HANDOFF',
      version: '2026.09',
      ics2Release: 'Release 3',
      regulatoryBasisVersion: 'UCC-IA Annex B / UCC-DA Annex B (2026.09)'
    },
    vnCustomsHandoffSchema = {
      id: 'VN_CUSTOMS_BROKER_HANDOFF',
      version: '2026.09',
      regulatoryBasisVersion: 'Circular 38/2015/TT-BTC as amended by Circular 39/2018/TT-BTC'
    },
    euImportHandoffSchema = {
      id: 'EU_IMPORT_DECLARANT_HANDOFF',
      version: '2026.09',
      eucdmVersion: 'EUCDM v6.3',
      regulatoryBasisVersion: 'UCC Annex B (Commission Delegated Regulation (EU) 2015/2446)'
    }
  } = context;

  const format = outputFormat || (['ics2_dataset', 'vn_customs_handoff', 'eu_import_handoff', 'origin_workbook']
    .includes(type) ? 'json' : 'xlsx');
  if (format === 'pdf') return buildExportDocumentPdf(type, payload, issued);
  if (type === 'vn_customs_handoff' && format === 'json') {
    const reconciliation = validateVnCustomsHandoff(payload, {
      isCarrierCurrent: (item) => item.latestReconciliation?.status === 'passed'
        && item.latestReconciliation?.rulesetVersion === carrierRulesetVersion
        && item.latestReconciliation?.sourceSnapshotSha256 === carrierReconciliationSha256(payload, item),
      isSupportingDocumentCurrent: (document) => isCurrentIssuedSupportingDocument(payload, document)
    });
    const dataset = buildVnCustomsHandoffDataset(payload, {
      generatedAt: payload.generatedAt,
      documentVersion: payload.documentVersion,
      sourceSnapshotSha256: payload.sourceSnapshotSha256,
      reconciliation
    });
    return Buffer.from(`${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  }
  if (type === 'eu_import_handoff' && format === 'json') {
    const reconciliation = validateEuImportHandoff(payload, {
      isCarrierCurrent: (item) => item.latestReconciliation?.status === 'passed'
        && item.latestReconciliation?.rulesetVersion === carrierRulesetVersion
        && item.latestReconciliation?.sourceSnapshotSha256 === carrierReconciliationSha256(payload, item),
      isSupportingDocumentCurrent: (document) => isCurrentIssuedSupportingDocument(payload, document)
    });
    const dataset = buildEuImportHandoffDataset(payload, {
      generatedAt: payload.generatedAt,
      documentVersion: payload.documentVersion,
      sourceSnapshotSha256: payload.sourceSnapshotSha256,
      reconciliation
    });
    return Buffer.from(`${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  }
  if (type === 'ics2_dataset' && format === 'json') {
    const reconciliation = validateIcs2Handoff(payload, {
      isCarrierCurrent: (item) => item.latestReconciliation?.status === 'passed'
        && item.latestReconciliation?.rulesetVersion === carrierRulesetVersion
        && item.latestReconciliation?.sourceSnapshotSha256 === carrierReconciliationSha256(payload, item)
    });
    const dataset = buildIcs2HandoffDataset(payload, {
      generatedAt: payload.generatedAt,
      documentVersion: payload.documentVersion,
      sourceSnapshotSha256: payload.sourceSnapshotSha256,
      reconciliation
    });
    return Buffer.from(`${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  }
  if (type === 'origin_workbook' && format === 'json') {
    const reconciliation = validateOriginHandoff(payload);
    const dataset = buildOriginHandoffDataset(payload, {
      generatedAt: payload.generatedAt,
      documentVersion: payload.documentVersion,
      sourceSnapshotSha256: payload.sourceSnapshotSha256,
      reconciliation
    });
    return Buffer.from(`${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  }
  const p = payload.profile || {};
  const lines = payload.lines || [];
  const packages = payload.packages || [];
  const containers = payload.containers || [];
  const leafPackages = packages.filter((pkg) => text(pkg.packageType).toLowerCase() !== 'pallet');
  const goodsTotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
  const freight = Number(p.freightAmount || 0);
  const insurance = Number(p.insuranceAmount || 0);
  const discount = Number(p.discountAmount || 0);
  const surcharge = Number(p.surchargeAmount || 0);
  const totalPackages = leafPackages.reduce((sum, pkg) => sum + Number(pkg.quantity || 0), 0);
  const totalQuantity = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const totalNetKg = leafPackages.reduce((sum, pkg) => sum + packageNetTotal(pkg), 0);
  const totalGrossKg = leafPackages.reduce((sum, pkg) => sum + packageGrossTotal(pkg), 0);
  const totalCbm = leafPackages.reduce((sum, pkg) => sum + packageCbmTotal(pkg), 0);
  const party = (value) => [value?.name, value?.address, value?.country, value?.contact].filter(Boolean).join(' | ');
  const commonMetadata = {
    'Shipment reference': payload.shipment?.referenceNumber || payload.shipment?.id,
    'Document version': payload.documentVersion || '',
    'Ruleset': rulesetVersion, 'Control status': 'CONTROLLED COPY - VERIFY STATUS IN WEAVECARBON'
  };
  const metadataByType = {
    commercial_invoice: {
      ...commonMetadata,
      'Invoice number': p.invoiceNumber || '', 'Invoice date': p.invoiceDate || '',
      'Issue place': p.invoiceIssuePlace || '', 'Exporter': party(p.exporter),
      'Exporter tax ID': p.exporterTaxId || '', 'Importer': party(p.importer),
      'Importer EORI': p.importerEori || '', 'Importer VAT ID': p.importerVatId || '',
      'Consignee': party(p.consignee), 'PO / Contract': p.poContractId || '',
      'Incoterm': `${p.incotermCode || ''} ${p.incotermLocation || ''} (${p.incotermVersion || 'Incoterms 2020'})`.trim(),
      'Payment terms': p.paymentTerms || '', 'Transport mode': p.transportMode || '',
      'Loading / discharge': `${p.portOfLoading || ''} / ${p.portOfDischarge || ''}`,
      'Place of delivery': p.placeOfDelivery || '', 'Packing list number': p.packingListNumber || '',
      'Carrier document no.': p.billOfLadingNo || '', 'Customs declaration no.': p.customsDeclarationNo || '',
      'Carrier': p.carrierName || '', 'Vessel / flight': p.vesselName || '', 'Voyage': p.voyageNumber || '',
      'Currency': p.currency || '', 'Goods total': goodsTotal, 'Discount': discount,
      'Surcharge': surcharge, 'Freight': freight, 'Insurance': insurance,
      'Invoice total': goodsTotal + freight + insurance + surcharge - discount,
      'Customs value': p.customsValueAmount ?? '', 'Customs value basis': p.customsValueBasis || ''
    },
    packing_list: {
      ...commonMetadata,
      'Packing list number': p.packingListNumber || '', 'Packing list date': p.packingListDate || '',
      'Invoice number': p.invoiceNumber || '', 'Exporter': party(p.exporter), 'Consignee': party(p.consignee),
      'PO / Contract': p.poContractId || '', 'Transport mode': p.transportMode || '',
      'Carrier / transport company': p.carrierName || '',
      'Carrier document no.': p.billOfLadingNo || '',
      'Containers / seals': containers.map((item) => `${item.containerNumber} / ${item.sealNumber}`).join('; '),
      'Total containers': containers.length,
      'Total packages': totalPackages, 'Total quantity': totalQuantity,
      'Total net kg': totalNetKg, 'Total gross kg': totalGrossKg, 'Total CBM': totalCbm
    },
    carbon_annex: {
      ...commonMetadata, 'Carrier document no.': p.billOfLadingNo || '',
      'Containers / seals': containers.map((item) => `${item.containerNumber} / ${item.sealNumber}`).join('; '),
      'Transport mode': p.transportMode || '', 'Total quantity': totalQuantity,
      'Document nature': 'SUPPLEMENTARY CARBON ANNEX - NOT A BILL OF LADING / AWB / CMR / CIM',
      'Authority warning': 'Carrier-issued transport document remains authoritative. WeaveCarbon does not issue it.'
    },
    origin_workbook: {
      ...commonMetadata,
      'Dataset nature': 'EVFTA ORIGIN SUPPORT HANDOFF - NOT PROOF OF ORIGIN / NOT EUR.1',
      'Internal schema': `${originHandoffSchema.id}@${originHandoffSchema.version}`,
      'Ruleset': originHandoffSchema.rulesetVersion,
      'Regulatory basis version': originHandoffSchema.regulatoryBasisVersion,
      'Exporter': party(p.exporter), 'Invoice number': p.invoiceNumber || '',
      'PO / Contract': p.poContractId || '', 'Preferential claim': p.preferentialOriginClaim === true,
      'Proof of origin status': 'NOT_ISSUED', 'Preferential treatment status': 'NOT_GRANTED',
      'Specialist review required': true
    },
    ics2_dataset: {
      ...commonMetadata,
      'Dataset nature': 'ICS2 FILER HANDOFF - NOT AN ENS MESSAGE, MRN, REGISTRATION OR CUSTOMS ACCEPTANCE',
      'Internal schema': `${ics2HandoffSchema.id}@${ics2HandoffSchema.version}`,
      'ICS2 release': ics2HandoffSchema.ics2Release,
      'Regulatory basis version': ics2HandoffSchema.regulatoryBasisVersion,
      'Annex B dataset': payload.ics2Profile?.messageDatasetCode || '',
      'Transport mode': payload.ics2Profile?.transportMode || '',
      'Filing role / arrangement': `${payload.ics2Profile?.filingRole || ''} / ${payload.ics2Profile?.filingArrangement || ''}`,
      'Target system schema': `${payload.ics2Profile?.targetSystemSchemaId || ''}@${payload.ics2Profile?.targetSystemSchemaVersion || ''}`,
      'Technical package': `${payload.ics2Profile?.technicalPackageId || ''}@${payload.ics2Profile?.technicalPackageVersion || ''}`,
      'Local reference number': payload.ics2Profile?.localReferenceNumber || '',
      'Authority status': 'NOT_SUBMITTED'
    },
    vn_customs_handoff: {
      ...commonMetadata,
      'Dataset nature': 'BROKER HANDOFF - NOT A VNACCS MESSAGE OR CUSTOMS ACCEPTANCE',
      'Internal schema': `${vnCustomsHandoffSchema.id}@${vnCustomsHandoffSchema.version}`,
      'Regulatory basis version': vnCustomsHandoffSchema.regulatoryBasisVersion,
      'Broker target schema': `${payload.vnCustomsProfile?.brokerTargetSchemaId || ''}@${payload.vnCustomsProfile?.brokerTargetSchemaVersion || ''}`,
      'Customs office code': payload.vnCustomsProfile?.customsOfficeCode || '',
      'Declaration type code': payload.vnCustomsProfile?.declarationTypeCode || '',
      'Transport method code': payload.vnCustomsProfile?.transportMethodCode || '',
      'Invoice number': p.invoiceNumber || '',
      'Packing list number': p.packingListNumber || '',
      'Currency / exchange rate': `${p.currency || ''} / ${payload.vnCustomsProfile?.exchangeRate || ''}`,
      'Authority status': 'NOT_SUBMITTED'
    },
    eu_import_handoff: {
      ...commonMetadata,
      'Dataset nature': 'DECLARANT HANDOFF - NOT A SAD, NATIONAL MESSAGE, MRN OR CUSTOMS ACCEPTANCE',
      'Internal schema': `${euImportHandoffSchema.id}@${euImportHandoffSchema.version}`,
      'EUCDM reference version': euImportHandoffSchema.eucdmVersion,
      'Regulatory basis version': euImportHandoffSchema.regulatoryBasisVersion,
      'Target system schema': `${payload.euImportProfile?.targetSystemSchemaId || ''}@${payload.euImportProfile?.targetSystemSchemaVersion || ''}`,
      'Import Member State': payload.euImportProfile?.memberStateCode || '',
      'Declaration dataset': payload.euImportProfile?.declarationDatasetCode || '',
      'Customs office code': payload.euImportProfile?.customsOfficeCode || '',
      'Importer EORI': payload.euImportProfile?.importer?.eori || '',
      'Declarant EORI': payload.euImportProfile?.declarant?.eori || '',
      'Invoice number': p.invoiceNumber || '',
      'Packing list number': p.packingListNumber || '',
      'Authority status': 'NOT_SUBMITTED'
    }
  };
  const metadata = metadataByType[type] || commonMetadata;
  const rows = buildDocumentRows(type, payload);
  const columnsByType = {
    commercial_invoice: [
      ['lineNumber','Line'],['sku','SKU'],['styleCode','Style'],['sizeLabel','Size'],['colorLabel','Colour'],['lotNumber','Lot'],
      ['description','Description'],['hsCode','HS/CN'],['hsBasis','HS source / ruleset / effective'],['originCountry','Origin'],
      ['quantity','Quantity'],['unit','Unit'],['unitPrice','Unit price'],['currency','Currency'],['lineValue','Line value']
    ],
    packing_list: [
      ['containerNumber','Container'],['sealNumber','Seal'],['palletNumber','Pallet'],
      ['packageNumber','Package'],['packageType','Type'],['marks','Marks'],['quantity','Packages'],
      ['weightBasis','Weight basis'],['netWeightKg','Net kg total'],['grossWeightKg','Gross kg total'],
      ['dimensionBasis','Dimension basis'],['dimensions','L x W x H cm'],['cbm','CBM total'],['contents','Contents']
    ],
    carbon_annex: [
      ['lineNumber','Line'],['sku','SKU'],['hsCode','HS/CN'],['quantity','Quantity'],
      ['embeddedCo2eKg','Embedded kg CO2e'],['carrierDocumentType','Carrier document type'],
      ['carrierDocumentNo','Carrier document'],['carrierIssuer','Carrier issuer'],
      ['carrierFileSha256','Carrier file SHA-256'],['containerNo','Container'],
      ['calculationSnapshot','Calculation snapshot ID'],['calculationVersion','Calculation version'],
      ['methodology','Methodology version'],['boundary','Boundary'],['factorRegistry','Factor registry version'],
      ['factorProvenance','Factor provenance'],['gwpBasis','GWP basis'],['allocationMethod','Allocation method'],
      ['canonicalInputSha256','Canonical input SHA-256']
    ],
    origin_workbook: [
      ['lineNumber','Line'],['sku','SKU'],['exportHsCode','Export HS/CN'],['ruleCode','Rule code'],
      ['ruleSourcePage','Annex-II reference'],['productionProcesses','Production processes'],
      ['exWorksPrice','Ex-works price EUR'],['materialReference','Material reference'],
      ['materialDescription','Material description'],['materialHsCode','Material HS'],
      ['supplierName','Supplier'],['materialOriginCountry','Material origin country'],
      ['materialOriginStatus','Origin status'],['cumulationBasis','Cumulation basis'],
      ['materialValue','Material value EUR'],['materialWeightKg','Material weight kg'],
      ['evidenceDocumentId','Locked evidence ID']
    ],
    ics2_dataset: [
      ['datasetCode','Annex B dataset'],['localReferenceNumber','Local reference number'],
      ['masterTransportDocumentNo','Master transport document'],['houseTransportDocumentNo','House transport document'],
      ['consignorName','Consignor'],['consigneeName','Consignee'],['destinationCountry','Destination'],
      ['houseGrossMassKg','House gross kg'],['housePackageCount','House packages'],
      ['lineNumber','Line'],['sku','SKU'],['goodsDescription','Detailed goods description'],
      ['hsCode','HS/CN'],['originCountry','Origin'],['quantity','Quantity'],['unit','Unit'],
      ['grossWeightKg','Gross kg'],['containerNo','Containers']
    ],
    vn_customs_handoff: [
      ['lineNumber','Line'],['sku','SKU'],['goodsDescription','Detailed goods description'],
      ['vietnamHsCode','Vietnam HS (8 digits)'],['hsSource','HS source'],['hsRuleset','HS ruleset'],
      ['hsEffectiveDate','HS effective date'],['originCountry','Origin'],['destinationCountry','Destination'],
      ['quantity','Quantity'],['unit','Customs unit'],['unitPrice','Invoice unit price'],
      ['currency','Currency'],['lineValue','Line value'],['netWeightKg','Net kg'],
      ['grossWeightKg','Gross kg'],['packageRefs','Package references']
    ],
    eu_import_handoff: [
      ['lineNumber','Line'],['sku','SKU'],['goodsDescription','Detailed goods description'],
      ['taricCode','TARIC (10 digits)'],['taricSource','TARIC source'],['taricVersion','TARIC version'],
      ['taricEffectiveDate','TARIC effective date'],['taricConfirmed','TARIC confirmed'],
      ['taricConfirmedBy','Confirmed by'],['taricConfirmedAt','Confirmed at'],
      ['supplementaryUnitCode','Supplementary unit'],['additionalCodes','Additional codes'],
      ['nationalAdditionalCodes','National additional codes'],['preferenceCode','Preference code'],
      ['requestedProcedureCode','Requested procedure'],['previousProcedureCode','Previous procedure'],
      ['originCountry','Origin'],['quantity','Quantity'],['unit','Unit'],['itemValue','Item value'],
      ['currency','Currency'],['netWeightKg','Net kg'],['grossWeightKg','Gross kg'],['packageRefs','Package references']
    ]
  };
  return buildSimpleXlsx({
    title: type.replace(/_/g, ' ').toUpperCase(), sheetName: type,
    metadata, columns: columnsByType[type].map(([key, label]) => ({ key, label })), rows,
    watermark: 'CONTROLLED COPY - VERIFY STATUS IN WEAVECARBON',
    printLayout: type === 'commercial_invoice'
      ? { widths: [22, 16, 12, 8, 10, 12, 32, 14, 24, 10, 14, 10, 16, 10, 20] } : null
  });
}

module.exports = {
  buildDocumentRows,
  buildDocumentBuffer
};
