# Handoff: verify the technical-debt refactor before trusting it

This file exists so a fresh Claude Code session (possibly on a different machine) has
the context to finish what the previous session could not: **running the test/build
suite it never got to run.**

## What happened

A full refactor roadmap (test infra, logging, env config, splitting "god" services/files,
ESLint, API docs) was executed across this repo and the sibling FE repo (`WeaveCarbon`,
usually a sibling directory next to this one). All work was done carefully — pure-function
extractions verified via `node --check`, smoke-`require`, and manual cross-check scripts
that compared old-vs-new implementation output byte-for-byte before deleting old code.

**But for a large final stretch of the session, the machine's C: drive had 0 bytes free.**
This made `npm test`, `npm run build`, and `npm run lint` all fail with ENOSPC. The later
work (splitting `authService.js`, `subscriptionService.js`, adding ESLint, adding Swagger
docs) was verified only with `node --check` + hand-written smoke scripts — **never with the
real Jest suite.** That's why you're reading this: the code was pushed without that final
verification pass.

## Your task

1. `npm install` (confirm it completes cleanly — no disk pressure on a fresh machine).
2. `npm run lint` — expect **0 errors**, ~47 pre-existing `no-unused-vars` warnings. Warnings
   are known baseline, not a regression signal. If you see NEW error-level findings, investigate.
3. `npm run check:syntax` — should be a no-op green check (everything already passed this).
4. `npm test` — this is the important one. It has never been run since the last big wave of
   extractions. Pay closest attention to these suites, since they back security/payment-critical
   code that was split this session:
   - `tests/services/subscriptionService/vnpay.test.js` — VNPay HMAC signing/verification.
     If this fails, **do not paper over it** — this is payment-integrity code.
   - `tests/services/subscriptionService/planRules.test.js`, `helpers.test.js`
   - `tests/services/authService/tokens.test.js` — JWT/bcrypt logic.
   - `tests/services/reportsService/helpers.test.js` (this one was only syntax-checked,
     never smoke-tested at all — highest residual risk of the batch)
   - `tests/routes/auth/helpers.test.js`
   - Full list of test files as of this handoff (21 files) — if `npm test` reports a
     different count, something is missing or extra:
     `tests/middleware/{subscriptionAccess,auth}.test.js`, `tests/config/jwt.test.js`,
     `tests/services/productsService/{mappers,shared,bulkImportValidation,carbonScoring,
     shipmentSync,payloadExtraction,bulkImportExecution}.test.js`,
     `tests/services/exportMarketsService/{marketRequirements,seeding,normalizers}.test.js`,
     `tests/services/logisticsService/mappers.test.js`,
     `tests/services/b2cService/helpers.test.js`,
     `tests/services/chatService/helpers.test.js`,
     `tests/services/subscriptionService/{planRules,helpers,vnpay}.test.js`,
     `tests/services/authService/tokens.test.js`,
     `tests/services/reportsService/helpers.test.js`.
5. `npm run dev`, then hit `GET /health` and `GET /api-docs` (Swagger UI) manually to confirm
   the server actually boots — it was only ever `require()`d in-process for a smoke check,
   never actually started and hit over HTTP this session.
6. If everything above is green: the refactor is done and verified. Report back and this
   handoff file can be deleted (it's a one-time task note, not a permanent doc).
7. If anything fails: fix it using the same discipline the rest of the session used —
   don't guess-patch, find the root cause, and if you change behavior anywhere, say so
   explicitly rather than silently "fixing" a test to match a bug.

## Structural context you'll want

- `src/services/authService.js`, `subscriptionService.js`, `reportsService.js` are now thin
  classes whose pure logic was extracted into sibling folders
  (`authService/tokens.js`, `subscriptionService/{planRules,helpers,vnpay}.js`,
  `reportsService/helpers.js`). The class methods are one-line delegators to those modules —
  this was deliberate, so both internal `this.x()` calls and external `authService.x()` calls
  keep working with zero signature changes.
- `eslint.config.js` (flat config) and `npm run lint` are new this session. CI now runs
  `Lint` right after `Syntax check` in `.github/workflows/backend-ci.yml`.
- `src/config/swagger.js` + `/api-docs` (swagger-ui-express) are new. Only `src/routes/auth.js`
  is fully annotated with `@openapi` JSDoc blocks so far — extending other route files to the
  same pattern is legitimate follow-up work, not a bug.
- `swagger-jsdoc`/`swagger-ui-express` are real `dependencies` (not `devDependencies`) on
  purpose — `server.js` requires them unconditionally at module load even though the
  `/api-docs` mount itself is gated by `NODE_ENV`/`ENABLE_API_DOCS`. Don't move them back to
  devDependencies without also making the require lazy, or production installs
  (`npm ci --omit=dev`) will crash on boot.
- If you ever see `.npmrc` in this repo pointing `cache=` at some `D:\npm-cache-temp`-style
  path: that was a disk-space workaround for the machine this was written on. It's gitignored
  and irrelevant on a machine with a normal amount of free disk space — delete it if present
  and it causes confusion.
