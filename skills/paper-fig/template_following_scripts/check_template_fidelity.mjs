#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs as parseNodeArgs } from "node:util";
import { fileURLToPath } from "node:url";

const DEFAULT_SLIDE_SIZE = { width: 1280, height: 720 };

function parseArgs(argv) {
  return parseNodeArgs({
    args: argv,
    options: {
      help: { type: "boolean" },
      workspace: { type: "string" },
      "final-pptx": { type: "string" },
      map: { type: "string" },
      "starter-pptx": { type: "string" },
      "starter-layout-dir": { type: "string" },
      "final-layout-dir": { type: "string" },
      "edit-dir": { type: "string" },
      "agent-log": { type: "string" },
      "no-report": { type: "boolean" },
    },
    allowPositionals: false,
    strict: true,
  }).values;
}

function requireArg(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required --${key}`);
  return value;
}

const PLACEHOLDER_PATTERNS = [
  /^slide number$/i,
  /^date$/i,
  /^footer$/i,
  /^click to add (title|subtitle|text)$/i,
  /^(title|subtitle|name|text|body) goes here$/i,
  /^lorem ipsum\b/i,
  /\btemplate instruction\b/i,
];
const SCAN_EXTENSIONS = new Set([".mjs", ".js", ".cjs", ".ts", ".py", ".sh", ".txt", ".md", ".jsonl"]);
const SKIP_SCAN_DIRS = new Set([
  ".git",
  "node_modules",
  "assets",
  "preview",
  "template-starter-preview",
  "template-inspect",
  "template-starter-layout",
  "layout",
  "qa",
  "output",
]);

function usage() {
  return [
    "Usage:",
    "  $RUNTIME_NODE template_following_scripts/check_template_fidelity.mjs --workspace <dir> --final-pptx <deck.pptx> [options]",
    "",
    "Options:",
    "  --map <path>                  template-frame-map.json.",
    "  --starter-pptx <path>         Starter PPTX path for report provenance.",
    "  --starter-layout-dir <dir>    Starter layout JSON directory.",
    "  --final-layout-dir <dir>      Final layout JSON directory.",
    "  --edit-dir <dir>              Scripts/logs directory to scan. Defaults to <workspace>.",
    "  --agent-log <path>            Additional child-agent log to scan.",
    "  --no-report                  Validate without writing qa/template-fidelity-check.*.",
    "",
    "Checks final template-following decks for overlays, unresolved placeholders,",
    "fresh-slide rebuilds, and deck-affecting Python/OOXML bypasses.",
  ].join("\n");
}

function issue(severity, id, message, context = {}) {
  return { severity, id, message, ...context };
}

async function exists(filePath) {
  return fs
    .stat(filePath)
    .then((stat) => stat.isFile() || stat.isDirectory())
    .catch(() => false);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding,
    maxBuffer: options.maxBuffer || 80 * 1024 * 1024,
  });
  if (result.status !== 0) return undefined;
  return result.stdout;
}

function zipNames(pptxPath) {
  const output = runCapture("unzip", ["-Z1", pptxPath], { encoding: "utf8" });
  if (!output) return [];
  return String(output)
    .split(/\r?\n/)
    .filter(Boolean);
}

function readZipText(pptxPath, entryName) {
  const output = runCapture("unzip", ["-p", pptxPath, entryName]);
  return output ? Buffer.from(output).toString("utf8") : "";
}

function decodeXmlText(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function decodeXmlAttr(value) {
  return decodeXmlText(value || "");
}

function placeholderLike(text) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

function xmlAttr(xml, attrName) {
  const match = xml.match(new RegExp(`\\b${attrName}="([^"]*)"`, "i"));
  return match ? decodeXmlAttr(match[1]) : undefined;
}

