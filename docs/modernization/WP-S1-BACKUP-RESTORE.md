# WP-S1 PostgreSQL and Evidence Safety Gate

- Date: 2026-08-27
- Repository: backend API
- Production data accessed: **no**
- Production backup or restore executed: **no**

## Implementation

The backend now closes the gap between evidence metadata and evidence bytes. `POST /api/evidence/upload` atomically stores the original file under `UPLOADS_ROOT/evidence/<company>/<year>/`, then writes `storage_provider=local`, the relative storage key, size, and SHA-256 checksum to PostgreSQL. If the database insert fails, the new file is removed. Deleting an evidence row performs best-effort cleanup of its guarded local path.

The deployment backup therefore covers both halves of a recoverable evidence record:

- PostgreSQL row and checksum;
- original bytes in the `be_uploads` volume.

Historical records marked `storage_provider=memory` remain a known limitation because their original bytes were never persisted. The deployment bundle also captures the quiesced `rag_data` volume so the existing derived index is not silently discarded.

## Automated isolated restore drill

`scripts/backup-restore-drill.sh` runs after the real base schema and all migrations are loaded in the backend integration job. It uses only the disposable PostgreSQL service and synthetic files supplied by GitHub Actions.

The drill:

1. creates two representative records in a dedicated `wp_s1_fixture` schema;
2. creates nested synthetic evidence files;
3. captures exact counts for every application table;
4. creates and validates a custom-format `pg_dump` and evidence archive;
5. restores into a newly named database created from `template0`;
6. compares every table count;
7. compares the exact representative record values;
8. rejects unsafe archive paths, extracts to a temporary directory, and compares file hashes;
9. removes only the isolated database and temporary drill directory;
10. uploads non-sensitive validation evidence for 14 days.

The uploaded artifact contains catalogs, source/restored counts, synthetic evidence checksums, bundle checksums, and `restore-report.txt`. The binary dump and synthetic file contents are not uploaded.

## Local verification

Run with the portable Node installation:

```powershell
$env:Path = 'D:\hoctap\node;' + $env:Path
npm run check:syntax
npm run lint
npm test -- --runInBand
```

Shell scripts can be parsed locally with Git Bash. The complete database restore must run in GitHub Actions or another environment that provides PostgreSQL client tools and an isolated PostgreSQL 16 instance.

## Acceptance evidence

- Local syntax: PASS, 107 JavaScript files checked.
- Local lint: PASS with 38 pre-existing warnings and zero errors.
- Local unit tests: PASS, 24 suites and 266 tests.
- Evidence storage tests: atomic write, guarded deletion, traversal rejection, and extension normalization pass.
- Isolated PostgreSQL/evidence restore: pending the first CI run for this change.

WP-S1 remains **PENDING** until that CI restore artifact reports `status=PASS`. No migration covered by this safety gate may start while it is pending or failed.
