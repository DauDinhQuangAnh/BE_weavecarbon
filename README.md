# WeaveCarbon BE

Backend API for WeaveCarbon, built with Node.js, Express, and PostgreSQL.

## Commands

```bash
npm run dev
npm run start
npm run check:syntax
```

## Structure

- `src/routes/`: HTTP route modules
- `src/services/`: business logic and database orchestration
- `src/validators/`: request validation rules
- `src/middleware/`: auth, validation, rate limiting, error handling
- `src/config/`: environment-driven infrastructure config
- `uploads/`: runtime-generated files and report artifacts

## Cleanup Baseline

- All files in `src/` pass `node --check`
- Large services should be split without changing route contracts
- `uploads/` is runtime data and should not be treated as source

## Refactor Priorities

- Split oversized services into query helpers, mappers, and domain utilities
- Keep request and response shapes stable for FE compatibility
- Remove debug/manual scripts that are not part of runtime
- Add repeatable validation checks before each cleanup wave

## VNPAY

- Standard checkout now uses redirect-based VNPAY PAY with `VNPAYQR`
- IPN is the payment source of truth; FE polls payment status after return

## Docker

- Backend can now be built with the included `Dockerfile`
- For full FE + BE + DB deployment on one VPS, use the FE repo deployment stack (`docker-compose.vps.yml` + `DEPLOY_VPS.md`)
