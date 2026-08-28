#!/usr/bin/env bash
# Verify that every font family the poster asks for actually resolves.
#
# A missing family raises no error anywhere: the browser silently falls back to
# a default face, the render succeeds, the pixel dimensions check out, and the
# poster ships with the wrong typography. Nothing else in this plugin can catch
# that, which is why it gets its own command.
#
# Detection compares a full metric signature against a sentinel family that
# cannot exist. Width alone is not enough — many CJK faces share an advance
# width — so the signature also covers the actual bounding box at two sizes,
# measured for a Latin sample and a CJK sample separately.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
html=""
requested=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --family)
      [[ $# -ge 2 ]] || { echo "--family requires a font family name" >&2; exit 2; }
      requested="${requested}${2}"$'\n'
      shift 2
      ;;
    --help|-h)
      echo "usage: check-fonts.sh HTML"
      echo "       check-fonts.sh --family FAMILY [--family FAMILY...]"
      exit 0
      ;;
    --*) echo "unknown argument: $1" >&2; exit 2 ;;
    *)
      [[ -z "$html" ]] || { echo "only one HTML file may be checked" >&2; exit 2; }
      html="$1"
      shift
      ;;
  esac
done

if [[ -z "$requested" ]]; then
  [[ -n "$html" ]] || { echo "usage: check-fonts.sh HTML or --family FAMILY" >&2; exit 2; }
  test -f "$html" || { echo "no such file: $html" >&2; exit 2; }
fi

# Collect every named family out of font-family declarations and --font-* custom
# properties, dropping generic keywords and var() references.
if [[ -n "$requested" ]]; then
  families="$(printf '%s' "$requested" | sed '/^[[:space:]]*$/d' | sort -u)"
else
  families=$(
    grep -o -E '(font-family|--font-[a-zA-Z-]+)[[:space:]]*:[^;}]*' "$html" \
      | sed 's/^[^:]*:[[:space:]]*//' \
      | tr ',' '\n' \
      | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
            -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//" \
      | grep -v -E '^(serif|sans-serif|monospace|cursive|fantasy|system-ui|math|emoji|fangsong|ui-[a-z-]+|inherit|initial|unset|revert)$' \
      | grep -v -E '^(var\(|$)' \
      | sort -u
  )
fi

[[ -n "$families" ]] || { echo "no named font families found in $html"; exit 0; }

browser="$("$here/render-poster.sh" --probe | awk '{ $1 = ""; sub(/^ +/, ""); print }')"
[[ -n "$browser" && -x "$browser" ]] || {
  echo "no Chromium-based browser found, font check unavailable. Set EDITABLE_DESIGN_BROWSER=<executable>" >&2
  exit 1
}

families_json=$(
  printf '%s\n' "$families" \
    | sed 's/\\/\\\\/g; s/"/\\"/g' \
    | awk '{ printf "%s\"%s\"", (NR > 1 ? "," : ""), $0 }'
)

probe="$(mktemp -d "${TMPDIR:-/tmp}/poster-font-probe.XXXXXX")"
profile="$(mktemp -d "${TMPDIR:-/tmp}/poster-font-profile.XXXXXX")"
probe_pid=""

profile_pids() {
  ps -axo pid=,command= \
    | awk -v marker="--user-data-dir=$profile" \
        'index($0, marker) && index($0, "awk -v marker=") == 0 { print $1 }'
}

