#!/usr/bin/env node

// Helper used by ensure_raster_image.py to rasterize SVG/SVGZ through the
// bundled Node + sharp runtime instead of requiring Inkscape.

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";

import { requireRuntimeModule } from "./runtime_helpers.mjs";

function parseArgs(argv) {
  return parseNodeArgs({
    args: argv,
    options: {
      input: { type: "string" },
      output: { type: "string" },
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = path.resolve(requireArg(args, "input"));
  const output = path.resolve(requireArg(args, "output"));
  const sharp = await requireRuntimeModule("sharp");

  // Sharp sniffs input bytes, so a .svg filename can otherwise reach native
  // raster decoders. This dedicated subprocess should only load SVG content.
  sharp.block({ operation: ["VipsForeignLoad"] });
  sharp.unblock({ operation: ["VipsForeignLoadSvg"] });

  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp(input, { limitInputPixels: false }).png().toFile(output);
  console.log(JSON.stringify({ input, output }));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
