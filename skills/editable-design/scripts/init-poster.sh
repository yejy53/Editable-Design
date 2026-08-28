#!/usr/bin/env bash
set -euo pipefail

target="${1:-$PWD}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
starter="$(cd "$script_dir/../assets/poster-starter" && pwd)"
editor_source="$(cd "$script_dir/../assets/editor" && pwd)"
replay_source="$(cd "$script_dir/../assets/replay" && pwd)"

if [[ ! -f "$editor_source/layer-editor.css" \
  || ! -f "$editor_source/layer-editor.js" ]] \
  || ! grep -q '\.hf-exploded-board' "$editor_source/layer-editor.css" \
  || ! grep -q '\.hf-resize-overlay' "$editor_source/layer-editor.css" \
  || ! grep -q 'setExploded' "$editor_source/layer-editor.js" \
  || ! grep -q 'data-hf-resize-dir' "$editor_source/layer-editor.js" \
  || ! grep -q 'downloadExploded' "$editor_source/layer-editor.js"; then
  echo "Bundled poster editor runtime is missing or incomplete." >&2
  exit 2
fi

mkdir -p "$target"
if find "$target" -mindepth 1 -maxdepth 1 \
  ! -name '.git' ! -name '.DS_Store' ! -name 'work' ! -name 'outputs' \
  -print -quit | grep -q .; then
  echo "Target is not empty: $target" >&2
  exit 2
fi

cp -R "$starter"/. "$target"/

# Put the reproducible runtime beside the generated project. Skill installation
# paths vary by host, so a project must never depend on the path it was created
# from.
mkdir -p "$target/scripts/editor-assets" "$target/scripts/replay-assets" "$target/assets" "$target/reference" "$target/out" "$target/licenses"
for tool in build-replay.mjs check-fonts.sh check-poster.sh import-asset.sh remove-chroma-key.py render-poster.sh trace.sh verify-replay.mjs wire-editor.mjs; do
  cp -p "$script_dir/$tool" "$target/scripts/$tool"
done

for editor_asset in layer-editor.css layer-editor.js; do
  cp -p "$editor_source/$editor_asset" "$target/scripts/editor-assets/$editor_asset"
done

cp -R "$replay_source"/. "$target/scripts/replay-assets"/
if [[ -f "$script_dir/../LICENSE" ]]; then
  cp -p "$script_dir/../LICENSE" "$target/licenses/editable-design-runtime-Apache-2.0.txt"
fi

# Source control is useful but not part of poster generation. Make it opt-in so
# initialization does not silently create repository state in a user's folder.
if [[ "${POSTER_INIT_GIT:-0}" == "1" && ! -d "$target/.git" ]]; then
  if command -v git >/dev/null 2>&1; then
    git -C "$target" init -b main >/dev/null
  else
    echo "git           requested but unavailable - continuing without it" >&2
  fi
fi

# Nothing to install, but the renderer must be confirmed before any layout is
# written - otherwise you find out it is missing only after the poster is done.
"$script_dir/render-poster.sh" --probe || true
echo "starter     $(cd "$target" && pwd)"
echo "tools       $(cd "$target/scripts" && pwd)"
echo "editor      bundled move/resize/edit/scan/explode runtime"
echo "replay      bundled evidence viewer"
