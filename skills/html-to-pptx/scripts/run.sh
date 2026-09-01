#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="${HTML_TO_PPTX_VENV:-$SKILL_DIR/.venv}"
VENV_PYTHON="$VENV_DIR/bin/python"

runtime_is_ready() {
  [[ -f "$VENV_DIR/.setup-complete" ]] || return 1
  [[ -x "$VENV_PYTHON" ]] || return 1
  "$VENV_PYTHON" - <<'PY' >/dev/null 2>&1
from pathlib import Path
from playwright.sync_api import sync_playwright
import numpy  # noqa: F401
import PIL  # noqa: F401
import pptx  # noqa: F401

with sync_playwright() as playwright:
    if not Path(playwright.chromium.executable_path).is_file():
        raise SystemExit(1)
PY
}

if ! runtime_is_ready; then
  printf '%s\n' 'Preparing html-to-pptx for first use…'
  bash "$SCRIPT_DIR/setup.sh"
fi

exec "$VENV_PYTHON" "$SCRIPT_DIR/to_pptx.py" "$@"