function shapeBlocks(xml) {
  return [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((match) => match[0]);
}

function textRuns(block) {
  return [...block.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => decodeXmlText(match[1]));
}

function structuralPlaceholderContext(block) {
  const placeholderTag = block.match(/<p:ph\b([^>]*)\/?>/);
  if (!placeholderTag) return undefined;
  const cNvPrTag = block.match(/<p:cNvPr\b[^>]*>/)?.[0] || "";
  return {
    shapeId: xmlAttr(cNvPrTag, "id"),
    name: xmlAttr(cNvPrTag, "name"),
    placeholderType: xmlAttr(placeholderTag[0], "type"),
    placeholderIdx: xmlAttr(placeholderTag[0], "idx"),
  };
}

async function walkFiles(root, options = {}) {
  const files = [];
  const resolvedRoot = path.resolve(root);
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!options.includeSkippedDirs && SKIP_SCAN_DIRS.has(entry.name)) continue;
        await visit(entryPath);
      } else if (!options.extensions || options.extensions.has(path.extname(entry.name))) {
        files.push(entryPath);
      }
    }
  }
  if (await exists(resolvedRoot)) await visit(resolvedRoot);
  return files;
}

async function scanAuthoringFiles(editDir, agentLog) {
  const issues = [];
  const files = await walkFiles(editDir, { extensions: SCAN_EXTENSIONS });
  if (agentLog && (await exists(agentLog))) files.push(path.resolve(agentLog));

  let combined = "";
  for (const file of [...new Set(files)]) {
    const ext = path.extname(file);
    const text = await fs.readFile(file, "utf8").catch(() => "");
    if (!text) continue;
    combined += `\n/* ${file} */\n${text}`;

    if (ext === ".py" && /\b(from\s+pptx\s+import|import\s+pptx|Presentation\s*\()/m.test(text)) {
      issues.push(issue("fail", "deck-affecting-python", "Python script appears to use python-pptx.", { file }));
    }
    if (ext === ".py" && /\.save\s*\([^)]*\.pptx/i.test(text)) {
      issues.push(issue("fail", "deck-affecting-python", "Python script appears to save a PPTX.", { file }));
    }
    if (/\bzipfile\b|\bZipFile\b/.test(text) && /\b(write|writestr|append|ppt\/slides\/|_rels\/|\[Content_Types\]\.xml)/.test(text)) {
      issues.push(issue("fail", "direct-ooxml-mutation", "Script/log suggests direct OOXML package mutation.", { file }));
    }
    if (/\bsoffice\b[\s\S]{0,120}--convert-to[\s\S]{0,80}pptx/i.test(text)) {
      issues.push(issue("fail", "libreoffice-pptx-mutation", "Script/log suggests LibreOffice PPTX mutation.", { file }));
    }
    if (/\bPresentation\.create\s*\(/.test(text)) {
      issues.push(issue("fail", "fresh-slide-rebuild", "Template-following final authoring must not create a fresh presentation.", { file }));
    }
    if (/presentation\.slides\.add\s*\(/.test(text)) {
      issues.push(issue("fail", "fresh-slide-rebuild", "Template-following final authoring must not add fresh slides.", { file }));
    }
  }

  if (!/PresentationFile\.importPptx\s*\(/.test(combined) || !/(template-starter\.pptx|starterPptx|starterPptxPath)/.test(combined)) {
    issues.push(
      issue(
        "fail",
        "missing-starter-import-evidence",
        "Could not find evidence that final authoring imports template-starter.pptx with PresentationFile.importPptx.",
      ),
    );
  }
  if (!/PresentationFile\.exportPptx\s*\(/.test(combined)) {
    issues.push(
      issue("fail", "missing-artifact-export-evidence", "Could not find evidence that final authoring exports with PresentationFile.exportPptx."),
    );
  }
  return issues;
}

function flattenObjects(value, out = []) {
  if (!value || typeof value !== "object") return out;
  const text = String(value.textPreview ?? value.text ?? value.plainText ?? value.rawText ?? value.value ?? "").trim();
  const box = bboxOf(value);
  if (box || text || value.type || value.kind) out.push({ ...value, __text: text, __bbox: box });
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) flattenObjects(item, out);
    } else if (child && typeof child === "object") {
      flattenObjects(child, out);
    }
  }
  return out;
}

function bboxOf(value) {
  const raw = value?.bbox || value?.bounds || value?.box;
  if (Array.isArray(raw) && raw.length === 4) {
    const [x, y, w, h] = raw.map(Number);
    if ([x, y, w, h].every(Number.isFinite)) return { x, y, w, h, x2: x + w, y2: y + h };
  }
  const x = Number(value?.left ?? value?.x);
  const y = Number(value?.top ?? value?.y);
  const w = Number(value?.width ?? value?.w);
  const h = Number(value?.height ?? value?.h);
  if ([x, y, w, h].every(Number.isFinite)) return { x, y, w, h, x2: x + w, y2: y + h };
  return undefined;
}

function area(box) {
  return Math.max(0, box?.w || 0) * Math.max(0, box?.h || 0);
}

function intersection(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y), x2, y2 };
}

