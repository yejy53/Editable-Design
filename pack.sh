#!/usr/bin/env bash
set -euo pipefail

toolkit_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
name="editable-design-toolkit"
out="${1:-${TMPDIR:-/tmp}/${name}.tar.gz}"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage/$name/skills" "$(dirname "$out")"
for file in LICENSE THIRD_PARTY_NOTICES.md .gitignore pack.sh; do
  cp -p "$toolkit_dir/$file" "$stage/$name/$file"
done
cp -p "$toolkit_dir/TOOLKIT.md" "$stage/$name/README.md"
cp -R "$toolkit_dir/skills/editable-design" "$stage/$name/skills/"
cp -R "$toolkit_dir/skills/html-to-pptx" "$stage/$name/skills/"

find "$stage/$name" -name '.DS_Store' -delete
find "$stage/$name" -name '._*' -delete
find "$stage/$name" -type d \( -name node_modules -o -name __pycache__ -o -name .venv \) -prune -exec rm -rf {} +
find "$stage/$name" -type f \( -name '*.tar.gz' -o -name '*.zip' \) -delete

tar -czf "$out" -C "$stage" "$name"
printf '%s\n' "$out"
