# Editable Design Toolkit

Agent-driven creation of editable, tastefully crafted visual artifacts.

This repository packages two independent Codex skills. The main skill turns a visual brief into a fixed-canvas design with real text, semantic HTML layers, independent imagery, rendered output, an editor, an animated layer breakdown, and an evidence-backed Design Replay. The companion skill converts compatible HTML into an editable PowerPoint file when that format is explicitly requested.

See the public [Editable Visual Design Gallery](https://github.com/yejy53/Editable-Design#gallery) for prompts, final renderings, editable demonstrations, and Agent Design Replays.

## Included Skills

| Skill | Purpose | Main outputs |
| --- | --- | --- |
| [`editable-design`](skills/editable-design/) | Create polished posters, covers, campaign graphics, information designs, menus, banners, and social cards | `index.html`, rendered PNG, `editor.html`, `layers.html`, and `replay/index.html` |
| [`html-to-pptx`](skills/html-to-pptx/) | Convert clean fixed-canvas HTML, Editable Design editor pages, or exploded-layer boards | Editable `.pptx` with independently selectable elements where the source structure permits |

The skills are siblings, not nested dependencies. `editable-design` completes its normal HTML and PNG delivery without PowerPoint support. `html-to-pptx` runs only when the user asks for a PPTX and automatically recognizes clean design HTML, `editor.html`, and `layers.html`; it can also convert compatible HTML produced elsewhere.

## Install

Clone the repository, then install the skill or skills you need:

```bash
git clone https://github.com/yejy53/Editable-Design.git
cd Editable-Design

mkdir -p ~/.codex/skills
cp -R skills/editable-design ~/.codex/skills/
cp -R skills/html-to-pptx ~/.codex/skills/   # optional
```

Install the Editable Design runtime dependency and verify the browser setup:

```bash
npm ci --prefix ~/.codex/skills/editable-design/scripts
~/.codex/skills/editable-design/scripts/doctor.sh
```

For optional PowerPoint export, install its Python dependencies and Playwright browser:

```bash
python3 -m pip install -r ~/.codex/skills/html-to-pptx/requirements.txt
python3 -m playwright install chromium
~/.codex/skills/html-to-pptx/scripts/doctor.sh
```

Detailed requirements and direct CLI usage are documented in each skill's README:

- [`editable-design` setup and capability notes](skills/editable-design/README.md)
- [`html-to-pptx` setup and conversion commands](skills/html-to-pptx/README.md)

## Use in Codex

Ask Codex to use the installed skill by name:

```text
Use $editable-design to create a polished 3:4 campaign poster for ...
```

For a completed compatible HTML design:

```text
Use $html-to-pptx to convert this design into an editable PowerPoint file.
```

Image generation is host-dependent. When it is unavailable, Editable Design can use live typography, HTML geometry, local icons, and user-provided assets where those are sufficient; it does not silently replace an intrinsically photographic or illustrative brief with a materially weaker design.

Design Replay is a local evidence artifact and may contain the original brief, prompts, attachment paths, and design decisions. Review it before sharing.

## Package a Release

Create a source archive without installed dependencies or temporary files:

```bash
./pack.sh
```

The output path is printed when packaging completes. You can also package either skill independently with its own `pack.sh`.

## License

This community project is provided under the [Apache License 2.0](LICENSE) and is not an official OpenAI project. See [Third-party notices](THIRD_PARTY_NOTICES.md) for dependency attribution.
