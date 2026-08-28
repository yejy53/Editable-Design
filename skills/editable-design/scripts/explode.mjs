#!/usr/bin/env node
/**
 * explode.mjs —— 把已标注图层的海报生成横向拆解展示稿
 *
 *   node explode.mjs <海报 index.html> [输出 HTML]
 *
 * 默认产出同目录 layers.html。完整成稿总览、未标记背景和一级内容模块
 * 从原稿位置动态散开成组件画廊。每个内容叶子仍是独立 DOM，不把整稿压成图片。
 */
import { writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { launch, open, wireTemp } from './_browser.mjs';

const file = process.argv[2];
if (!file || !existsSync(resolve(file))) {
  console.error('用法: node explode.mjs <海报 index.html> [输出 HTML]');
  process.exit(2);
}

const src = resolve(file);
const out = process.argv[3] ? resolve(process.argv[3]) : join(dirname(src), 'layers.html');
if (out === src) {
  console.error('❌ 输出路径不能覆盖源 HTML');
  process.exit(2);
}

const wired = wireTemp(src, '_hf_explode.html');
const browser = await launch();
let code = 0;
try {
  const { page, errors } = await open(browser, wired.file, { waitEditor: true });
  const expected = await page.evaluate(() => {
    const layers = window.__layerEditor.layers();
    const groups = [...window.__layerEditor.state.groups.values()];
    const grouped = new Set(groups.flatMap((group) => group.memberIds));
    const primary = groups.length + layers.filter((layer) => !grouped.has(layer.id)).length;
    const textSupplements = primary < 5 ? layers.filter(({ id, el }) => {
      if (!grouped.has(id)) return false;
      const role = (el.dataset.explodeRole || 'copy').trim();
      if (['surface', 'image', 'icon', 'decoration'].includes(role)) return false;
      return Boolean((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim());
    }).length : 0;
    return { layers: layers.length, groups: groups.length, primary, textSupplements, units: primary + textSupplements + 2 };
  });
  const html = await page.evaluate(() => window.__layerEditor.explodedHTML());
  writeFileSync(out, html);

  const { page: result, errors: resultErrors } = await open(browser, out, { width: 1600, height: 1000 });
  await result.waitForSelector('html[data-hf-exploded-ready]', { timeout: 20000 });
  const audit = await result.evaluate(() => ({
    board: !!document.querySelector('.hf-exploded-board'),
    units: document.querySelectorAll('.hf-exploded-item').length,
    layers: document.querySelectorAll('[data-exploded-layer]').length,
    uniqueLayers: new Set([...document.querySelectorAll('[data-exploded-layer]')]
      .map((node) => node.dataset.explodedLayer)).size,
    primary: Number(document.querySelector('.hf-exploded-board')?.dataset.explodedPrimaryCount || 0),
    textSupplements: document.querySelectorAll('.hf-exploded-item[data-exploded-text-supplement]').length,
    bases: document.querySelectorAll('.hf-exploded-base').length,
    overviews: document.querySelectorAll('[data-exploded-overview]').length,
    backgrounds: document.querySelectorAll('[data-exploded-background]').length,
    groups: document.querySelectorAll('.hf-exploded-item[data-exploded-group]').length,
    level: document.querySelector('.hf-exploded-board')?.dataset.explodedLevel,
    drilldownUI: !!document.querySelector('.hf-exploded-nav'),
    theme: document.querySelector('.hf-exploded-board')?.dataset.explodedTheme,
    replay: !!document.querySelector('.hf-exploded-replay'),
    motion: document.documentElement.dataset.hfMotion,
    editorUI: !!document.querySelector('.hf-bar,.hf-panel'),
    centerOccupied: (() => {
      const board = document.querySelector('.hf-exploded-board');
      const width = parseFloat(board?.style.width) || 1;
      return [...document.querySelectorAll('.hf-exploded-item')].some((item) => {
        const left = parseFloat(item.style.left) || 0;
        const itemWidth = parseFloat(item.style.width) || 0;
        return left < width * .58 && left + itemWidth > width * .42;
      });
    })(),
    overflow: document.documentElement.scrollWidth > innerWidth + 1
      || document.documentElement.scrollHeight > innerHeight + 1,
  }));

  console.log(`\n拆解展示 · ${src}\n`);
  console.log(` ${audit.board ? '✅' : '❌'} 横向拆解画布`);
  console.log(` ${audit.uniqueLayers === expected.layers ? '✅' : '❌'} 内容叶子 ${audit.uniqueLayers}/${expected.layers}（${audit.layers} 次呈现）`);
  console.log(` ${audit.units === expected.units ? '✅' : '❌'} 组件总数 ${audit.units}/${expected.units}`);
  console.log(` ${audit.primary === expected.primary && audit.textSupplements === expected.textSupplements ? '✅' : '❌'} 少组件文字补充 一级 ${audit.primary}，文字 ${audit.textSupplements}`);
  console.log(` ${audit.bases === 0 && audit.centerOccupied ? '✅' : '❌'} 无中央大基底`);
  console.log(` ${audit.overviews === 1 && audit.backgrounds === 1 ? '✅' : '❌'} 总览与背景组件 ${audit.overviews}/${audit.backgrounds}`);
  console.log(` ${audit.groups === expected.groups ? '✅' : '❌'} 一级模块 ${audit.groups}/${expected.groups}`);
  console.log(` ${audit.level === '1' && !audit.drilldownUI ? '✅' : '❌'} 仅一级内容拆解`);
  console.log(` ${['light', 'dark'].includes(audit.theme) ? '✅' : '❌'} 明暗主题 ${audit.theme || '未识别'}`);
  console.log(` ${audit.replay && ['played', 'reduced'].includes(audit.motion) ? '✅' : '❌'} 自动播放与重播 ${audit.motion || '未播放'}`);
  console.log(` ${!audit.editorUI ? '✅' : '❌'} 不含编辑器界面`);
  console.log(` ${!audit.overflow ? '✅' : '❌'} 自适应窗口无滚动溢出`);
  const allErrors = [...errors, ...resultErrors];
  if (allErrors.length) console.log(` ❌ 页面报错 ${allErrors.join('; ')}`);

  if (!audit.board || audit.uniqueLayers !== expected.layers || audit.units !== expected.units
    || audit.primary !== expected.primary || audit.textSupplements !== expected.textSupplements
    || audit.bases !== 0 || !audit.centerOccupied || audit.overviews !== 1 || audit.backgrounds !== 1
    || audit.groups !== expected.groups
    || audit.level !== '1' || audit.drilldownUI
    || !['light', 'dark'].includes(audit.theme) || !audit.replay
    || !['played', 'reduced'].includes(audit.motion)
    || audit.editorUI || audit.overflow || allErrors.length) {
    code = 1;
    console.log('\n❌ 拆解稿未通过验收。');
  } else {
    console.log(`\n✅ 已写入 ${out}\n`);
  }
} finally {
  wired.cleanup();
  await browser.close();
}

process.exit(code);
