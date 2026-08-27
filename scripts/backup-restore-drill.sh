#!/usr/bin/env bash

set -euo pipefail

SOURCE_DATABASE="${DB_NAME:-weavecarbon}"
TARGET_DATABASE="${SOURCE_DATABASE}_wp_s1_restore_${GITHUB_RUN_ID:-$$}"
TARGET_DATABASE="$(printf '%s' "${TARGET_DATABASE}" | tr '[:upper:]-' '[:lower:]_' | cut -c1-63)"
ARTIFACT_DIR="${PWD}/artifacts/wp-s1"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/weavecarbon-wp-s1.XXXXXX")"
TARGET_CREATED=0
DRILL_STATUS="FAIL"

export PGHOST="${DB_HOST:-localhost}"
export PGPORT="${DB_PORT:-5432}"
export PGUSER="${DB_USER:-postgres}"
export PGPASSWORD="${DB_PASSWORD:-postgres}"

mkdir -p "${ARTIFACT_DIR}"

cleanup() {
  local exit_code=$?

  if [[ "${TARGET_CREATED}" -eq 1 ]]; then
    dropdb --if-exists "${TARGET_DATABASE}" >/dev/null 2>&1 || true
  fi
  case "${WORK_DIR}" in
    "${TMPDIR:-/tmp}"/weavecarbon-wp-s1.*) rm -rf -- "${WORK_DIR}" ;;
    *) echo "Refusing to remove unexpected drill path: ${WORK_DIR}" >&2 ;;
  esac
  if [[ "${DRILL_STATUS}" != "PASS" ]]; then
    printf 'status=FAIL\ncompleted_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      > "${ARTIFACT_DIR}/restore-report.txt"
  fi
  exit "${exit_code}"
}
trap cleanup EXIT

