#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs as parseNodeArgs } from "node:util";

import { importRuntimeModule } from "../container_tools/runtime_helpers.mjs";

function parseArgs(argv) {
  return parseNodeArgs({
    args: argv,
    options: {
      help: { type: "boolean" },
      workspace: { type: "string" },
      pptx: { type: "string" },
      "out-dir": { type: "string" },
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
    "  $RUNTIME_NODE template_following_scripts/inspect_template_deck.mjs --workspace <dir> --pptx <source.pptx> [options]",
    "",
    "Options:",
    "  --out-dir <dir>   Output directory under workspace. Defaults to <workspace>/template-inspect.",
    "  --scale <n>       Render scale. Defaults to 1.",
    "",
    "Imports a source PPTX with artifact-tool, renders source slide PNGs/layouts,",
    "extracts package media, scans font names, writes template-inspect.ndjson,",
    "and writes template-manifest.json.",
  ].join("\n");
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding,
    maxBuffer: options.maxBuffer || 80 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : result.stdout;
    throw new Error((stderr || stdout || `${command} ${args.join(" ")} failed`).trim());
  }
  return result.stdout;
}

function isWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function zipNames(pptxPath) {
  return String(runCapture("unzip", ["-Z1", pptxPath], { encoding: "utf8" }))
    .split(/\r?\n/)
    .filter(Boolean);
}

function readZipText(pptxPath, entryName) {
  return Buffer.from(runCapture("unzip", ["-p", pptxPath, entryName])).toString("utf8");
}

async function copyZipEntry(pptxPath, entryName, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, Buffer.from(runCapture("unzip", ["-p", pptxPath, entryName])));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativeFromWorkspace(workspaceDir, filePath) {
  return path.relative(workspaceDir, filePath).split(path.sep).join("/");
}

function collectFonts(pptxPath, names) {
  const fonts = new Set();
  for (const name of names) {
    if (!/^ppt\/(?:slides|slideMasters|slideLayouts|theme)\/.*\.xml$/.test(name) && !/^ppt\/theme\/.*\.xml$/.test(name)) {
      continue;
    }
    const xml = readZipText(pptxPath, name);
    for (const match of xml.matchAll(/\btypeface="([^"]+)"/g)) fonts.add(match[1]);
  }
  return [...fonts].sort();
}

function slidesFromPresentation(presentation) {
  if (Array.isArray(presentation.slides?.items)) return presentation.slides.items;
  if (Number.isInteger(presentation.slides?.count) && typeof presentation.slides.getItem === "function") {
    return Array.from({ length: presentation.slides.count }, (_, index) => presentation.slides.getItem(index));
  }
  throw new Error("Could not enumerate imported presentation slides.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const workspaceDir = path.resolve(requireArg(args, "workspace"));
  const pptxPath = path.resolve(requireArg(args, "pptx"));
  const scale = args.scale ? Number.parseFloat(args.scale) : 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("--scale must be a positive number");
  }

  const outDir = args["out-dir"]
    ? path.resolve(workspaceDir, args["out-dir"])
    : path.join(workspaceDir, "template-inspect");
  if (!isWithin(outDir, workspaceDir)) {
    throw new Error(`Refusing to write template inspection outside workspace: ${outDir}`);
  }
  if (path.resolve(outDir) === workspaceDir) {
    throw new Error(
      [
        `Refusing to use the workspace root as template inspection output: ${outDir}`,
        "Omit --out-dir or use a dedicated subdirectory such as --out-dir template-inspect.",
      ].join("\n"),
    );
  }

  const sourceStat = await fs.stat(pptxPath).catch(() => undefined);
  if (!sourceStat?.isFile()) {
    throw new Error(`Missing source PPTX: ${pptxPath}`);
  }

  const { FileBlob, PresentationFile } = await importRuntimeModule("@oai/artifact-tool");

  await fs.rm(outDir, { recursive: true, force: true });
  const slidesDir = path.join(outDir, "source-slides");
  const layoutsDir = path.join(outDir, "layouts");
  const mediaDir = path.join(outDir, "assets", "ppt", "media");
  const inspectPath = path.join(outDir, "template-inspect.ndjson");
  const manifestPath = path.join(outDir, "template-manifest.json");
  await fs.mkdir(slidesDir, { recursive: true });
  await fs.mkdir(layoutsDir, { recursive: true });

  const presentation = await PresentationFile.importPptx(await FileBlob.load(pptxPath));
  const slides = slidesFromPresentation(presentation);
  const names = zipNames(pptxPath);
  const media = names.filter((name) => name.startsWith("ppt/media/"));
  const slideXmlNames = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const chartNames = names.filter((name) => /^ppt\/(?:charts|embeddings\/charts)\/chart\d+\.xml$/.test(name));

  const slideArtifacts = [];
  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index];
    const slideNumber = index + 1;
    const padded = String(slideNumber).padStart(2, "0");
    const pngPath = path.join(slidesDir, `source-slide-${padded}.png`);
    const layoutPath = path.join(layoutsDir, `source-slide-${padded}.layout.json`);

    const preview = await presentation.export({ slide, format: "png", scale });
    await saveBlobToFile(preview, pngPath);

    const layout = await presentation.export({ slide, format: "layout" });
    await saveBlobToFile(layout, layoutPath);

    slideArtifacts.push({
      slide: slideNumber,
      previewPath: pngPath,
      previewRelativePath: relativeFromWorkspace(workspaceDir, pngPath),
      layoutPath,
      layoutRelativePath: relativeFromWorkspace(workspaceDir, layoutPath),
    });
  }

  const extractedMedia = [];
  for (const entry of media) {
    const target = path.join(mediaDir, path.basename(entry));
    await copyZipEntry(pptxPath, entry, target);
    const stat = await fs.stat(target);
    extractedMedia.push({
      entry,
      path: target,
      relativePath: relativeFromWorkspace(workspaceDir, target),
      bytes: stat.size,
    });
  }

  const inspect = await presentation.inspect({
    kind: "slide,textbox,shape,image,table,chart",
    max_chars: 200000,
  });
  await fs.writeFile(inspectPath, inspect.ndjson || "", "utf8");

  const tableSlideCount = slideXmlNames.filter((name) => readZipText(pptxPath, name).includes("<a:tbl>")).length;
  const manifest = {
    sourcePptx: pptxPath,
    workspace: workspaceDir,
    outDir,
    generatedAt: new Date().toISOString(),
    slideCount: slides.length,
    slideArtifacts,
    inspectPath,
    inspectRelativePath: relativeFromWorkspace(workspaceDir, inspectPath),
    inspectTruncated: Boolean(inspect.truncated),
    inspectMetadata: inspect.metadata || {},
    extractedMedia,
    fonts: collectFonts(pptxPath, names),
    packageParts: {
      mediaCount: media.length,
      slideXmlCount: slideXmlNames.length,
      chartCount: chartNames.length,
      tableSlideCount,
    },
  };
  await writeJson(manifestPath, manifest);
  console.log(manifestPath);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  console.error(usage());
  process.exit(1);
});
