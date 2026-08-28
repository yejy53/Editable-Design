#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/wire-editor.mjs index.html');
  process.exit(2);
}

const source = resolve(target);
if (!existsSync(source) || !statSync(source).isFile()) {
  console.error(`wire-editor: no such HTML file: ${source}`);
  process.exit(2);
}

const project = dirname(source);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const runtimeCandidates = [
  join(scriptDir, 'editor-assets'),
  resolve(scriptDir, '../assets/editor'),
];
const bundledAssets = runtimeCandidates.find((candidate) => {
  const css = join(candidate, 'layer-editor.css');
  const js = join(candidate, 'layer-editor.js');
  return existsSync(css) && existsSync(js)
    && readFileSync(css, 'utf8').includes('.hf-exploded-board')
    && readFileSync(js, 'utf8').includes('setExploded')
    && readFileSync(js, 'utf8').includes('downloadExploded');
});

if (!bundledAssets) {
  console.error('wire-editor: bundled poster editor runtime is unavailable or incomplete');
  process.exit(1);
}
let html = readFileSync(source, 'utf8');
const sourceRevision = createHash('sha256').update(html).digest('hex').slice(0, 12);
const runtimeRevision = createHash('sha256')
  .update(readFileSync(join(bundledAssets, 'layer-editor.css')))
  .update(readFileSync(join(bundledAssets, 'layer-editor.js')))
  .digest('hex').slice(0, 10);
const assetRevision = `${sourceRevision}-${runtimeRevision}`;
const tags = '  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">\n'
  + '  <meta http-equiv="Pragma" content="no-cache">\n'
  + `  <link rel="stylesheet" href="layer-editor.css?v=${assetRevision}">\n`
  + `  <script src="layer-editor.js?v=${assetRevision}" defer></script>\n`;

if (!/<\/head>/i.test(html)) {
  console.error('wire-editor: HTML has no closing head tag');
  process.exit(1);
}
if (!/data-canvas-width="[0-9]+"/.test(html) || !/data-canvas-height="[0-9]+"/.test(html)) {
  console.error('wire-editor: canvas is missing data-canvas-width or data-canvas-height');
  process.exit(1);
}

const ids = [...html.matchAll(/data-layer-id="([^"]*)"/g)].map((match) => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => !id || ids.indexOf(id) !== index))];
if (!ids.length || duplicates.length) {
  console.error(`wire-editor: invalid layer ids${duplicates.length ? `: ${duplicates.join(', ')}` : ''}`);
  process.exit(1);
}

html = html.replace(/<html([^>]*)>/i, (match, attrs) => {
  const cleanAttrs = attrs
    .replace(/\sdata-hf-source-revision="[^"]*"/i, '')
    .replace(/\sdata-hf-runtime-revision="[^"]*"/i, '');
  return `<html${cleanAttrs} data-hf-source-revision="${sourceRevision}" data-hf-runtime-revision="${runtimeRevision}">`;
});

for (const filename of ['layer-editor.css', 'layer-editor.js']) {
  const bundled = join(bundledAssets, filename);
  if (!existsSync(bundled)) {
    console.error(`wire-editor: bundled asset is missing: ${bundled}`);
    process.exit(1);
  }
  copyFileSync(bundled, join(project, filename));
}

const projectRuntime = join(project, 'scripts', 'editor-assets');
if (existsSync(join(project, 'poster.json'))) {
  mkdirSync(projectRuntime, { recursive: true });
  for (const filename of ['layer-editor.css', 'layer-editor.js']) {
    const bundled = join(bundledAssets, filename);
    const vendored = join(projectRuntime, filename);
    if (resolve(bundled) !== resolve(vendored)) copyFileSync(bundled, vendored);
  }
}

if (!html.includes('layer-editor.js')) {
  html = html.replace(/<\/head>/i, tags + '</head>');
}

const output = join(project, 'editor.html');
writeFileSync(output, html);
console.log(`editor      ${output}`);
console.log(`source      ${basename(source)} unchanged`);
console.log(`layers      ${ids.length}`);
console.log(`runtime     ${bundledAssets}`);
console.log(`revision    ${sourceRevision}`);
console.log(`assets-rev  ${runtimeRevision}`);
