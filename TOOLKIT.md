# Editable Design Toolkit

Agent-driven creation of editable, tastefully crafted visual artifacts.

This repository packages three Codex skills. Paper Fig creates editable research method and architecture diagrams as PowerPoint. Editable Design turns a visual brief into a fixed-canvas HTML design with real text, independent imagery, an editor, a layer breakdown, and a Design Replay. HTML to PPTX converts compatible HTML into an editable PowerPoint file when that format is requested.

See the public [Editable Visual Design Gallery](https://github.com/yejy53/Editable-Design#gallery) for prompts, final renderings, editable demonstrations, and Agent Design Replays.

## Included Skills

| Skill | Purpose | Main outputs |
| --- | --- | --- |
| [`paper-fig`](skills/paper-fig/) | Generate paper workflow and architecture diagrams from method descriptions | Editable `.pptx` |
| [`editable-design`](skills/editable-design/) | Create polished posters, covers, campaign graphics, information designs, menus, banners, and social cards | `index.html`, rendered PNG, `editor.html`, `layers.html`, and `replay/index.html` |
| [`html-to-pptx`](skills/html-to-pptx/) | Convert clean fixed-canvas HTML, Editable Design editor pages, or exploded-layer boards | Editable `.pptx` with independently selectable elements where the source structure permits |

Install only the skill you need. `paper-fig` does not require either of the other skills. `editable-design` completes its HTML and PNG delivery without PowerPoint support. `html-to-pptx` runs when a PPTX is requested and recognizes clean design HTML, `editor.html`, and `layers.html`.

## Install

### Paper Fig: one request in Codex

```text
Install the paper-fig Skill from:
https://github.com/yejy53/Editable-Design/tree/main/skills/paper-fig
```

Provide a method description and the visual style you want. See the [Paper Fig guide](skills/paper-fig/INSTALL.md) for manual installation and technical details.

### Editable Design: manual source install

Use a sparse, blob-filtered clone so the install checks out the core skill without the Gallery media:

```bash
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/yejy53/Editable-Design.git
cd Editable-Design
git sparse-checkout set skills/editable-design

mkdir -p ~/.codex/skills
cp -R skills/editable-design ~/.codex/skills/
```

Install the Editable Design runtime dependency and verify the browser setup:

```bash
npm ci --prefix ~/.codex/skills/editable-design/scripts
~/.codex/skills/editable-design/scripts/install-font-kit.sh
~/.codex/skills/editable-design/scripts/doctor.sh
```

The font kit is self-hosted and versioned. Each generated project copies only
the WOFF2 files it selects, rather than carrying the full library.

For optional PowerPoint export, copy the sibling Skill. Its first conversion prepares and reuses an isolated runtime automatically:

```bash
git sparse-checkout add skills/html-to-pptx
cp -R skills/html-to-pptx ~/.codex/skills/
```

Detailed requirements and direct CLI usage are documented in each skill's README:

- [`editable-design` setup and capability notes](skills/editable-design/README.md)
- [`html-to-pptx` setup and conversion commands](skills/html-to-pptx/README.md)
- [`paper-fig` installation and host requirements](skills/paper-fig/INSTALL.md)

## Use in Codex

Ask Codex to use the installed skill by name:

```text
Use $paper-fig to turn the following method description into a paper workflow diagram in my requested visual style. Deliver an editable PowerPoint.
```

For a visual design brief:

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

The output path is printed when packaging completes. See each skill's installation guide for individual packaging options.

## License

Original project code is provided under the [Apache License 2.0](LICENSE). External host resources and third-party content retain their respective terms. This is not an official OpenAI project. See [Third-party notices](THIRD_PARTY_NOTICES.md) for attribution and scope.
