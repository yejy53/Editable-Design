#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const modulesDir = path.join(skillDir, 'font-kit', 'node_modules');

const fonts = {
  'editorial-serif': {
    family: 'Fraunces Variable',
    package: '@fontsource-variable/fraunces',
    css: ['wght.css'],
    fallback: 'serif',
    coverage: 'Latin',
    role: 'expressive editorial headlines and culture posters'
  },
  'luxury-serif': {
    family: 'Bodoni Moda Variable',
    package: '@fontsource-variable/bodoni-moda',
    css: ['wght.css'],
    fallback: 'serif',
    coverage: 'Latin',
    role: 'fashion, beauty, luxury, and magazine display type'
  },
  'clean-sans': {
    family: 'Instrument Sans Variable',
    package: '@fontsource-variable/instrument-sans',
    css: ['wght.css'],
    fallback: 'sans-serif',
    coverage: 'Latin',
    role: 'clean editorial body copy and refined campaigns'
  },
  'geometric-sans': {
    family: 'Space Grotesk Variable',
    package: '@fontsource-variable/space-grotesk',
    css: ['wght.css'],
    fallback: 'sans-serif',
    coverage: 'Latin',
    role: 'technology, information design, and contemporary labels'
  },
  'condensed-sans': {
    family: 'Roboto Condensed Variable',
    package: '@fontsource-variable/roboto-condensed',
    css: ['wght.css'],
    fallback: 'sans-serif',
    coverage: 'Latin',
    role: 'dense posters, strong deck lines, prices, and utility copy'
  },
  'experimental-display': {
    family: 'Unbounded Variable',
    package: '@fontsource-variable/unbounded',
    css: ['wght.css'],
    fallback: 'sans-serif',
    coverage: 'Latin',
    role: 'art, music, youth, and experimental display type'
  },
  'cjk-sans': {
    family: 'Noto Sans SC Variable',
    package: '@fontsource-variable/noto-sans-sc',
    css: ['wght.css'],
    fallback: 'sans-serif',
    coverage: 'Simplified Chinese + Latin',
    role: 'clear Chinese body copy, information design, and campaigns'
  },
  'cjk-serif': {
    family: 'Noto Serif SC Variable',
    package: '@fontsource-variable/noto-serif-sc',
    css: ['wght.css'],
    fallback: 'serif',
    coverage: 'Simplified Chinese + Latin',
    role: 'Chinese editorial, cultural, literary, and premium display type'
  },
  'cjk-calligraphy': {
    family: 'Ma Shan Zheng',
    package: '@fontsource/ma-shan-zheng',
    css: ['400.css'],
    fallback: 'cursive',
    coverage: 'Simplified Chinese + Latin',
    role: 'short handwritten Chinese accents and expressive titles'
  },
  'cjk-display': {
    family: 'ZCOOL XiaoWei',
    package: '@fontsource/zcool-xiaowei',
    css: ['400.css'],
    fallback: 'serif',
    coverage: 'Simplified Chinese + Latin',
    role: 'distinctive Chinese display titles with an editorial voice'
  }
};

function usage() {
  console.log('usage:');
  console.log('  node scripts/font-kit.mjs list');
  console.log('  node scripts/font-kit.mjs add FONT_ID HTML');
}

function list() {
  const rows = Object.entries(fonts).map(([id, font]) => ({
    id,
    family: font.family,
    coverage: font.coverage,
    role: font.role
  }));
  console.table(rows);
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function add(id, htmlArg) {
  const font = fonts[id];
  if (!font) throw new Error(`unknown font id: ${id}`);
  if (!htmlArg) throw new Error('missing HTML path');

  const htmlPath = path.resolve(htmlArg);
  const projectDir = path.dirname(htmlPath);
  const packageDir = path.join(modulesDir, ...font.package.split('/'));
  const packageJson = path.join(packageDir, 'package.json');
  try {
    await fs.access(packageJson);
  } catch {
    throw new Error(`font kit is not installed; run ${path.join(scriptDir, 'install-font-kit.sh')}`);
  }

  let html = await fs.readFile(htmlPath, 'utf8');
  const variable = `--font-kit-${id}`;
  if (html.includes(variable)) {
    console.log(`${id} is already present in ${htmlPath}`);
    return;
  }

  const outputDir = path.join(projectDir, 'assets', 'fonts', id);
  await fs.mkdir(outputDir, { recursive: true });
  const cssParts = [];

  for (const cssName of font.css) {
    let css = await fs.readFile(path.join(packageDir, cssName), 'utf8');
    css = css.replace(/,\s*url\((?:"|')?\.\/files\/[^)]*?\.woff(?:"|')?\)\s*format\((?:"|')woff(?:"|')\)/g, '');
    const files = [...css.matchAll(/url\((?:"|')?\.\/files\/([^)'"\s]+\.woff2)(?:"|')?\)/g)].map((match) => match[1]);
    for (const filename of new Set(files)) {
      await fs.copyFile(path.join(packageDir, 'files', filename), path.join(outputDir, filename));
    }
    const relativeDir = path.relative(projectDir, outputDir).split(path.sep).join('/');
    css = css.replace(/url\((?:"|')?\.\/files\/([^)'"\s]+\.woff2)(?:"|')?\)/g, `url("./${relativeDir}/$1")`);
    cssParts.push(stripCssComments(css));
  }

  try {
    await fs.copyFile(path.join(packageDir, 'LICENSE'), path.join(outputDir, 'LICENSE.txt'));
  } catch {
    throw new Error(`font package ${font.package} does not contain a LICENSE file`);
  }

  const faceCss = cssParts.join('\n\n');
  const styleOpen = html.match(/<style(?:\s[^>]*)?>/i);
  if (!styleOpen || styleOpen.index === undefined) throw new Error('HTML has no <style> block');
  const insertAt = styleOpen.index + styleOpen[0].length;
  html = `${html.slice(0, insertAt)}\n${faceCss}\n${html.slice(insertAt)}`;

  const rootMatch = html.match(/:root\s*\{/);
  if (!rootMatch || rootMatch.index === undefined) throw new Error('HTML has no :root block');
  const rootInsert = rootMatch.index + rootMatch[0].length;
  const declaration = `\n    ${variable}: "${font.family}", ${font.fallback};`;
  html = `${html.slice(0, rootInsert)}${declaration}${html.slice(rootInsert)}`;

  await fs.writeFile(htmlPath, html);
  console.log(`added ${font.family} to ${htmlPath}`);
  console.log(`select it with var(${variable})`);
  console.log(`copied font files and license to ${outputDir}`);
}

const [command, id, html] = process.argv.slice(2);
try {
  if (command === 'list') list();
  else if (command === 'add') await add(id, html);
  else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
