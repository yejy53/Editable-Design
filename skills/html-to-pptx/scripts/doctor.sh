#!/usr/bin/env bash
set -u

failures=0

ok() { printf '%-22s %s\n' "$1" "OK  $2"; }
warn() { printf '%-22s %s\n' "$1" "OPTIONAL  $2"; }
bad() { printf '%-22s %s\n' "$1" "MISSING  $2"; failures=$((failures + 1)); }

printf '%s\n\n' "HTML to PPTX doctor"

if command -v python3 >/dev/null 2>&1; then
  version="$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
  major="${version%%.*}"
  minor="$(printf '%s' "$version" | cut -d. -f2)"
  if [[ "$major" -gt 3 || ( "$major" -eq 3 && "$minor" -ge 10 ) ]]; then ok "Python" "$version"; else bad "Python" "$version; requires >=3.10"; fi
else
  bad "Python" "requires >=3.10"
fi

for module in playwright pptx PIL numpy; do
  if python3 -c "import $module" >/dev/null 2>&1; then ok "$module" "installed"; else bad "$module" "install requirements.txt"; fi
done

if python3 -c 'import fitz' >/dev/null 2>&1; then warn "PyMuPDF" "installed for comparison"; else warn "PyMuPDF" "install requirements-check.txt for comparison"; fi

soffice="${SOFFICE_PATH:-}"
if [[ -n "$soffice" && -x "$soffice" ]]; then
  warn "LibreOffice" "$soffice"
elif command -v soffice >/dev/null 2>&1; then
  warn "LibreOffice" "$(command -v soffice)"
elif command -v libreoffice >/dev/null 2>&1; then
  warn "LibreOffice" "$(command -v libreoffice)"
elif [[ -x "/Applications/LibreOffice.app/Contents/MacOS/soffice" ]]; then
  warn "LibreOffice" "/Applications/LibreOffice.app/Contents/MacOS/soffice"
else
  warn "LibreOffice" "needed only for visual comparison"
fi

if [[ "${HTML_TO_PPTX_NO_SANDBOX:-0}" == "1" ]]; then warn "Browser sandbox" "disabled by explicit environment setting"; else ok "Browser sandbox" "enabled"; fi

printf '\n'
if [[ "$failures" -eq 0 ]]; then
  printf '%s\n' "Core conversion workflow ready."
  exit 0
fi
printf '%s\n' "Core workflow has $failures missing requirement(s)."
exit 1
