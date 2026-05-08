#!/bin/sh
set -eu

backup_dir="${BACKUP_DIR:-/backups}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
target="${CONVEX_BACKUP_TARGET:-prod}"
include_storage="${BACKUP_INCLUDE_FILE_STORAGE:-true}"
convex_env_file="${CONVEX_ENV_FILE:-}"

mkdir -p "${backup_dir}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_zip="${backup_dir}/convex-${target}-${timestamp}.zip"

set -- export --path "${output_zip}"

case "${include_storage}" in
  true|TRUE|1|yes|YES)
    set -- "$@" --include-file-storage
    ;;
esac

case "${target}" in
  prod)
    set -- "$@" --prod
    ;;
  dev)
    ;;
  *)
    set -- "$@" --deployment-name "${target}"
    ;;
esac

if [ -n "${convex_env_file}" ]; then
  set -- "$@" --env-file "${convex_env_file}"
fi

echo "[convex-backup] starting backup at ${timestamp}"
echo "[convex-backup] running: convex $*"
convex "$@"
echo "[convex-backup] backup completed: ${output_zip}"

echo "[convex-backup] pruning backups older than ${retention_days} day(s)"
find "${backup_dir}" -type f -name 'convex-*.zip' -mtime +"${retention_days}" -print -delete || true