stop_browser() {
  local pids=""
  local _
  pids="$(profile_pids)"
  [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
  for _ in $(seq 1 10); do
    pids="$(profile_pids)"
    [[ -z "$pids" ]] && break
    sleep 0.1
  done
  pids="$(profile_pids)"
  [[ -n "$pids" ]] && kill -KILL $pids 2>/dev/null || true
  [[ -n "$probe_pid" ]] && wait "$probe_pid" 2>/dev/null || true
}

cleanup() {
  stop_browser
  [[ "$probe" == *"/poster-font-probe."* ]] && rm -rf -- "$probe"
  [[ "$profile" == *"/poster-font-profile."* ]] && rm -rf -- "$profile"
}
trap cleanup EXIT INT TERM

cat >"$probe/probe.html" <<PROBE
<!doctype html><html><head><meta charset="utf-8"></head><body><script>
const FAMILIES = [${families_json}];
// Three generic bases rather than one nonexistent sentinel. A single sentinel
// cannot see a family that happens to BE the platform default for that script
// — PingFang SC is macOS's default CJK sans, so stacking it over a sentinel
// produces byte-identical metrics and reads as missing. Comparing against
// serif, sans-serif and monospace fixes that: a real family overrides at least
// one of them.
const BASES = ['serif', 'sans-serif', 'monospace'];
const SAMPLES = { latin: 'AWmgQ019jil', cjk: '晨雾高山茶永' };

function signature(text, stack) {
  const ctx = document.createElement('canvas').getContext('2d');
  const parts = [];
  for (const size of [48, 73]) {
    ctx.font = size + 'px ' + stack;
    const m = ctx.measureText(text);
    parts.push(
      m.width.toFixed(3),
      (m.actualBoundingBoxAscent || 0).toFixed(3),
      (m.actualBoundingBoxDescent || 0).toFixed(3),
      (m.actualBoundingBoxLeft || 0).toFixed(3),
      (m.actualBoundingBoxRight || 0).toFixed(3)
    );
  }
  return parts.join('|');
}

const lines = FAMILIES.map((family) => {
  const quoted = JSON.stringify(family);
  const covers = {};
  for (const [name, text] of Object.entries(SAMPLES)) {
    covers[name] = BASES.some(
      (base) => signature(text, quoted + ', ' + base) !== signature(text, base)
    );
  }
  const verdict = covers.latin || covers.cjk
    ? (covers.cjk ? 'ok\tcjk + latin' : 'ok\tlatin only')
    : 'MISSING\t-';
  return 'FONTPROBE\t' + family + '\t' + verdict;
});

// Leading newline matters: --dump-dom emits "<body>" immediately before the
// first line, so without it the first family never matches a line-anchored grep.
document.body.textContent = '\n' + lines.join('\n') + '\n';
</script></body></html>
PROBE

"$browser" \
  --headless --disable-gpu --no-first-run --no-default-browser-check \
  --disable-extensions --disable-background-networking --disable-sync \
  --disable-default-apps --mute-audio \
  --user-data-dir="$profile" \
  --dump-dom "file://$probe/probe.html" \
  >"$probe/dom.html" 2>/dev/null &
probe_pid=$!

# --dump-dom writes to stdout and Chrome buffers it until exit, so polling the
# file for content never succeeds early. Wait for the process itself instead.
for _ in $(seq 1 20); do
  kill -0 "$probe_pid" 2>/dev/null || break
  sleep 0.25
done
if kill -0 "$probe_pid" 2>/dev/null; then
  stop_browser
else
  wait "$probe_pid" 2>/dev/null || true
fi
probe_pid=""

grep -q 'FONTPROBE' "$probe/dom.html" 2>/dev/null || {
  echo "the font probe returned nothing - the browser probably failed to start" >&2
  exit 3
}

missing=0
while IFS=$'\t' read -r _ family verdict coverage; do
  [[ -n "$family" ]] || continue
  if [[ "$verdict" == "MISSING" ]]; then
    printf 'FAIL  %-28s not installed - the browser will silently fall back\n' "$family"
    missing=$(( missing + 1 ))
  else
    printf 'ok    %-28s %s\n' "$family" "$coverage"
  fi
done < <(grep '^FONTPROBE' "$probe/dom.html" | sed 's/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g')

if [[ "$missing" -gt 0 ]]; then
  echo
  echo "Replace these $missing families, or use ones confirmed present. A missing font" >&2
  echo "raises no error: the render succeeds, the dimensions check out, and only the" >&2
  echo "type on the finished poster looks subtly wrong." >&2
  exit 1
fi

echo
echo "Families marked \"latin only\" must not set CJK text: every character would come"
echo "from a fallback face."