function centerInside(outer, inner) {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return cx >= outer.x && cx <= outer.x2 && cy >= outer.y && cy <= outer.y2;
}

function fillValue(value) {
  return String(value.fillColor ?? value.fill ?? value.backgroundColor ?? value.color ?? "").toLowerCase();
}

function isTransparent(fill) {
  return !fill || fill === "none" || fill === "transparent" || fill.includes("rgba(0, 0, 0, 0)") || fill.includes("opacity:0");
}

function isLikelyOpaquePanel(element, slideArea) {
  const box = element.__bbox;
  if (!box) return false;
  if (area(box) < slideArea * 0.02) return false;
  if (element.__text) return false;
  const type = String(element.type ?? element.kind ?? element.shapeType ?? "").toLowerCase();
  const fill = fillValue(element);
  return (type.includes("shape") || type.includes("rect") || fill) && !isTransparent(fill);
}

function isContentElement(element) {
  const type = String(element.type ?? element.kind ?? "").toLowerCase();
  return Boolean(element.__bbox) && (Boolean(element.__text) || /image|table|chart|text/.test(type));
}

function layoutSlideNumber(filePath) {
  const match = path.basename(filePath).match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

async function readLayouts(layoutDir) {
  if (!layoutDir || !(await exists(layoutDir))) return new Map();
  const files = (await walkFiles(layoutDir, { includeSkippedDirs: true })).filter((file) => file.endsWith(".json"));
  const layouts = new Map();
  for (const file of files) {
    const slide = layoutSlideNumber(file);
    if (!Number.isInteger(slide)) continue;
    const json = JSON.parse(await fs.readFile(file, "utf8"));
    layouts.set(slide, { file, json, elements: flattenObjects(json) });
  }
  return layouts;
}

function bestIoU(box, candidates) {
  let best = 0;
  for (const candidate of candidates) {
    const other = candidate.__bbox;
    if (!other) continue;
    const interArea = area(intersection(box, other));
    const union = area(box) + area(other) - interArea;
    if (union > 0) best = Math.max(best, interArea / union);
  }
  return best;
}

async function scanFinalLayouts(finalLayoutDir) {
  const issues = [];
  const layouts = await readLayouts(finalLayoutDir);
  for (const [slide, layout] of layouts) {
    for (const element of layout.elements) {
      const text = element.__text;
      if (text && placeholderLike(text)) {
        issues.push(
          issue("fail", "unresolved-placeholder", `Placeholder text remains in final layout: "${text}".`, {
            slide,
            file: layout.file,
          }),
        );
      }
    }
  }
  return { issues, layouts };
}

async function scanPptxPlaceholders(finalPptx) {
  const issues = [];
  for (const entry of zipNames(finalPptx).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))) {
    const xml = readZipText(finalPptx, entry);
    const slide = Number(entry.match(/slide(\d+)\.xml$/)?.[1]);
    for (const block of shapeBlocks(xml)) {
      const placeholder = structuralPlaceholderContext(block);
      if (!placeholder) continue;
      if (textRuns(block).join("").trim()) continue;
      issues.push(
        issue("fail", "empty-structural-placeholder", "Empty structural PowerPoint placeholder remains in final PPTX XML.", {
          slide,
          entry,
          ...placeholder,
        }),
      );
    }
    for (const match of xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)) {
      const text = decodeXmlText(match[1]);
      if (text && placeholderLike(text)) {
        issues.push(issue("fail", "unresolved-placeholder", `Placeholder text remains in final PPTX XML: "${text}".`, { slide, entry }));
      }
    }
  }
  return issues;
}

