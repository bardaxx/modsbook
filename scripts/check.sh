#!/usr/bin/env bash
# Validates the marketplace and every mod, and runs each mod's tests.
set -euo pipefail
cd "$(dirname "$0")/.."

claude plugin validate .
for mod in mods/*/; do
  echo "== ${mod%/}"
  claude plugin validate "$mod"
  if compgen -G "$mod/tests/*.test.ts*" >/dev/null; then
    claude plugin test "$mod"
  fi
done
