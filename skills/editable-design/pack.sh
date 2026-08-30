#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
parent_dir="$(cd "$skill_dir/.." && pwd)"
out="${1:-${TMPDIR:-/tmp}/editable-design-skill.tar.gz}"

mkdir -p "$(dirname "$out")"
tar \
  --exclude='editable-design/scripts/node_modules' \
  --exclude='editable-design/font-kit/node_modules' \
  --exclude='editable-design/._*' \
  --exclude='editable-design/*/._*' \
  --exclude='editable-design/*/*/._*' \
  --exclude='editable-design/.DS_Store' \
  -czf "$out" \
  -C "$parent_dir" \
  editable-design

echo "$out"
