#!/usr/bin/env bash
# Render the poster with the host browser, then read the real pixel dimensions
# back and compare them with the declared canvas.
#
# The read-back is not redundant: a browser silently produces a different size
# when the window and the content disagree, and the resulting image looks
# perfectly normal. Trust the artefact, not the renderer's exit code.
set -euo pipefail

find_browser() {
  local candidates=(
    "${EDITABLE_DESIGN_BROWSER:-}"
    "${PUPPETEER_EXECUTABLE_PATH:-}"
    "${POSTER_BROWSER:-}"
    "${CHROME_PATH:-}"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" && -x "$candidate" ]] && { printf '%s' "$candidate"; return 0; }
  done
  for candidate in chromium google-chrome chrome; do
    local found
    found="$(command -v "$candidate" 2>/dev/null || true)"
    [[ -n "$found" ]] && { printf '%s' "$found"; return 0; }
  done
  candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  )
  for candidate in "${candidates[@]}"; do
    [[ -x "$candidate" ]] && { printf '%s' "$candidate"; return 0; }
  done
  return 1
}

if [[ "${1:-}" == "--probe" ]]; then
  if browser="$(find_browser)"; then
    echo "renderer    $browser"
    exit 0
  fi
  echo "renderer    no Chromium-based browser found - rendering unavailable" >&2
  echo "            install Google Chrome, or set EDITABLE_DESIGN_BROWSER=<executable>" >&2
  exit 1
fi

html="${1:?usage: render-poster.sh HTML [OUT_PNG] [--scale N | --dpi N]}"
shift
if [[ $# -gt 0 && "$1" != --* ]]; then
  out="$1"
  shift
else
  out="$(cd "$(dirname "$html")" 2>/dev/null && pwd)/out/poster.png"
fi

scale=""
dpi=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scale) scale="$2"; shift 2 ;;
    --dpi) dpi="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

test -f "$html" || { echo "no such file: $html" >&2; exit 2; }
project="$(cd "$(dirname "$html")" && pwd)"
config="$project/poster.json"

# poster.json's shape is fixed by the starter, so sed is enough and this script
# stays free of a JSON dependency.
read_num() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" "$2" | head -1
}

if [[ -f "$config" ]]; then
  width="$(read_num width "$config")"
  height="$(read_num height "$config")"
  [[ -z "$scale" ]] && scale="$(read_num scale "$config")"
  [[ -z "$dpi" ]] && dpi="$(read_num dpi "$config")"
fi

[[ -n "${width:-}" && -n "${height:-}" ]] || {
  echo "cannot read canvas.width / canvas.height from poster.json" >&2
  exit 2
}

# Print path converts at 96 px/inch, so a given dpi decides the scale factor.
if [[ -n "$dpi" && "$dpi" != "0" ]]; then
  scale="$(awk -v d="$dpi" 'BEGIN { printf "%.4g", d / 96 }')"
fi
[[ -n "$scale" && "$scale" != "0" ]] || scale=2

browser="$(find_browser)" || {
  echo "no Chromium-based browser found. Set EDITABLE_DESIGN_BROWSER=<executable>" >&2
  exit 1
}

mkdir -p "$(dirname "$out")"
rm -f "$out"

# Never attach to the user's running browser, and never share a profile between
# poster renders. A shared profile makes concurrent jobs fight over its lock and
# lets a stale Chrome child poison the next run.
profile="$(mktemp -d "${TMPDIR:-/tmp}/poster-render-profile.XXXXXX")"
renderer_pid=""

profile_pids() {
  ps -axo pid=,command= \
    | awk -v marker="--user-data-dir=$profile" \
        'index($0, marker) && index($0, "awk -v marker=") == 0 { print $1 }'
}

stop_renderer() {
  local pids=""
  local _

  pids="$(profile_pids)"
  [[ -n "$pids" ]] && kill $pids 2>/dev/null || true

  for _ in $(seq 1 20); do
    pids="$(profile_pids)"
    [[ -z "$pids" ]] && break
    sleep 0.1
  done

  pids="$(profile_pids)"
  [[ -n "$pids" ]] && kill -KILL $pids 2>/dev/null || true

  if [[ -n "$renderer_pid" ]]; then
    wait "$renderer_pid" 2>/dev/null || true
  fi
}

cleanup() {
  stop_renderer
  if [[ -n "$profile" && -d "$profile" && "$profile" == *"/poster-render-profile."* ]]; then
    rm -rf -- "$profile"
  fi
}

trap cleanup EXIT INT TERM

"$browser" \
  --headless \
  --disable-gpu \
  --hide-scrollbars \
  --no-first-run \
  --no-default-browser-check \
  --disable-extensions \
  --disable-background-networking \
  --disable-sync \
  --disable-default-apps \
  --mute-audio \
  --user-data-dir="$profile" \
  --force-device-scale-factor="$scale" \
  --window-size="${width},${height}" \
  --screenshot="$out" \
  "file://$(cd "$(dirname "$html")" && pwd)/$(basename "$html")" \
  >/dev/null 2>&1 &
renderer_pid=$!

# headless occasionally does not exit on its own, so wait for the artefact
# rather than for the process.
for _ in $(seq 1 120); do
  kill -0 "$renderer_pid" 2>/dev/null || break
  [[ -s "$out" ]] && { sleep 0.4; break; }
  sleep 0.5
done
stop_renderer
renderer_pid=""

test -s "$out" || { echo "render produced no $out" >&2; exit 3; }

# A PNG's IHDR carries width and height at bytes 16..23, big-endian. Reading
# them this way needs neither sips nor Pillow. macOS od emits a trailing blank
# line, so split on words instead of processing line by line.
png_dimensions() {
  local file="$1"
  # shellcheck disable=SC2046
  set -- $(od -An -tu1 -j16 -N8 "$file")
  printf '%d %d' \
    "$(( $1 * 16777216 + $2 * 65536 + $3 * 256 + $4 ))" \
    "$(( $5 * 16777216 + $6 * 65536 + $7 * 256 + $8 ))"
}

read -r actual_w actual_h <<<"$(png_dimensions "$out")"
expect_w="$(awk -v w="$width" -v s="$scale" 'BEGIN { printf "%d", w * s + 0.5 }')"
expect_h="$(awk -v h="$height" -v s="$scale" 'BEGIN { printf "%d", h * s + 0.5 }')"

if [[ "$actual_w" != "$expect_w" || "$actual_h" != "$expect_h" ]]; then
  echo "render does not match the declared canvas: got ${actual_w}x${actual_h}, expected ${expect_w}x${expect_h}" >&2
  echo "canvas ${width}x${height} @${scale}x. Check that the root element's width/height equal its data-canvas-* values." >&2
  exit 3
fi

echo "$out  ${actual_w}x${actual_h}  (canvas ${width}x${height} @${scale}x)"
echo
echo "Next: read this image and say every piece of text on it out loud, line by line."
echo "Confirm nothing is clipped, covered, or carried in from the generated artwork."
echo "A DOM check cannot see any of that."
