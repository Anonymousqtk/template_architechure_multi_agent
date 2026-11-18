#!/usr/bin/env bash
set -euo pipefail

has_script() {
  local script="$1"
  node - "$script" <<'NODE'
const fs = require('fs');
const key = process.argv[2];
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
process.exit(pkg.scripts?.[key] ? 0 : 1);
NODE
}

run_area() {
  local area="$1" task
  [[ -f "$area/package.json" && -f "$area/package-lock.json" ]] || {
    echo "ERROR: $area needs package.json and package-lock.json. Adapt this template to the real project." >&2
    exit 1
  }
  pushd "$area" > /dev/null
  npm ci --no-audit --no-fund
  # No silent skip for required checks. Configure these scripts in package.json.
  for task in lint typecheck test:coverage build; do
    if ! has_script "$task"; then
      echo "ERROR: Missing required '$task' script in $area/package.json" >&2
      exit 1
    fi
    npm run "$task"
  done
  # Only audit once (npm ci disables its implicit audit).
  npm audit --audit-level=high --omit=dev
  popd > /dev/null
}

[[ "${FRONTEND_CHANGED:-false}" == true ]] && run_area frontend
[[ "${BACKEND_CHANGED:-false}" == true ]] && run_area backend
if [[ "${DATABASE_CHANGED:-false}" == true ]]; then
  [[ -f database/check.sh ]] || { echo 'ERROR: database/check.sh is required for DB changes'; exit 1; }
  bash database/check.sh
fi
