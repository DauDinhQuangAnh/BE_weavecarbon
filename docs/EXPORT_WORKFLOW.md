# Shipment-scoped export workflow

This workflow is the only production path for generating WeaveCarbon export documents.
Company-scoped legacy document endpoints return HTTP 410 because they cannot prove which
products belong to a shipment.

## Document status

- `ready`: a controlled copy exists for internal review; its payload, source snapshot and file checksum are recorded.
- `issued`: validation was repeated and the exact approved bytes were promoted as the immutable external version.
- `superseded`: a newer version of the same document type was issued.
- `blocked`: mandatory shipment data or approved evidence is missing.

`Carbon Annex` is supplementary data. It is never a carrier-issued bill of lading, air
waybill or CMR. Carrier documents must be uploaded through `/api/evidence/upload` with a
`shipmentId`, then approved/locked before Carbon Annex or ICS2 support data can be issued.
An uploaded file alone never satisfies readiness. The approval identity and validity period
are retained with the evidence record.

Commercial Invoice and Packing List require a named, append-only business review before issue.
Only a company administrator may record the workflow decision. Commercial Invoice requires the
`export_operator` review role and Packing List requires `warehouse_reviewer`. The approval is
bound to payload SHA-256, file SHA-256 and shipment-source SHA-256; rejected, changes-requested
or stale approvals block issue.

Issuing also compares the current shipment/evidence snapshot with the snapshot used to build
the review file. A changed profile, line, package or approved evidence blocks the issue action
with `DOCUMENT_SNAPSHOT_STALE`; the user must generate a new document version.

Commercial invoices require their number/date/place, party country/contact, payment terms,
exporter tax identity, destination-applicable EORI/VAT, customs value/basis, transport/ports and
an explicitly confirmed HS/CN code plus source, ruleset and effective date for every line.
Changing the classification or its provenance invalidates its prior confirmation. Freight and insurance are required
when the selected Incoterm makes them relevant; discount cannot make the calculated invoice
total negative. Dates, ISO country/currency formats, Incoterms 2020 codes, transport modes and
6-to-10-digit HS/CN values are validated. Packing lists require their own number/date, marks, dimensions, weights and a
complete package-to-line quantity allocation. Every package declares whether weight/dimensions
are per-package or already group totals, preventing accidental multiplication. Quantity plus net
and gross weights are reconciled, and CBM is calculated using that declared basis before a file can become `ready`.

## Production endpoints

- `GET|PUT /api/export/shipments/:shipmentId/profile`
- `POST /api/export/shipments/:shipmentId/lines/sync`
- `POST|PATCH|DELETE /api/export/shipments/:shipmentId/lines[/:lineId]`
- `POST|PATCH|DELETE /api/export/shipments/:shipmentId/packages[/:packageId]`
- `GET /api/export/shipments/:shipmentId/readiness`
- `POST /api/export/shipments/:shipmentId/documents/:type/generate`
- `GET|POST /api/export/shipments/:shipmentId/documents/:id/reviews`
- `POST /api/export/shipments/:shipmentId/documents/:id/issue`

Generated files use the existing durable report queue and `/api/reports/:id/status` plus
`/api/reports/:id/download` APIs.

## Release checklist

1. Back up PostgreSQL and the uploads directory.
2. Apply migrations 017 through `022_export_document_business_review.sql` in staging.
3. Create a Vietnam-to-EU shipment with more than 20 lines.
4. Complete parties, invoice, Incoterm, EORI, ports, line prices/weights and packages.
5. Upload and lock a real carrier document linked to the shipment.
6. Fill package marks/dimensions and allocate the exact quantity of each goods line.
7. Confirm readiness, generate each applicable document, download the controlled copy, record the
   required named review, then issue it and verify that approved and issued SHA-256 values are identical.
8. Confirm chapter 61/62/64 goods return `CBAM_NOT_APPLICABLE`.
9. Deploy application code only after staging smoke tests pass; apply the database migration
   before routing traffic to the new application version.

DPP remains a prototype until a product-specific ESPR delegated act defines the mandatory
textile/footwear schema. The API requires a valid GS1 GTIN, a public HTTPS URL and explicit
operator/facility identifiers and never fabricates them.
