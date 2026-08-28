# HTML to Editable PPTX

`html-to-pptx` is an independent Codex skill that deterministically converts compatible slide, poster, and fixed-canvas HTML into an editable PowerPoint file. One entry point automatically handles clean design HTML, Editable Design's `editor.html`, and `layers.html` exploded-layer boards.

## Requirements

- Python 3.10 or newer
- Playwright Chromium
- `python-pptx`, Pillow, and NumPy

```bash
python3 -m pip install -r requirements.txt
python3 -m playwright install chromium
scripts/doctor.sh
```

Chromium sandboxing stays enabled by default. Set `HTML_TO_PPTX_NO_SANDBOX=1` only when the host cannot launch Chromium with its sandbox.

Optional visual comparison additionally requires LibreOffice and PyMuPDF:

```bash
python3 -m pip install -r requirements-check.txt
```

## Usage

```bash
python3 scripts/to_pptx.py /path/to/index.html -o /path/to/design.pptx
python3 scripts/to_pptx.py /path/to/editor.html
python3 scripts/to_pptx.py /path/to/layers.html --keep-overview
python3 scripts/render_check.py /path/to/index.html /path/to/design.pptx
```

The default `--mode auto` recognizes `plain`, `editor`, and `exploded` pages. For `editor.html`, it calls the editor's own `fullHTML()` export to remove the toolbar, panels, and scaled stage before conversion. For `layers.html`, it waits for the animation to settle and removes the overview by default. Use `--mode` only when automatic detection needs to be overridden.

Keep the HTML beside its assets so relative image, CSS, and font paths resolve correctly.

Editable Design is a supported source of HTML, but it is not required. This skill runs only when PPTX conversion is requested.

This community project is provided under the Apache License 2.0 and is not an official OpenAI project.