write_table_counts() {
  local database="$1"
  local output_file="$2"

  psql -X -q -v ON_ERROR_STOP=1 -d "${database}" > "${output_file}" <<'SQL'
CREATE TEMP TABLE drill_table_counts (
  table_name text PRIMARY KEY,
  row_count bigint NOT NULL
);
DO $$
DECLARE
  item record;
  item_count bigint;
BEGIN
  FOR item IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', item.schemaname, item.tablename)
      INTO item_count;
    INSERT INTO drill_table_counts(table_name, row_count)
    VALUES (format('%I.%I', item.schemaname, item.tablename), item_count);
  END LOOP;
END
$$;
COPY (
  SELECT table_name, row_count
  FROM drill_table_counts
  ORDER BY table_name
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\t', HEADER true);
SQL
}

for command_name in psql pg_dump pg_restore createdb dropdb sha256sum tar diff; do
  command -v "${command_name}" >/dev/null 2>&1 || {
    echo "Required command is missing: ${command_name}" >&2
    exit 1
  }
done

[[ "${TARGET_DATABASE}" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || {
  echo "Unsafe target database name: ${TARGET_DATABASE}" >&2
  exit 1
}
[[ "${TARGET_DATABASE}" != "${SOURCE_DATABASE}" ]] || {
  echo "Restore target must differ from source database" >&2
  exit 1
}

echo "Creating synthetic database and evidence sentinels..."
psql -X -q -v ON_ERROR_STOP=1 -d "${SOURCE_DATABASE}" <<'SQL'
CREATE SCHEMA IF NOT EXISTS wp_s1_fixture;
DROP TABLE IF EXISTS wp_s1_fixture.restore_sentinel;
CREATE TABLE wp_s1_fixture.restore_sentinel (
  id integer PRIMARY KEY,
  marker text NOT NULL UNIQUE,
  amount numeric(12, 3) NOT NULL,
  metadata jsonb NOT NULL
);
INSERT INTO wp_s1_fixture.restore_sentinel(id, marker, amount, metadata) VALUES
  (1, 'WP-S1-ALPHA', 125.750, '{"kind":"calculation-history","version":1}'),
  (2, 'WP-S1-BETA', 0.125, '{"kind":"tenant-evidence","version":1}');
SQL

mkdir -p "${WORK_DIR}/evidence-source/nested folder" "${WORK_DIR}/evidence-restored"
printf '%s\n' 'synthetic invoice evidence: WP-S1-ALPHA' > "${WORK_DIR}/evidence-source/invoice-alpha.txt"
printf '%s\n' '{"document":"WP-S1-BETA","checksum_test":true}' > "${WORK_DIR}/evidence-source/nested folder/metadata.json"

write_table_counts "${SOURCE_DATABASE}" "${WORK_DIR}/database-counts-source.tsv"
pg_dump --format=custom --no-owner --no-privileges -d "${SOURCE_DATABASE}" \
  > "${WORK_DIR}/database.dump"
pg_restore --list "${WORK_DIR}/database.dump" > "${WORK_DIR}/database-catalog.txt"
tar -C "${WORK_DIR}/evidence-source" -czf "${WORK_DIR}/uploads.tar.gz" .
tar -tzf "${WORK_DIR}/uploads.tar.gz" > "${WORK_DIR}/uploads-members.txt"

(
  cd "${WORK_DIR}"
  sha256sum database.dump database-catalog.txt database-counts-source.tsv \
    uploads.tar.gz uploads-members.txt > SHA256SUMS
  sha256sum evidence-source/invoice-alpha.txt \
    'evidence-source/nested folder/metadata.json' > evidence-source-checksums.txt
)
(
  cd "${WORK_DIR}"
  sha256sum --check SHA256SUMS
)

echo "Restoring into isolated database ${TARGET_DATABASE}..."
createdb --template=template0 "${TARGET_DATABASE}"
TARGET_CREATED=1
pg_restore --exit-on-error --no-owner --no-privileges -d "${TARGET_DATABASE}" \
  "${WORK_DIR}/database.dump"
write_table_counts "${TARGET_DATABASE}" "${WORK_DIR}/database-counts-restored.tsv"
diff -u "${WORK_DIR}/database-counts-source.tsv" "${WORK_DIR}/database-counts-restored.tsv"

EXPECTED_SENTINELS=$'1\tWP-S1-ALPHA\t125.750\tcalculation-history\n2\tWP-S1-BETA\t0.125\ttenant-evidence'
ACTUAL_SENTINELS="$(psql -X -qAt -F $'\t' -d "${TARGET_DATABASE}" -c \
  "SELECT id, marker, amount::text, metadata->>'kind' FROM wp_s1_fixture.restore_sentinel ORDER BY id")"
[[ "${ACTUAL_SENTINELS}" == "${EXPECTED_SENTINELS}" ]] || {
  echo "Representative database records do not match" >&2
  exit 1
}

if tar -tzf "${WORK_DIR}/uploads.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Evidence archive contains an unsafe path" >&2
  exit 1
fi
tar -xzf "${WORK_DIR}/uploads.tar.gz" -C "${WORK_DIR}/evidence-restored"
(
  cd "${WORK_DIR}/evidence-restored"
  sha256sum invoice-alpha.txt 'nested folder/metadata.json'
) > "${WORK_DIR}/evidence-restored-checksums.txt"
sed 's#evidence-source/##' "${WORK_DIR}/evidence-source-checksums.txt" \
  > "${WORK_DIR}/evidence-source-normalized.txt"
diff -u "${WORK_DIR}/evidence-source-normalized.txt" "${WORK_DIR}/evidence-restored-checksums.txt"

cp "${WORK_DIR}/database-catalog.txt" "${ARTIFACT_DIR}/"
cp "${WORK_DIR}/database-counts-source.tsv" "${ARTIFACT_DIR}/"
cp "${WORK_DIR}/database-counts-restored.tsv" "${ARTIFACT_DIR}/"
cp "${WORK_DIR}/evidence-source-normalized.txt" "${ARTIFACT_DIR}/evidence-checksums.txt"
cp "${WORK_DIR}/SHA256SUMS" "${ARTIFACT_DIR}/bundle-checksums.txt"

cat > "${ARTIFACT_DIR}/restore-report.txt" <<EOF
status=PASS
source_database=${SOURCE_DATABASE}
isolated_database=${TARGET_DATABASE}
database_validation=dump_catalog,exact_table_counts,representative_records
evidence_validation=archive_checksum,archive_paths,representative_file_checksums
production_data_touched=false
completed_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

DRILL_STATUS="PASS"
echo "WP-S1 isolated backup/restore drill PASS"
