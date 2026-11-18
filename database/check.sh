#!/usr/bin/env bash
set -euo pipefail
# Fail closed until an actual migration verification command exists.
# Do not treat a grep/static placeholder as a successful database migration test.
[[ -d database ]] || { echo 'database/ is missing' >&2; exit 1; }
if [[ -x database/test-migrations.sh ]]; then
  bash database/test-migrations.sh
else
  echo 'ERROR: database changes require executable database/test-migrations.sh to validate real migrations on a disposable DB.' >&2
  exit 1
fi
