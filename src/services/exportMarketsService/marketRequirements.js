const { normalizeDocumentCode } = require('./normalizers');

const DEFAULT_MARKET_CODES = ['VN', 'EU', 'US', 'JP', 'KR', 'AU', 'ASEAN'];

const DEFAULT_REQUIRED_DOCUMENTS = [
    {
        code: 'carbon_footprint_report',
        name: 'Carbon Footprint Report',
        document_type: 'report',
        regulation_reference: 'ISO 14067'
    },
    {
        code: 'product_traceability',
        name: 'Product Traceability Document',
        document_type: 'declaration',
        regulation_reference: 'OECD Due Diligence Guidance'
    },
    {
        code: 'import_compliance_declaration',
        name: 'Import Compliance Declaration',
        document_type: 'declaration',
        regulation_reference: 'Import/Customs Compliance'
    }
];

const MATERIAL_CERTIFICATION_DOCUMENTS = [
    {
        code: 'cert_gots',
        name: 'GOTS Certificate',
        document_type: 'certificate',
        regulation_reference: 'Global Organic Textile Standard (GOTS)'
    },
    {
        code: 'cert_oeko_tex',
        name: 'OEKO-TEX Certificate',
        document_type: 'certificate',
        regulation_reference: 'OEKO-TEX Standard 100'
    },
    {
        code: 'cert_grs',
        name: 'GRS Certificate',
        document_type: 'certificate',
        regulation_reference: 'Global Recycled Standard (GRS)'
    },
    {
        code: 'cert_bci_cotton',
        name: 'BCI Cotton Certificate',
        document_type: 'certificate',
        regulation_reference: 'Better Cotton Initiative (BCI)'
    },
    {
        code: 'cert_fsc',
        name: 'FSC Certificate',
        document_type: 'certificate',
        regulation_reference: 'Forest Stewardship Council (FSC)'
    },
    {
        code: 'cert_rcs',
        name: 'RCS Certificate',
        document_type: 'certificate',
        regulation_reference: 'Recycled Claim Standard (RCS)'
    }
];

