#!/usr/bin/env bash
# Fast, self-contained checks for the poster contract. Visual quality still
# requires reading the rendered PNG; this catches deterministic packaging and
# markup failures before Chrome starts.
set -euo pipefail

html="${1:?usage: check-poster.sh HTML}"
test -f "$html" || { echo "no such file: $html" >&2; exit 2; }

project="$(cd "$(dirname "$html")" && pwd)"
html="$project/$(basename "$html")"
config="$project/poster.json"
failures=0

fail() {
  echo "FAIL  $*" >&2
  failures=$(( failures + 1 ))
}

read_num() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" "$2" | head -1
}

test -f "$config" || fail "missing poster.json"

if [[ -f "$config" ]]; then
  width="$(read_num width "$config")"
  height="$(read_num height "$config")"
  [[ -n "$width" && -n "$height" ]] || fail "cannot read canvas width and height from poster.json"
  if [[ -n "$width" && -n "$height" ]]; then
    grep -q "data-canvas-width=\"$width\"" "$html" || fail "HTML canvas width does not match poster.json ($width)"
    grep -q "data-canvas-height=\"$height\"" "$html" || fail "HTML canvas height does not match poster.json ($height)"
  fi
fi

grep -q 'position:[[:space:]]*relative' "$html" || fail "canvas must be position: relative"
grep -q 'overflow:[[:space:]]*hidden' "$html" || fail "canvas must hide overflow"

if grep -Eq 'poster-preview|Your poster is taking shape|The first version will appear here automatically' "$html" 2>/dev/null; then
  fail "starter placeholder content remains"
fi

grep -Eiq '<script([[:space:]>])' "$html" && fail "scripts are not allowed in the shipping poster"
grep -Eiq '@media([[:space:](])' "$html" && fail "media queries are not allowed on a fixed canvas"
grep -Eiq '[0-9.]([[:space:]]*)(vw|vh|vmin|vmax)([^a-zA-Z]|$)' "$html" && fail "viewport units are not allowed for poster layout"
grep -Eiq "(src|href)[[:space:]]*=[[:space:]]*['\"](https?:)?//" "$html" && fail "external asset requests are not allowed"
grep -Eiq "src[[:space:]]*=[[:space:]]*['\"]data:" "$html" && fail "embed generated assets as project files, not data URLs"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/poster-contract.XXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT INT TERM

grep -o 'data-layer-id="[^"]*"' "$html" | sed 's/.*="//; s/"$//' | sort >"$tmp/layers" || true
duplicates="$(uniq -d "$tmp/layers")"
[[ -z "$duplicates" ]] || fail "duplicate data-layer-id values: $(printf '%s' "$duplicates" | tr '\n' ' ')"

grep -o 'src="[^"]*"' "$html" | sed 's/^src="//; s/"$//' >"$tmp/assets" || true
while IFS= read -r asset; do
  [[ -n "$asset" ]] || continue
  case "$asset" in
    /*|*://*|data:*) fail "asset path must be project-relative: $asset" ;;
    *) [[ -f "$project/$asset" ]] || fail "missing referenced asset: $asset" ;;
  esac
done <"$tmp/assets"

if [[ "$failures" -gt 0 ]]; then
  echo "$failures poster contract check(s) failed" >&2
  exit 1
fi

echo "ok    poster contract and local assets"
