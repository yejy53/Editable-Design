#!/usr/bin/env bash
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
failures=0

ok() { printf '%-22s %s\n' "$1" "OK  $2"; }
warn() { printf '%-22s %s\n' "$1" "OPTIONAL  $2"; }
bad() { printf '%-22s %s\n' "$1" "MISSING  $2"; failures=$((failures + 1)); }

printf '%s\n\n' "Editable Design doctor"

if command -v node >/dev/null 2>&1; then
  node_version="$(node -p 'process.versions.node')"
  node_major="${node_version%%.*}"
  node_minor="$(printf '%s' "$node_version" | cut -d. -f2)"
  if [[ "$node_major" -gt 22 || ( "$node_major" -eq 22 && "$node_minor" -ge 12 ) ]]; then ok "Node.js" "$node_version"; else bad "Node.js" "$node_version; requires >=22.12"; fi
else
  bad "Node.js" "requires >=22.12"
fi

if command -v npm >/dev/null 2>&1; then ok "npm" "$(npm --version)"; else bad "npm" "required for npm ci --prefix scripts"; fi

if [[ -f "$here/node_modules/puppeteer-core/package.json" ]]; then
  version="$(node -p "require('$here/node_modules/puppeteer-core/package.json').version" 2>/dev/null || true)"
  ok "puppeteer-core" "${version:-installed}"
else
  bad "puppeteer-core" "run npm ci --prefix scripts"
fi

font_kit="$here/../font-kit/node_modules"
if [[ -f "$font_kit/@fontsource-variable/fraunces/package.json" && -f "$font_kit/@fontsource-variable/noto-sans-sc/package.json" ]]; then
  font_count="$(find "$font_kit" -mindepth 3 -maxdepth 3 -name package.json | wc -l | tr -d ' ')"
  ok "Font kit" "$font_count curated packages"
else
  bad "Font kit" "run scripts/install-font-kit.sh"
fi

browser=""
for candidate in "${EDITABLE_DESIGN_BROWSER:-}" "${PUPPETEER_EXECUTABLE_PATH:-}" "${POSTER_BROWSER:-}" "${CHROME_PATH:-}"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then browser="$candidate"; break; fi
done
if [[ -z "$browser" ]]; then
  for candidate in chromium google-chrome chrome; do
    browser="$(command -v "$candidate" 2>/dev/null || true)"
    [[ -n "$browser" ]] && break
  done
fi
if [[ -z "$browser" ]]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
    "/usr/bin/google-chrome" "/usr/bin/chromium" "/usr/bin/chromium-browser"; do
    if [[ -x "$candidate" ]]; then browser="$candidate"; break; fi
  done
fi
if [[ -n "$browser" ]]; then ok "Chromium browser" "$browser"; else bad "Chromium browser" "set EDITABLE_DESIGN_BROWSER"; fi

if command -v python3 >/dev/null 2>&1; then
  python_version="$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
  warn "Python" "$python_version; optional cutout processing only"
  if python3 -c 'import PIL' >/dev/null 2>&1; then warn "Pillow" "installed"; else warn "Pillow" "needed only for cutout processing"; fi
else
  warn "Python" "needed only for cutout processing"
fi

warn "Image generation" "host-dependent; auto mode can fall back to off"
if [[ "${EDITABLE_DESIGN_NO_SANDBOX:-0}" == "1" ]]; then warn "Browser sandbox" "disabled by explicit environment setting"; else ok "Browser sandbox" "enabled"; fi

printf '\n'
if [[ "$failures" -eq 0 ]]; then
  printf '%s\n' "Core workflow ready."
  exit 0
fi
printf '%s\n' "Core workflow has $failures missing requirement(s)."
exit 1
