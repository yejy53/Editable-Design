# HTML to Editable PPTX

`html-to-pptx` is an independent Codex skill that deterministically converts compatible slide, poster, and fixed-canvas HTML into an editable PowerPoint file. One entry point automatically handles clean design HTML, Editable Design's `editor.html`, and `layers.html` exploded-layer boards.

## Zero-configuration setup

Use the wrapper below. On first use it finds a compatible Python runtime, creates an isolated `.venv` inside the Skill, installs the Python packages and Playwright Chromium, and then continues the requested conversion. Later runs reuse the environment.

```bash
bash scripts/run.sh /path/to/index.html -o /path/to/design.pptx
```

Users do not need to run `pip`, install Playwright, or repair executable permissions. If automatic setup needs diagnosis, run `bash scripts/setup.sh`. Set `HTML_TO_PPTX_PYTHON` only when a specific Python 3.10+ executable must be used.

Chromium sandboxing stays enabled by default. Set `HTML_TO_PPTX_NO_SANDBOX=1` only when the host cannot launch Chromium with its sandbox.

Optional visual comparison additionally requires LibreOffice and PyMuPDF:

```bash
.venv/bin/python -m pip install -r requirements-check.txt
```

## Usage

```bash
bash scripts/run.sh /path/to/index.html -o /path/to/design.pptx
bash scripts/run.sh /path/to/editor.html
bash scripts/run.sh /path/to/layers.html --keep-overview
.venv/bin/python scripts/render_check.py /path/to/index.html /path/to/design.pptx
```

The default `--mode auto` recognizes `plain`, `editor`, and `exploded` pages. For `editor.html`, it calls the editor's own `fullHTML()` export to remove the toolbar, panels, and scaled stage before conversion. For `layers.html`, it waits for the animation to settle and removes the overview by default. Use `--mode` only when automatic detection needs to be overridden.

Keep the HTML beside its assets so relative image, CSS, and font paths resolve correctly.

Editable Design is a supported source of HTML, but it is not required. This skill runs only when PPTX conversion is requested.

This community project is provided under the Apache License 2.0 and is not an official OpenAI project.
