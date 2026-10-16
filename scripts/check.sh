#!/usr/bin/env bash
# Validates the marketplace and every mod, runs each mod's tests, and checks
# that a mod changed since BASE (default: the branch's upstream) raised its version.
set -euo pipefail
cd "$(dirname "$0")/.."

base="${BASE:-$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)}"
failed=0

# A user receives a change only when the version goes up; README and tests never reach them.
check_version() {
  local mod="$1" manifest="$1/.claude-plugin/plugin.json" was now
  [ -n "$base" ] || return 0
  git cat-file -e "$base:$manifest" 2>/dev/null || return 0 # new since base
  now="$(jq -r '.version // empty' "$manifest")"
  [ -n "$now" ] || return 0 # no version: the commit SHA is the version
  if git diff --quiet "$base" -- "$mod" ":(exclude)$mod/README.md" ":(exclude)$mod/tests"; then
    return 0
  fi
  was="$(git show "$base:$manifest" | jq -r '.version // empty')"
  if [ "$was" = "$now" ] || [ "$(printf '%s\n%s\n' "$was" "$now" | sort -V | tail -1)" != "$now" ]; then
    echo "✘ $mod changed since $base but its version is $now (was $was): raise it in $manifest"
    failed=1
  else
    echo "✔ version $was → $now"
  fi
}

# The files the two Spine mods share ship from each mod's own folder: one copy each, kept identical.
for shared in hooks/spine.tsx hooks/reply.ts; do
  if ! cmp -s "mods/grill-map/$shared" "mods/wayfinder-map/$shared"; then
    echo "✘ $shared differs between mods/grill-map and mods/wayfinder-map: keep the two copies identical"
    failed=1
  fi
done
# The terminal bar every pane opens with: one copy in each mod, kept identical.
for mod in mods/*/; do
  if ! cmp -s "mods/grill-map/hooks/header.tsx" "${mod}hooks/header.tsx"; then
    echo "✘ hooks/header.tsx differs between mods/grill-map and ${mod%/}: keep every copy identical"
    failed=1
  fi
done
# A contract imports nothing, so both declare the Spine's steps, from the top down to `export type Step`.
steps() { sed '/^export type Step = /q' "mods/$1/types/index.d.ts"; }
if [ "$(steps grill-map)" != "$(steps wayfinder-map)" ]; then
  echo "✘ the Spine's step types differ between the contracts of grill-map and wayfinder-map: keep them identical"
  failed=1
fi

claude plugin validate .
for mod in mods/*/; do
  mod="${mod%/}"
  echo "== $mod"
  claude plugin validate "$mod"
  check_version "$mod"
  if compgen -G "$mod/tests/*.test.ts*" >/dev/null; then
    claude plugin test "$mod"
  fi
done

exit "$failed"
