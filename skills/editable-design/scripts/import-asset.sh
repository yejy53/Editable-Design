#!/usr/bin/env bash
# Copy one selected ImageGen output into the poster project without guessing the
# newest generated file or silently overwriting an approved asset.
set -euo pipefail

source_file="${1:?usage: import-asset.sh SOURCE DEST [--replace]}"
destination="${2:?usage: import-asset.sh SOURCE DEST [--replace]}"
replace="${3:-}"

test -f "$source_file" || { echo "no such generated asset: $source_file" >&2; exit 2; }
[[ "$destination" != */ ]] || { echo "destination must include a filename" >&2; exit 2; }

if [[ -e "$destination" && "$replace" != "--replace" ]]; then
  echo "destination already exists: $destination" >&2
  echo "use a versioned filename, or pass --replace only when replacement is intentional" >&2
  exit 2
fi

mkdir -p "$(dirname "$destination")"
cp -p "$source_file" "$destination"

test -s "$destination" || { echo "asset copy produced an empty file: $destination" >&2; exit 3; }
echo "asset       $(cd "$(dirname "$destination")" && pwd)/$(basename "$destination")"
