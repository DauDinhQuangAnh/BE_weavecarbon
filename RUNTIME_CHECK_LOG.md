 # Backend Runtime Check Log

 | Command | Result | Exact Error | Likely Responsible File | Notes |
 | ------- | ------ | ----------- | ----------------------- | ----- |
 | `npm run check:syntax` | BLOCKED | `npm : File D:\hoctap\node\npm.ps1 cannot be loaded because running scripts is disabled on this system.` | PowerShell execution policy, not application source | Initial direct `npm` invocation is blocked in this shell; used `npm.cmd` for checks. |
 | `npm.cmd run check:syntax` | PASS | none | none | `node scripts/check-syntax.js` reported `Syntax OK (74 files checked)`. |
 | `npm.cmd run migrate` | PASS | none | migrations/006_weave_carbon_v2_audit_ready.sql | Migration runner applied `006_weave_carbon_v2_audit_ready.sql` and then reported database migrations up to date. This changes database state only, not tracked source files. |
 | `npm.cmd run dev` then GET `/health` | PASS | none | src/server.js, src/bootstrap/appBootstrap.js | Bounded dev probe started API on port 4100 from `.env`, `/health` returned HTTP 200 with `{"success":true,"data":{"status":"healthy",...}}`, then the backend process was stopped. |
