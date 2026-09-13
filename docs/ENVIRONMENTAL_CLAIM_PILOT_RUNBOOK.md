# R18 environmental-claim register pilot

This guarded cumulative pilot validates the immutable claim register after the R01-R07 and R20 fixtures. It uses only
synthetic data and never authorises a real environmental claim, certification or regulator-approved statement.

## Safety boundary

- Use a dedicated non-production PostgreSQL database and uploads directory.
- Confirm `NODE_ENV` is not `production` and apply migrations through
  `031_r18_environmental_claim_register.sql`.
- Never use production credentials, customer claims or real publication channels.

PowerShell example:

```powershell
$env:NODE_ENV='test'
$env:DB_NAME='weavecarbon_r18_pilot'
$env:CARRIER_PILOT_DATABASE='weavecarbon_r18_pilot'
$env:ALLOW_CARRIER_DOCUMENT_PILOT='1'
$env:CARRIER_PILOT_CONFIRM_ISOLATED='I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA'
$env:UPLOADS_DIR='D:\isolated\weavecarbon-r18-pilot-uploads'
npm run test:environmental-claim-pilot
```

## Expected controls

- generic, over-broad, offset-based product-climate, invalid sustainability-label and legal-requirement claims are blocked
  when the 27 September 2026 rules apply;
- exact claim text, channel, market, language, scope, period, method, calculation hash, limits and lifecycle triggers are
  preserved in an immutable revision;
- only the latest revision can receive a named `legal_claim_reviewer` decision;
- publication approval requires locked, tenant/shipment-bound, checksum-identical evidence;
- evidence expiry/revocation/checksum change, claim expiry or a withdrawal event prevents `approved_current` status;
- no automated status is represented as legal advice, authority acceptance or certification.

The result is written to `artifacts/environmental-claim-pilot/result.json`; CI retains it as test evidence. A qualified
legal/compliance reviewer must still validate a real claim against the applicable Member-State implementation before use.
