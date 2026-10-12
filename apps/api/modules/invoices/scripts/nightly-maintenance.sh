#!/bin/bash
# Nightly maintenance: clean local files >7 days, Box retention >6 months, Postgres backup
set -e
source /etc/toolbox/paths.env

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "${PIPELINE_DIR}/../.." && pwd)"

# Load repository .env if available while preserving explicitly exported backup settings.
existing_pghost="${PGHOST+x}"
existing_pgport="${PGPORT+x}"
existing_pgdatabase="${PGDATABASE+x}"
existing_pguser="${PGUSER+x}"
existing_pgpassword="${PGPASSWORD+x}"
preserved_pghost="${PGHOST:-}"
preserved_pgport="${PGPORT:-}"
preserved_pgdatabase="${PGDATABASE:-}"
preserved_pguser="${PGUSER:-}"
preserved_pgpassword="${PGPASSWORD:-}"

if [ -f "${REPO_ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${REPO_ROOT}/.env"
  set +a
fi

[ -z "$existing_pghost" ] || PGHOST="$preserved_pghost"
[ -z "$existing_pgport" ] || PGPORT="$preserved_pgport"
[ -z "$existing_pgdatabase" ] || PGDATABASE="$preserved_pgdatabase"
[ -z "$existing_pguser" ] || PGUSER="$preserved_pguser"
[ -z "$existing_pgpassword" ] || PGPASSWORD="$preserved_pgpassword"

echo "=== Invoice Pipeline Nightly Maintenance ==="
echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# 1. Upload any unarchived files + clean local files older than 7 days
echo ""
echo "--- Box Archive + Local Cleanup ---"
cd "$PIPELINE_DIR"
node scripts/box-archive.js cleanup 2>&1

# 2. Box retention: delete files older than 6 months
echo ""
echo "--- Box Retention (6 months) ---"
node scripts/box-archive.js retention 2>&1

# 3. Postgres backup to Box
echo ""
echo "--- Postgres Backup ---"
BACKUP_FILE="/tmp/toolbox-$(date -u '+%Y%m%d').sql.gz"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-toolbox}"
PGUSER="${PGUSER:-toolbox}"
if [ -z "${PGPASSWORD:-}" ]; then
  printf 'Missing required Postgres backup credential environment variable: PGPASSWORD\n' >&2
  exit 1
fi
export PGPASSWORD
pg_dump -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" "$PGDATABASE" | gzip > "$BACKUP_FILE"
node "$BOX_SCRIPT" upload "$BACKUP_FILE" "${BOX_BACKUP_FOLDER_ID:?set BOX_BACKUP_FOLDER_ID}" 2>&1
rm -f "$BACKUP_FILE"
echo "✓ Postgres backup uploaded to Box"

echo ""
echo "=== Maintenance complete ==="
