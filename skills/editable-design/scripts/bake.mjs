#!/usr/bin/env node
/**
 * bake.mjs —— 离线布局固化
 *
 *   node bake.mjs <海报 index.html> [--in-place]
 *
 * 把文档流布局改写成纯绝对定位，视觉零变化。产物此后天然可拖，
 * 打开编辑器时不再需要现场固化（也就不再依赖字体每次都加载成功）。
 *
 * 默认输出 <base>.absolute.html；--in-place 直接覆盖原文件。
 * 验收：所有图层坐标偏差必须 ≤1px，否则不落盘并退出 1。
 */
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { launch, open, probe, diff, wireTemp } from './_browser.mjs';

const file = process.argv[2];
const inPlace = process.argv.includes('--in-place');
if (!file || !existsSync(resolve(file))) {
  console.error('用法: node bake.mjs <海报 index.html> [--in-place]');
  process.exit(2);
}

const src = resolve(file);
const dir = dirname(src);
const out = inPlace ? src : join(dir, `${basename(src, extname(src))}.absolute.html`);

let wired;
try {
  wired = wireTemp(src, '_hf_bake.html');
} catch (err) {
  console.error('❌ ' + err.message);
  process.exit(1);
}

const browser = await launch();
let code = 0;
try {
  // 1. 原始海报作为基准
  const { page: p0, errors: e0 } = await open(browser, src);
  const before = await probe(p0);
  if (!before || !Object.keys(before).length) {
    console.error('❌ 原始海报里没有 data-layer-id 图层，先跑 check-contract.mjs');
    code = 1;
  } else {
    if (e0.length) console.warn('⚠️  原始海报有报错:', e0.join('; '));

    // 2. 挂上编辑器跑固化，取导出结果
    const { page: p1, errors: e1 } = await open(browser, wired.file, { waitEditor: true });
    const baked = await p1.evaluate(() => window.__layerEditor.fullHTML());
    if (e1.length) console.warn('⚠️  固化过程有报错:', e1.join('; '));

    // 3. 先写到临时位置验证，通过了才落到最终路径
    const probeFile = join(dir, '_hf_bake_out.html');
    writeFileSync(probeFile, baked);
    const { page: p2, errors: e2 } = await open(browser, probeFile);
    const after = await probe(p2);
    const d = diff(before, after, 1);
    try { unlinkSync(probeFile); } catch {}

    console.log(`\n固化 · ${basename(src)}\n`);
    console.log(' 图层'.padEnd(24) + '原始 left,top'.padEnd(20) + '固化后 left,top'.padEnd(20) + '偏差');
    for (const r of d.rows) {
      if (r.missing) { console.log(` ${r.id.padEnd(23)}缺失`); continue; }
      console.log(` ${r.id.padEnd(23)}${`${r.a.left}, ${r.a.top}`.padEnd(20)}${`${r.b.left}, ${r.b.top}`.padEnd(20)}${r.d}${r.fail ? '  ❌' : ''}`);
    }
    console.log(`\n 最大偏差 ${d.worst}px　图层 ${d.rows.length} 个　产物 ${(baked.length / 1024).toFixed(1)}KB`);

    const clean = !/hf-|layer-editor/.test(baked);
    if (!clean) console.log(' ⚠️  产物中检测到编辑器残留');
    if (e2.length) console.log(' ⚠️  产物加载有报错:', e2.join('; '));

    if (d.ok && clean) {
      writeFileSync(out, baked);
      console.log(`\n✅ 视觉零偏差，已写入 ${out}\n`);
    } else {
      console.log('\n❌ 未通过验收，产物已丢弃。');
      console.log('   偏差不为 0 通常意味着：契约未满足（先跑 check-contract.mjs），');
      console.log('   或存在固化规则未覆盖的布局（float / sticky / 伪元素撑高 / writing-mode）。\n');
      code = 1;
    }
  }
} finally {
  wired.cleanup();
  await browser.close();
}
process.exit(code);
