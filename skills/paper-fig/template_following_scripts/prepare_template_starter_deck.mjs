#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs as parseNodeArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { importRuntimeModule } from "../container_tools/runtime_helpers.mjs";
import { validateTemplatePlan } from "./validate_template_plan.mjs";

function parseArgs(argv) {
  return parseNodeArgs({
    args: argv,
    options: {
      help: { type: "boolean" },
      workspace: { type: "string" },
      pptx: { type: "string" },
      map: { type: "string" },
      out: { type: "string" },
      "preview-dir": { type: "string" },
      "layout-dir": { type: "string" },
      inspect: { type: "string" },
      "contact-sheet": { type: "string" },
      scale: { type: "string" },
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

function padSlideNumber(value) {
  return String(value).padStart(2, "0");
}

async function saveBlobToFile(blob, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  if (blob && typeof blob.arrayBuffer === "function") {
    await fs.writeFile(outputPath, Buffer.from(await blob.arrayBuffer()));
    return;
  }
  if (blob instanceof Uint8Array || Buffer.isBuffer(blob)) {
    await fs.writeFile(outputPath, Buffer.from(blob));
    return;
  }
  throw new Error("Expected a Blob or Uint8Array.");
}

function usage() {
  return [
    "Usage:",
    "  $RUNTIME_NODE template_following_scripts/prepare_template_starter_deck.mjs --workspace <dir> --pptx <source.pptx> --map <template-frame-map.json> --out <starter.pptx> [options]",
    "",
    "Options:",
    "  --preview-dir <dir>     Render starter slide PNGs. Defaults to <workspace>/template-starter-preview.",
    "  --layout-dir <dir>      Write starter layout JSON. Defaults to <workspace>/template-starter-layout.",
    "  --inspect <path>        template-inspect.ndjson. Defaults to <workspace>/template-inspect/template-inspect.ndjson.",
    "  --contact-sheet <path>  Optional PNG contact sheet path.",
    "  --scale <n>            Render scale. Defaults to 1.",
    "",
    "Reads template-frame-map.json outputSlides[] and builds an editable starter",
    "deck by duplicating selected source slides in output order.",
  ].join("\n");
}

function isWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativeFromWorkspace(workspaceDir, filePath) {
  return path.relative(workspaceDir, filePath).split(path.sep).join("/");
}

function slidesFromPresentation(presentation) {
  if (Array.isArray(presentation.slides?.items)) return presentation.slides.items;
  if (Number.isInteger(presentation.slides?.count) && typeof presentation.slides.getItem === "function") {
    return Array.from({ length: presentation.slides.count }, (_, index) => presentation.slides.getItem(index));
  }
  throw new Error("Could not enumerate imported presentation slides.");
}

function validateOutputSlides(map, sourceSlideCount) {
  if (!Array.isArray(map.outputSlides) || map.outputSlides.length === 0) {
    throw new Error("template-frame-map.json must include a non-empty outputSlides array.");
  }

  const sorted = [...map.outputSlides].sort((a, b) => a.outputSlide - b.outputSlide);
  for (let index = 0; index < sorted.length; index += 1) {
    const entry = sorted[index];
    const expectedOutputSlide = index + 1;
    if (!Number.isInteger(entry.outputSlide) || entry.outputSlide !== expectedOutputSlide) {
      throw new Error(`outputSlides must be sequential from 1; expected outputSlide ${expectedOutputSlide}.`);
    }
    if (!Number.isInteger(entry.sourceSlide) || entry.sourceSlide < 1 || entry.sourceSlide > sourceSlideCount) {
      throw new Error(
        `outputSlide ${entry.outputSlide} must reference sourceSlide 1-${sourceSlideCount}; got ${entry.sourceSlide}.`,
      );
    }
    if (entry.reuseMode !== "duplicate-slide") {
      throw new Error(
        `outputSlide ${entry.outputSlide} must use reuseMode "duplicate-slide"; got ${JSON.stringify(entry.reuseMode)}.`,
      );
    }
    if (typeof entry.narrativeRole !== "string" || entry.narrativeRole.trim().length === 0) {
      throw new Error(`outputSlide ${entry.outputSlide} must include a non-empty narrativeRole.`);
    }
    if (!Array.isArray(entry.editTargets)) {
      throw new Error(`outputSlide ${entry.outputSlide} must include editTargets as an array.`);
    }
  }
  return sorted;
}

function runContactSheet(previewPaths, outputPath) {
  if (!outputPath) return undefined;
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "make_contact_sheet.py");
  const python = process.env.PYTHON || "python3";
  const result = spawnSync(python, [scriptPath, "--output", outputPath, ...previewPaths], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      [
        `Contact sheet generation failed with ${python}.`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return outputPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const workspaceDir = path.resolve(requireArg(args, "workspace"));
  const pptxPath = path.resolve(requireArg(args, "pptx"));
  const mapPath = path.resolve(requireArg(args, "map"));
  const out = path.resolve(requireArg(args, "out"));
  const previewDir = args["preview-dir"]
    ? path.resolve(args["preview-dir"])
    : path.join(workspaceDir, "template-starter-preview");
  const layoutDir = args["layout-dir"]
    ? path.resolve(args["layout-dir"])
    : path.join(workspaceDir, "template-starter-layout");
  const inspectPath = args.inspect
    ? path.resolve(args.inspect)
    : path.join(workspaceDir, "template-inspect", "template-inspect.ndjson");
  const contactSheetPath = args["contact-sheet"] ? path.resolve(args["contact-sheet"]) : undefined;
  const scale = args.scale ? Number.parseFloat(args.scale) : 1;

  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("--scale must be a positive number");
  }
  for (const writePath of [previewDir, layoutDir, contactSheetPath].filter(Boolean)) {
    if (!isWithin(writePath, workspaceDir)) {
      throw new Error(`Refusing to write starter artifacts outside workspace: ${writePath}`);
    }
  }

  const sourceStat = await fs.stat(pptxPath).catch(() => undefined);
  if (!sourceStat?.isFile()) {
    throw new Error(`Missing source PPTX: ${pptxPath}`);
  }

  const { FileBlob, PresentationFile } = await importRuntimeModule("@oai/artifact-tool");
  const map = await readJson(mapPath);
  const presentation = await PresentationFile.importPptx(await FileBlob.load(pptxPath));
  const sourceSlides = slidesFromPresentation(presentation);
  const outputSlides = validateOutputSlides(map, sourceSlides.length);
  const planCheck = await validateTemplatePlan({
    workspace: workspaceDir,
    mapPath,
    inspectPath,
    sourceSlideCount: sourceSlides.length,
  });
  if (planCheck.status === "fail") {
    const summary = planCheck.issues
      .filter((item) => item.severity === "fail")
      .slice(0, 8)
      .map((item) => `- ${item.id}: ${item.message}`)
      .join("\n");
    throw new Error(
      [
        "template-frame-map.json failed template plan validation.",
        `Report: ${path.join(workspaceDir, "qa", "template-plan-check.json")}`,
        summary,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const originals = [...sourceSlides];
  const starterSlides = [];
  for (const entry of outputSlides) {
    const sourceSlide = originals[entry.sourceSlide - 1];
    const duplicate = sourceSlide.duplicate();
    starterSlides.push({ entry, slide: duplicate });
  }

  for (const slide of originals) {
    slide.delete();
  }

  for (let index = 0; index < starterSlides.length; index += 1) {
    starterSlides[index].slide.moveTo(index);
  }

  await fs.mkdir(previewDir, { recursive: true });
  await fs.mkdir(layoutDir, { recursive: true });
  const previewPaths = [];
  const layoutPaths = [];
  for (let index = 0; index < starterSlides.length; index += 1) {
    const slideNumber = index + 1;
    const padded = padSlideNumber(slideNumber);
    const slide = starterSlides[index].slide;

    const previewPath = path.join(previewDir, `starter-slide-${padded}.png`);
    const preview = await presentation.export({ slide, format: "png", scale });
    await saveBlobToFile(preview, previewPath);
    previewPaths.push(previewPath);

    const layoutPath = path.join(layoutDir, `starter-slide-${padded}.layout.json`);
    const layout = await presentation.export({ slide, format: "layout" });
    await saveBlobToFile(layout, layoutPath);
    layoutPaths.push(layoutPath);
  }

  await fs.mkdir(path.dirname(out), { recursive: true });
  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(out);
  const outputStat = await fs.stat(out);
  if (outputStat.size <= 0) {
    throw new Error(`Exported starter deck is empty: ${out}`);
  }

  const contactSheet = runContactSheet(previewPaths, contactSheetPath);
  const manifestPath = out.toLowerCase().endsWith(".pptx")
    ? `${out.slice(0, -5)}.manifest.json`
    : `${out}.manifest.json`;
  const manifest = {
    sourcePptx: pptxPath,
    mapPath,
    output: out,
    outputBytes: outputStat.size,
    sourceSlideCount: originals.length,
    slideCount: starterSlides.length,
    previewDir,
    layoutDir,
    contactSheet,
    slides: starterSlides.map(({ entry }, index) => ({
      outputSlide: index + 1,
      sourceSlide: entry.sourceSlide,
      narrativeRole: entry.narrativeRole,
      reuseMode: entry.reuseMode,
      editTargetCount: entry.editTargets.length,
      previewPath: previewPaths[index],
      previewRelativePath: relativeFromWorkspace(workspaceDir, previewPaths[index]),
      layoutPath: layoutPaths[index],
      layoutRelativePath: relativeFromWorkspace(workspaceDir, layoutPaths[index]),
    })),
  };
  await writeJson(manifestPath, manifest);
  console.log(JSON.stringify({ ...manifest, manifestPath }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  console.error(usage());
  process.exit(1);
});