async function scanOverlays(starterLayoutDir, finalLayoutDir) {
  const issues = [];
  const starterLayouts = await readLayouts(starterLayoutDir);
  const finalLayouts = await readLayouts(finalLayoutDir);
  const slideArea = DEFAULT_SLIDE_SIZE.width * DEFAULT_SLIDE_SIZE.height;
  for (const [slide, finalLayout] of finalLayouts) {
    const starterLayout = starterLayouts.get(slide);
    if (!starterLayout) continue;
    const starterContent = starterLayout.elements.filter(isContentElement);
    const starterAll = starterLayout.elements.filter((element) => element.__bbox);
    for (const element of finalLayout.elements) {
      const box = element.__bbox;
      if (!isLikelyOpaquePanel(element, slideArea)) continue;
      if (bestIoU(box, starterAll) > 0.92) continue;
      for (const inherited of starterContent) {
        const inheritedBox = inherited.__bbox;
        if (!inheritedBox) continue;
        const overlap = area(intersection(box, inheritedBox));
        if (overlap > area(inheritedBox) * 0.35 || centerInside(box, inheritedBox)) {
          issues.push(
            issue("fail", "mask-cover-overlay", "Large new opaque shape appears to cover inherited template content.", {
              slide,
              finalLayout: finalLayout.file,
              starterLayout: starterLayout.file,
              inheritedText: inherited.__text || undefined,
            }),
          );
          break;
        }
      }
    }
  }
  return issues;
}

export async function checkTemplateFidelity(options) {
  const workspace = path.resolve(options.workspace);
  const finalPptx = path.resolve(options.finalPptx);
  const editDir = path.resolve(options.editDir || workspace);
  const starterLayoutDir = options.starterLayoutDir ? path.resolve(options.starterLayoutDir) : undefined;
  const finalLayoutDir = options.finalLayoutDir ? path.resolve(options.finalLayoutDir) : undefined;
  const writeReport = options.writeReport !== false;
  const issues = [];

  if (!(await exists(finalPptx))) {
    issues.push(issue("fail", "missing-final-pptx", `Missing final PPTX: ${finalPptx}`));
  }
  issues.push(...(await scanAuthoringFiles(editDir, options.agentLog)));

  if (finalLayoutDir) {
    const layoutScan = await scanFinalLayouts(finalLayoutDir);
    issues.push(...layoutScan.issues);
  }
  if (await exists(finalPptx)) {
    issues.push(...(await scanPptxPlaceholders(finalPptx)));
  }
  if (starterLayoutDir && finalLayoutDir) {
    issues.push(...(await scanOverlays(starterLayoutDir, finalLayoutDir)));
  }

  const status = issues.some((item) => item.severity === "fail")
    ? "fail"
    : issues.length > 0
      ? "warning"
      : "pass";
  const report = {
    status,
    checkedAt: new Date().toISOString(),
    workspace,
    finalPptx,
    starterPptx: options.starterPptx ? path.resolve(options.starterPptx) : undefined,
    mapPath: options.mapPath ? path.resolve(options.mapPath) : undefined,
    starterLayoutDir,
    finalLayoutDir,
    editDir,
    issueCount: issues.length,
    issues,
  };

  if (writeReport) {
    const qaDir = path.join(workspace, "qa");
    await fs.mkdir(qaDir, { recursive: true });
    await writeJson(path.join(qaDir, "template-fidelity-check.json"), report);
    await fs.writeFile(
      path.join(qaDir, "template-fidelity-check.txt"),
      [
        `Template fidelity check: ${status}`,
        ...issues.map((item) =>
          `${item.severity.toUpperCase()} ${item.id}: ${item.message}` +
          (item.slide ? ` slide=${item.slide}` : "") +
          (item.file ? ` file=${item.file}` : ""),
        ),
        "",
      ].join("\n"),
      "utf8",
    );
  }

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const report = await checkTemplateFidelity({
    workspace: requireArg(args, "workspace"),
    finalPptx: requireArg(args, "final-pptx"),
    starterPptx: args["starter-pptx"],
    mapPath: args.map,
    starterLayoutDir: args["starter-layout-dir"],
    finalLayoutDir: args["final-layout-dir"],
    editDir: args["edit-dir"],
    agentLog: args["agent-log"],
    writeReport: !args["no-report"],
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "fail") process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    console.error(usage());
    process.exit(1);
  });
}
