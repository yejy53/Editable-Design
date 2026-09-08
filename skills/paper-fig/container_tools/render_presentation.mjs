#!/usr/bin/env node

// Helper used by render_slides.py to render PowerPoint decks through
// @oai/artifact-tool instead of calling LibreOffice/soffice directly.

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";

import { importRuntimeModule } from "./runtime_helpers.mjs";

function parseArgs(argv) {
  return parseNodeArgs({
    args: argv,
    options: {
      help: { type: "boolean" },
      input: { type: "string" },
      output_dir: { type: "string" },
      scale: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  }).values;
}

function requireArg(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required --${key}`);
  }
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
    "  $RUNTIME_NODE container_tools/render_presentation.mjs --input <deck.pptx> --output_dir <dir> [options]",
    "",
    "Options:",
    "  --scale <number>     Render scale. Defaults to 1.",
  ].join("\n");
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

  const input = path.resolve(requireArg(args, "input"));
  const outputDir = path.resolve(requireArg(args, "output_dir"));
  const scale = args.scale ? Number.parseFloat(args.scale) : 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("--scale must be a positive number.");

  await fs.mkdir(outputDir, { recursive: true });
  const { FileBlob, PresentationFile } = await importRuntimeModule("@oai/artifact-tool");
  const presentation = await PresentationFile.importPptx(await FileBlob.load(input));
  const slides = slidesFromPresentation(presentation);
  const paths = [];

  for (let index = 0; index < slides.length; index += 1) {
    const output = path.join(outputDir, `slide-${index + 1}.png`);
    const preview = await presentation.export({ slide: slides[index], format: "png", scale });
    await saveBlobToFile(preview, output);
    paths.push(output);
  }

  console.log(JSON.stringify({ input, outputDir, slideCount: slides.length, paths }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  console.error(usage());
  process.exit(1);
});