const MARKET_REQUIREMENTS_BY_CODE = {
    VN: {
        market_name: 'Vietnam',
        required_documents: [
            {
                code: 'eia',
                name: 'Environmental Impact Assessment (EIA)',
                document_type: 'assessment',
                regulation_reference: 'Vietnam Law on Environmental Protection 2020'
            },
            {
                code: 'ghg_inventory_vn',
                name: 'GHG Inventory / MRV Declaration',
                document_type: 'report',
                regulation_reference: 'Decree 06/2022/ND-CP'
            },
            {
                code: 'local_compliance',
                name: 'Local Compliance Declaration',
                document_type: 'declaration',
                regulation_reference: 'Vietnam domestic compliance'
            }
        ]
    },
    EU: {
        market_name: 'European Union',
        required_documents: [
            {
                code: 'cbam_declaration',
                name: 'CBAM Declaration Form',
                document_type: 'declaration',
                regulation_reference: 'EU Regulation (EU) 2023/956'
            },
            {
                code: 'dpp',
                name: 'Digital Product Passport (DPP)',
                document_type: 'report',
                regulation_reference: 'EU Ecodesign for Sustainable Products Regulation'
            },
            {
                code: 'supply_chain_map',
                name: 'Supply Chain Map',
                document_type: 'assessment',
                regulation_reference: 'EU supply chain due diligence'
            }
        ]
    },
    US: {
        market_name: 'United States',
        required_documents: [
            {
                code: 'carbon_report',
                name: 'Carbon Footprint Report',
                document_type: 'report',
                regulation_reference: 'California Climate Disclosure'
            },
            {
                code: 'ca_prop65',
                name: 'CA Prop 65 Compliance',
                document_type: 'certificate',
                regulation_reference: 'California Proposition 65'
            },
            {
                code: 'product_label_compliance',
                name: 'Product Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'US labeling requirements'
            }
        ]
    },
    JP: {
        market_name: 'Japan',
        required_documents: [
            {
                code: 'j_label_cert',
                name: 'J-Label Certification',
                document_type: 'certificate',
                regulation_reference: 'Japan eco-label guidance'
            },
            {
                code: 'jp_import_docs',
                name: 'Japan Import Documentation',
                document_type: 'declaration',
                regulation_reference: 'Japan Customs'
            },
            {
                code: 'carbon_label_jp',
                name: 'Carbon Footprint Label (JP)',
                document_type: 'report',
                regulation_reference: 'Japan CFP Program'
            }
        ]
    },
    KR: {
        market_name: 'South Korea',
        required_documents: [
            {
                code: 'kc_certification',
                name: 'KC Certification',
                document_type: 'certificate',
                regulation_reference: 'Korea Certification (KC)'
            },
            {
                code: 'kr_eco_label',
                name: 'Korea Eco Label',
                document_type: 'certificate',
                regulation_reference: 'Korea Eco-Label Program'
            },
            {
                code: 'kr_import_clearance',
                name: 'Import Clearance Document',
                document_type: 'declaration',
                regulation_reference: 'Korea Customs Service'
            }
        ]
    },
    AU: {
        market_name: 'Australia',
        required_documents: [
            {
                code: 'aus_product_stewardship',
                name: 'Product Stewardship Declaration',
                document_type: 'declaration',
                regulation_reference: 'Australian Product Stewardship framework'
            },
            {
                code: 'aus_carbon_disclosure',
                name: 'Carbon Disclosure Summary',
                document_type: 'report',
                regulation_reference: 'NGER / Australian climate reporting'
            },
            {
                code: 'aus_import_compliance',
                name: 'Australian Import Compliance Declaration',
                document_type: 'declaration',
                regulation_reference: 'Australian Border Force import rules'
            }
        ]
    },
    ASEAN: {
        market_name: 'ASEAN',
        required_documents: [
            {
                code: 'asean_origin_cert',
                name: 'ASEAN Certificate of Origin',
                document_type: 'certificate',
                regulation_reference: 'ATIGA Rules of Origin'
            },
            {
                code: 'asean_label_compliance',
                name: 'ASEAN Labeling Compliance',
                document_type: 'declaration',
                regulation_reference: 'ASEAN product labeling baseline'
            },
            {
                code: 'asean_carbon_summary',
                name: 'ASEAN Carbon Reporting Summary',
                document_type: 'report',
                regulation_reference: 'ASEAN sustainability reporting baseline'
            }
        ]
    },
    TH: {
        market_name: 'Thailand',
        required_documents: [
            {
                code: 'thai_product_registration',
                name: 'Thai Product Registration',
                document_type: 'declaration',
                regulation_reference: 'Thai import registration'
            },
            {
                code: 'thai_labeling',
                name: 'Thai Language Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Thai labeling requirements'
            },
            {
                code: 'asean_origin_cert',
                name: 'ASEAN Certificate of Origin',
                document_type: 'certificate',
                regulation_reference: 'ATIGA Rules of Origin'
            }
        ]
    },
    SG: {
        market_name: 'Singapore',
        required_documents: [
            {
                code: 'sg_product_safety',
                name: 'Singapore Product Safety Declaration',
                document_type: 'declaration',
                regulation_reference: 'CPSR (Consumer Protection Safety Requirements)'
            },
            {
                code: 'sg_carbon_summary',
                name: 'Carbon Reporting Summary',
                document_type: 'report',
                regulation_reference: 'Singapore sustainability disclosure baseline'
            },
            {
                code: 'importer_authorization',
                name: 'Importer Authorization Letter',
                document_type: 'declaration',
                regulation_reference: 'Singapore customs import authorization'
            }
        ]
    },
    MY: {
        market_name: 'Malaysia',
        required_documents: [
            {
                code: 'my_import_permit',
                name: 'Malaysia Import Permit',
                document_type: 'declaration',
                regulation_reference: 'Royal Malaysian Customs import control'
            },
            {
                code: 'my_label_compliance',
                name: 'Malaysia Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Malaysia product labeling'
            },
            {
                code: 'asean_origin_cert',
                name: 'ASEAN Certificate of Origin',
                document_type: 'certificate',
                regulation_reference: 'ATIGA Rules of Origin'
            }
        ]
    },
    ID: {
        market_name: 'Indonesia',
        required_documents: [
            {
                code: 'id_nib_import',
                name: 'NIB / Import Registration',
                document_type: 'declaration',
                regulation_reference: 'Indonesia OSS/NIB import registration'
            },
            {
                code: 'id_label_compliance',
                name: 'Bahasa Indonesia Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Indonesia mandatory labeling'
            },
            {
                code: 'asean_origin_cert',
                name: 'ASEAN Certificate of Origin',
                document_type: 'certificate',
                regulation_reference: 'ATIGA Rules of Origin'
            }
        ]
    },
    PH: {
        market_name: 'Philippines',
        required_documents: [
            {
                code: 'ph_import_clearance',
                name: 'Philippines Import Clearance',
                document_type: 'declaration',
                regulation_reference: 'Philippines Bureau of Customs'
            },
            {
                code: 'ph_label_compliance',
                name: 'Philippines Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Philippines product labeling'
            },
            {
                code: 'asean_origin_cert',
                name: 'ASEAN Certificate of Origin',
                document_type: 'certificate',
                regulation_reference: 'ATIGA Rules of Origin'
            }
        ]
    },
    CA: {
        market_name: 'Canada',
        required_documents: [
            {
                code: 'ca_importer_record',
                name: 'Importer of Record Declaration',
                document_type: 'declaration',
                regulation_reference: 'CBSA import requirements'
            },
            {
                code: 'ca_textile_label',
                name: 'Canada Textile Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Textile Labelling Act (Canada)'
            },
            {
                code: 'ca_carbon_disclosure',
                name: 'Carbon Disclosure Summary',
                document_type: 'report',
                regulation_reference: 'Canadian sustainability disclosure practices'
            }
        ]
    },
    UK: {
        market_name: 'United Kingdom',
        required_documents: [
            {
                code: 'uk_import_declaration',
                name: 'UK Import Declaration',
                document_type: 'declaration',
                regulation_reference: 'UK customs import declaration'
            },
            {
                code: 'uk_textile_label',
                name: 'UK Textile Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'UK product and textile labeling'
            },
            {
                code: 'uk_carbon_summary',
                name: 'Carbon Reporting Summary',
                document_type: 'report',
                regulation_reference: 'UK climate disclosure baseline'
            }
        ]
    },
    CN: {
        market_name: 'China',
        required_documents: [
            {
                code: 'cn_import_registration',
                name: 'China Import Registration',
                document_type: 'declaration',
                regulation_reference: 'China customs import registration'
            },
            {
                code: 'cn_label_compliance',
                name: 'China Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'China GB labeling standards'
            },
            {
                code: 'cn_carbon_declaration',
                name: 'Carbon Declaration Summary',
                document_type: 'report',
                regulation_reference: 'China low-carbon disclosure baseline'
            }
        ]
    },
    IN: {
        market_name: 'India',
        required_documents: [
            {
                code: 'in_import_export_code',
                name: 'Importer-Exporter Code (IEC) Compliance',
                document_type: 'declaration',
                regulation_reference: 'DGFT IEC requirements'
            },
            {
                code: 'in_label_compliance',
                name: 'India Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Legal Metrology (Packaged Commodities) Rules'
            },
            {
                code: 'in_carbon_summary',
                name: 'Carbon Reporting Summary',
                document_type: 'report',
                regulation_reference: 'India sustainability disclosure baseline'
            }
        ]
    }
};

