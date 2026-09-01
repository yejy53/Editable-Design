#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="${HTML_TO_PPTX_VENV:-$SKILL_DIR/.venv}"

python_is_supported() {
  "$1" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
    >/dev/null 2>&1
}

find_python() {
  local candidate command_name

  if [[ -n "${HTML_TO_PPTX_PYTHON:-}" ]]; then
    if [[ -x "$HTML_TO_PPTX_PYTHON" ]] && python_is_supported "$HTML_TO_PPTX_PYTHON"; then
      printf '%s\n' "$HTML_TO_PPTX_PYTHON"
      return 0
    fi
    printf 'HTML_TO_PPTX_PYTHON is not an executable Python 3.10+: %s\n' \
      "$HTML_TO_PPTX_PYTHON" >&2
    return 1
  fi

  for command_name in python3.13 python3.12 python3.11 python3.10 python3 python; do
    candidate="$(command -v "$command_name" 2>/dev/null || true)"
    if [[ -n "$candidate" ]] && python_is_supported "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  # Codex Desktop ships a private Python runtime that is not always on PATH.
  # Discover it dynamically instead of baking in a user-specific absolute path.
  shopt -s nullglob
  for candidate in "$HOME"/.cache/codex-runtimes/*/dependencies/python/bin/python3; do
    if [[ -x "$candidate" ]] && python_is_supported "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

PYTHON_BIN="$(find_python || true)"
if [[ -z "$PYTHON_BIN" ]]; then
  printf '%s\n' \
    'html-to-pptx needs Python 3.10 or newer. Codex could not find a compatible runtime.' \
    'Set HTML_TO_PPTX_PYTHON to a compatible Python executable and retry.' >&2
  exit 1
fi

printf 'Setting up html-to-pptx with %s (%s)\n' \
  "$PYTHON_BIN" "$($PYTHON_BIN -c 'import sys; print(sys.version.split()[0])')"

"$PYTHON_BIN" -m venv --clear "$VENV_DIR"
VENV_PYTHON="$VENV_DIR/bin/python"

"$VENV_PYTHON" -m pip install --disable-pip-version-check --upgrade pip
"$VENV_PYTHON" -m pip install --disable-pip-version-check -r "$SKILL_DIR/requirements.txt"
"$VENV_PYTHON" -m playwright install chromium

HTML_TO_PPTX_PYTHON="$VENV_PYTHON" bash "$SCRIPT_DIR/doctor.sh"
printf '%s\n' "$($VENV_PYTHON -c 'import sys; print(sys.version.split()[0])')" \
  > "$VENV_DIR/.setup-complete"

printf '\nhtml-to-pptx is ready. Future conversions will reuse %s\n' "$VENV_DIR"
