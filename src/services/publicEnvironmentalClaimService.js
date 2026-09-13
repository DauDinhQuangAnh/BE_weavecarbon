const pool = require('../config/database');
const { derivePublicationStatus } = require('./environmentalClaimControls');

const EU_COUNTRY_NAMES = Object.freeze({
  austria: 'AT', belgium: 'BE', bulgaria: 'BG', croatia: 'HR', cyprus: 'CY', czechia: 'CZ',
  'czech republic': 'CZ', denmark: 'DK', estonia: 'EE', finland: 'FI', france: 'FR', germany: 'DE',
  greece: 'GR', hungary: 'HU', ireland: 'IE', italy: 'IT', latvia: 'LV', lithuania: 'LT',
  luxembourg: 'LU', malta: 'MT', netherlands: 'NL', poland: 'PL', portugal: 'PT', romania: 'RO',
  slovakia: 'SK', slovenia: 'SI', spain: 'ES', sweden: 'SE'
});

function text(value) { return String(value ?? '').trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function dateOnly(value) { if (!value) return null; return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
function normalizedReference(value) { return text(value).toLowerCase(); }
function destinationCode(value) {
  const normalized = normalizedReference(value);
  if (/^[a-z]{2}$/.test(normalized)) return normalized.toUpperCase();
  return EU_COUNTRY_NAMES[normalized] || null;
}

function subjectMatches(input, context) {
  const reference = normalizedReference(input.subjectReference);
  if (input.subjectType === 'product') return reference === normalizedReference(context.productId);
  if (input.subjectType === 'sku') return reference === normalizedReference(context.productSku);
  if (input.subjectType === 'shipment') return [context.shipmentId, context.shipmentReference]
    .map(normalizedReference).includes(reference);
  return false;
}

function claimMatchesPassportSurface(dossier, context) {
  const input = dossier.input_snapshot || {};
  const market = destinationCode(context.destinationCountry);
  return input.publicCommunication === true
    && input.channel === 'website'
    && subjectMatches(input, context)
    && text(input.methodology?.calculationSha256).toLowerCase() === text(context.calculationSha256).toLowerCase()
    && Boolean(market)
    && array(input.marketCodes).includes(market);
}

class PublicEnvironmentalClaimService {
  constructor(database = pool) { this.database = database; }

  async resolvePassportClaims(context) {
    if (!context.companyId || !context.shipmentId || !context.productId || !context.calculationSha256) return [];
    const dossierResult = await this.database.query(
      `SELECT DISTINCT ON (dossier.claim_reference)
              dossier.*, to_jsonb(latest_review) AS latest_review
       FROM environmental_claim_dossiers dossier
       LEFT JOIN LATERAL (
         SELECT review.* FROM environmental_claim_reviews review
         WHERE review.dossier_id=dossier.id AND review.company_id=dossier.company_id
           AND review.shipment_id=dossier.shipment_id
         ORDER BY review.created_at DESC, review.id DESC LIMIT 1
       ) latest_review ON true
       WHERE dossier.company_id=$1 AND dossier.shipment_id=$2
       ORDER BY dossier.claim_reference, dossier.revision DESC`,
      [context.companyId, context.shipmentId]
    );
    const candidates = dossierResult.rows.filter((row) => claimMatchesPassportSurface(row, context));
    const evidenceIds = [...new Set(candidates.flatMap((row) => array(row.evidence_snapshot).map((item) => item.id).filter(Boolean)))];
    const evidenceResult = evidenceIds.length ? await this.database.query(
      `SELECT id, checksum_sha256, file_size_bytes, status, valid_to
       FROM evidence_documents
       WHERE company_id=$1 AND shipment_id=$2 AND id=ANY($3::uuid[])`,
      [context.companyId, context.shipmentId, evidenceIds]
    ) : { rows: [] };
    const currentEvidence = evidenceResult.rows.map((row) => ({
      id: row.id, checksumSha256: row.checksum_sha256, fileSizeBytes: Number(row.file_size_bytes || 0),
      status: row.status, validTo: dateOnly(row.valid_to)
    }));
    return candidates.filter((row) => derivePublicationStatus({
      input_snapshot: row.input_snapshot, result_snapshot: row.result_snapshot, latest_review: row.latest_review
    }, currentEvidence).status === 'approved_current').map((row) => ({
      dossierId: row.id, claimReference: row.claim_reference, revision: Number(row.revision),
      exactClaimText: row.input_snapshot.exactClaimText,
      specificationText: row.input_snapshot.specificationText,
      languageCode: row.input_snapshot.languageCode, marketCodes: row.input_snapshot.marketCodes,
      communicationStart: dateOnly(row.communication_start), communicationEnd: dateOnly(row.communication_end),
      rulesetId: row.ruleset_id, rulesetVersion: row.ruleset_version,
      resultSha256: row.result_sha256
    }));
  }
}

module.exports = new PublicEnvironmentalClaimService();
module.exports.PublicEnvironmentalClaimService = PublicEnvironmentalClaimService;
module.exports.claimMatchesPassportSurface = claimMatchesPassportSurface;
module.exports.destinationCode = destinationCode;