const resolveMarketName = (marketCode) => {
    const normalizedMarketCode = String(marketCode || '').trim().toUpperCase();
    return MARKET_REQUIREMENTS_BY_CODE[normalizedMarketCode]?.market_name || `Market ${normalizedMarketCode}`;
};

const getRequiredDocumentsForMarket = (marketCode) => {
    const normalizedMarketCode = String(marketCode || '').trim().toUpperCase();
    const templates = MARKET_REQUIREMENTS_BY_CODE[normalizedMarketCode]?.required_documents;
    const base = Array.isArray(templates) && templates.length > 0 ? templates : DEFAULT_REQUIRED_DOCUMENTS;

    return base.map(doc => ({
        code: normalizeDocumentCode(doc.code),
        name: doc.name,
        document_type: doc.document_type || null,
        regulation_reference: doc.regulation_reference || null
    }));
};

const resolveDocumentTypeForMarket = (marketCode, documentCode) => {
    const normalizedDocumentCode = normalizeDocumentCode(documentCode);
    if (!normalizedDocumentCode) {
        return null;
    }

    const template = getRequiredDocumentsForMarket(marketCode)
        .find(doc => normalizeDocumentCode(doc.code) === normalizedDocumentCode);
    return template?.document_type || null;
};

module.exports = {
    DEFAULT_MARKET_CODES,
    DEFAULT_REQUIRED_DOCUMENTS,
    MATERIAL_CERTIFICATION_DOCUMENTS,
    MARKET_REQUIREMENTS_BY_CODE,
    resolveMarketName,
    getRequiredDocumentsForMarket,
    resolveDocumentTypeForMarket
};