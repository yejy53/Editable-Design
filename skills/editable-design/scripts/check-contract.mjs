#!/usr/bin/env node
/**
 * check-contract.mjs —— 检查一张海报是否满足可编辑性契约
 *
 *   node check-contract.mjs <海报 index.html> [--json]
 *
 * 退出码 0 = 通过，1 = 有违规，2 = 用法/环境错误。
 * 违规项交给 agent 修（改成什么值取决于设计意图），修完重跑。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, open, probe, diff } from './_browser.mjs';

const file = process.argv[2];
const asJson = process.argv.includes('--json');
if (!file || !existsSync(resolve(file))) {
  console.error('用法: node check-contract.mjs <海报 index.html> [--json]');
  process.exit(2);
}

const report = { file: resolve(file), pass: true, checks: [], hints: {} };
const add = (id, ok, msg, fix) => {
  report.checks.push({ id, ok, msg, fix });
  if (!ok) report.pass = false;
};

const browser = await launch();
try {
  const { page, errors } = await open(browser, file, { width: 1400, height: 1000 });

  const info = await page.evaluate(() => {
    const cv = document.querySelector('[data-canvas-width]') || document.querySelector('.poster-canvas');
    if (!cv) return { canvas: false };
    const cs = getComputedStyle(cv);
    const layers = [...cv.querySelectorAll('[data-layer-id]')];
    const ids = layers.map((l) => l.dataset.layerId);
    const groupNodes = [...cv.querySelectorAll('[data-explode-group]')];
    const groupIds = groupNodes.map((n) => (n.dataset.explodeGroup || '').trim());
    const groupSet = new Set(groupIds.filter(Boolean));
    const allowedRoles = new Set(['surface', 'image', 'copy', 'icon', 'decoration']);
    const groups = groupNodes.map((node) => {
      const id = (node.dataset.explodeGroup || '').trim();
      const members = layers.filter((layer) =>
        layer.closest('[data-explode-group]') === node
        || (layer.dataset.explodeParent || '').trim() === id);
      return {
        id,
        label: (node.dataset.explodeLabel || '').trim(),
        members: [...new Set(members)].map((layer) => layer.dataset.layerId),
      };
    });

    // 编辑器会把每个文字叶子自动标成 hf-slot，并用命中位置进入编辑。
    // 像素没有重叠不代表交互框没有重叠；若 slot 中心被另一个图层截获，
    // 双击看似点中文字，实际却永远进不了编辑态。
    const blockedTextTargets = [];
    const textSlots = (root) => {
      const out = [];
      (function walk(node) {
        if (node instanceof SVGElement) return;
        const ownText = [...node.childNodes]
          .some((child) => child.nodeType === 3 && child.textContent.trim());
        if (!node.children.length || ownText) {
          if (node.textContent.trim()) out.push(node);
          return;
        }
        for (const child of node.children) walk(child);
      })(root);
      return out;
    };
    for (const layer of layers) {
      for (const slot of textSlots(layer)) {
        slot.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = slot.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        const top = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        const owner = top?.closest('[data-layer-id]');
        if (owner !== layer) {
          blockedTextTargets.push({
            layer: layer.dataset.layerId,
            text: slot.textContent.trim().replace(/\s+/g, ' ').slice(0, 24),
            blocker: owner?.dataset.layerId || top?.tagName?.toLowerCase() || '(none)',
          });
        }
      }
    }
    window.scrollTo(0, 0);

    // 候选漏标块：有文字、不属于任何图层、且内部也不含图层。
    // 最后一条很关键 —— 图层的祖先容器（如 .content / .footer）本身
    // 没有 data-layer-id，但它不是漏标，只是包装。
    const unlabeled = [];
    for (const el of cv.querySelectorAll('*')) {
      if (el.closest('[data-layer-id]') || el instanceof SVGElement) continue;
      if (el.querySelector('[data-layer-id]')) continue;
      if (!el.textContent.trim()) continue;
      if (unlabeled.some((o) => o.node.contains(el))) continue;
      unlabeled.push({ node: el });
    }

    // 静态定位 vw/vh 的出现处，便于修复时直接跳到那一行
    const viewportUnits = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        if (!r.cssText) continue;
        for (const m of r.cssText.matchAll(/[^;{}]*\b\d*\.?\d+v(?:w|h|min|max)\b[^;{}]*/g)) {
          const frag = m[0].trim();
          const sel = r.selectorText || r.conditionText || '@rule';
          if (viewportUnits.length < 25) viewportUnits.push(`${sel} { ${frag} }`);
        }
      }
    }

    return {
      canvas: true,
      declaredW: +cv.dataset.canvasWidth || null,
      declaredH: +cv.dataset.canvasHeight || null,
      actualW: Math.round(cv.getBoundingClientRect().width),
      actualH: Math.round(cv.getBoundingClientRect().height),
      position: cs.position,
      layerCount: layers.length,
      duplicateIds: ids.filter((v, i) => ids.indexOf(v) !== i),
      emptyIds: ids.filter((v) => !v || !v.trim()).length,
      nestedLayers: layers.filter((layer) => layer.querySelector('[data-layer-id]'))
        .map((layer) => layer.dataset.layerId),
      groups,
      duplicateGroups: groupIds.filter((v, i) => groupIds.indexOf(v) !== i),
      emptyGroups: groupIds.filter((v) => !v).length,
      groupsAlsoLayers: groupNodes.filter((node) => node.hasAttribute('data-layer-id'))
        .map((node) => node.dataset.explodeGroup || '(empty)'),
      nestedGroups: groupNodes.filter((node) => node.parentElement?.closest('[data-explode-group]'))
        .map((node) => node.dataset.explodeGroup || '(empty)'),
      orphanParents: layers.filter((layer) => {
        const parent = (layer.dataset.explodeParent || '').trim();
        return parent && !groupSet.has(parent);
      }).map((layer) => `${layer.dataset.layerId}→${layer.dataset.explodeParent}`),
      invalidRoles: layers.filter((layer) => {
        const role = (layer.dataset.explodeRole || '').trim();
        return role && !allowedRoles.has(role);
      }).map((layer) => `${layer.dataset.layerId}:${layer.dataset.explodeRole}`),
      blockedTextTargets,
      unlabeled: unlabeled.map((o) => ({
        tag: o.node.tagName.toLowerCase(),
        cls: (typeof o.node.className === 'string' ? o.node.className : '') || '-',
        text: o.node.textContent.trim().replace(/\s+/g, ' ').slice(0, 34),
      })),
      viewportUnits,
      fontStatus: document.fonts.status,
      /* 声明了但没被用到的 @font-face 会一直是 unloaded，这是浏览器按需加载的
         正常行为，仅作提示。注意 Google Fonts 把中文字体切成上百个
         unicode-range 分片，同一 family 下必然部分 loaded 部分 unloaded，
         所以只有「没有任何分片被加载」才算这个 family 真的没用上。 */
      idleFonts: (() => {
        const tally = new Map();
        for (const f of document.fonts) {
          const cur = tally.get(f.family) || { loaded: 0 };
          if (f.status === 'loaded') cur.loaded++;
          tally.set(f.family, cur);
        }
        return [...tally].filter(([, v]) => v.loaded === 0).map(([k]) => k).slice(0, 10);
      })(),
    };
  });

  if (!info.canvas) {
    add('C1-canvas', false, '找不到画布根节点',
      '给海报根节点加 data-canvas-width / data-canvas-height（或使用 class="poster-canvas"）');
  } else {
    add('C1-canvas', true, `画布 ${info.actualW}×${info.actualH}`);

    const declared = info.declaredW && info.declaredH;
    add('C1-declared', !!declared,
      declared ? `已声明 data-canvas-width/height = ${info.declaredW}×${info.declaredH}` : '缺少 data-canvas-width / data-canvas-height',
      '在画布根节点上声明 data-canvas-width="<宽>" data-canvas-height="<高>"');

    if (declared) {
      const match = Math.abs(info.declaredW - info.actualW) <= 1 && Math.abs(info.declaredH - info.actualH) <= 1;
      add('C1-match', match,
        match ? '声明尺寸与实际渲染尺寸一致' : `声明 ${info.declaredW}×${info.declaredH} 与实际 ${info.actualW}×${info.actualH} 不一致`,
        '把画布宽高改成 px 写死，并与 data-canvas-* 的声明保持一致');
    }

    add('C1-position', ['relative', 'absolute', 'fixed'].includes(info.position),
      `画布 position: ${info.position}`,
      '画布需要 position:relative，否则图层没有确定的包含块');

    add('C3-layers', info.layerCount > 0,
      `找到 ${info.layerCount} 个 data-layer-id 图层`,
      '给每个语义模块加 data-layer-id（判据：使用者是否会想单独移动它）');

    add('C3-unique', info.duplicateIds.length === 0 && info.emptyIds === 0,
      info.duplicateIds.length ? `data-layer-id 重复: ${[...new Set(info.duplicateIds)].join(', ')}` : 'data-layer-id 无重复无空值',
      'data-layer-id 必须唯一且非空');

    add('C3-flat', info.nestedLayers.length === 0,
      info.nestedLayers.length ? `data-layer-id 不可嵌套: ${info.nestedLayers.join(', ')}` : 'data-layer-id 叶子图层无嵌套',
      '把共同容器改为不带 data-layer-id 的 data-explode-group，实际可编辑单元保留为叶子图层');

    const groupIdsOk = info.duplicateGroups.length === 0 && info.emptyGroups === 0;
    add('C4-group-ids', groupIdsOk,
      !info.groups.length ? '未声明一级内容分组（使用扁平组件模式）'
        : groupIdsOk ? `找到 ${info.groups.length} 个唯一分组` : `分组 id 重复或为空: ${[...new Set(info.duplicateGroups)].join(', ') || '(empty)'}`,
      'data-explode-group 必须唯一且非空');

    const groupShapeOk = info.groupsAlsoLayers.length === 0 && info.nestedGroups.length === 0;
    add('C4-group-shape', groupShapeOk,
      groupShapeOk ? '分组容器不参与拖拽且不互相嵌套'
        : `无效分组容器: ${[...info.groupsAlsoLayers, ...info.nestedGroups].join(', ')}`,
      '分组容器只加 data-explode-group，不加 data-layer-id，也不要嵌套另一个分组容器');

    const usefulGroups = info.groups.filter((group) => group.members.length >= 2).length;
    const membersOk = info.groups.every((group) => group.members.length >= 2)
      && info.orphanParents.length === 0 && info.invalidRoles.length === 0;
    add('C4-group-members', membersOk,
      !info.groups.length ? '无需分组成员检查'
        : membersOk ? `${usefulGroups} 个分组均含至少 2 个叶子图层`
          : `分组成员/角色无效${info.orphanParents.length ? `；孤立归属 ${info.orphanParents.join(', ')}` : ''}${info.invalidRoles.length ? `；未知角色 ${info.invalidRoles.join(', ')}` : ''}`,
      '每个分组至少包含 2 个叶子 data-layer-id；角色仅用 surface/image/copy/icon/decoration');

    add('C5-text-hit', info.blockedTextTargets.length === 0,
      info.blockedTextTargets.length
        ? `文字编辑命中区被遮挡: ${info.blockedTextTargets.slice(0, 8)
          .map((item) => `${item.layer}→${item.blocker} (${item.text})`).join(', ')}`
        : '所有文字编辑命中区均可到达',
      '调整重叠图层的位置、pointer-events 或 DOM/z-index 顺序，使文字槽中心能命中所属 data-layer-id');
  }

  /* C2 的实质检测：调整同一真实浏览器页面的视口，图层坐标不应变化。
     这比正则查 vh 精确得多 —— 百分比、vmin、calc() 混用都能抓到。 */
  const m1 = await probe(page);
  await page.setViewport({ width: 1000, height: 1500, deviceScaleFactor: 1 });
  await page.evaluate(() => new Promise((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
  }));
  const m2 = await probe(page);
  const d = diff(m1, m2, 0.5);
  add('C2-viewport', d.ok,
    d.ok ? '调整视口后坐标不变（布局不依赖视口）'
         : `调整视口后坐标发生变化，最大 ${d.worst}px：${d.rows.filter((r) => r.fail).map((r) => r.id).join(', ')}`,
    '布局尺寸不能用 vw / vh / 百分比承担，改为 px 固定值（渐变、纹理等装饰不限）');

  add('fonts', info.fontStatus === 'loaded',
    info.fontStatus === 'loaded' ? '字体加载已完成（document.fonts.status = loaded）' : `字体仍在加载: ${info.fontStatus}`,
    '字体未落地会导致测量到 fallback 字体的坐标；检查网络或字体引用');

  add('runtime', errors.length === 0,
    errors.length ? `页面有 ${errors.length} 处报错` : '页面无控制台报错');

  report.hints = {
    unlabeled: info.unlabeled || [],
    viewportUnits: info.viewportUnits || [],
    idleFonts: info.idleFonts || [],
    pageErrors: errors,
  };
} finally {
  await browser.close();
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

console.log(`\n契约检查 · ${report.file}\n`);
for (const c of report.checks) {
  console.log(` ${c.ok ? '✅' : '❌'} [${c.id}] ${c.msg}`);
  if (!c.ok && c.fix) console.log(`      修法: ${c.fix}`);
}

const { unlabeled, viewportUnits, idleFonts, pageErrors } = report.hints;
if (idleFonts.length) {
  console.log(`\n声明但未被使用的字体（按需加载，正常现象）: ${idleFonts.join(', ')}`);
}
if (viewportUnits.length) {
  console.log(`\n视口单位出现处（供定位，装饰性用途可忽略）:`);
  for (const v of viewportUnits) console.log('   ' + v);
}
if (unlabeled.length) {
  console.log(`\n可能漏标 data-layer-id 的候选块（${unlabeled.length} 个，需人工判断）:`);
  for (const u of unlabeled) console.log(`   <${u.tag} class="${u.cls}">  ${u.text}`);
}
if (pageErrors.length) {
  console.log(`\n页面报错:`);
  for (const e of pageErrors) console.log('   ' + e);
}

console.log(report.pass ? '\n契约通过 ✅ 可以执行 bake.mjs\n' : '\n契约未通过 ❌ 修复后重跑\n');
process.exit(report.pass ? 0 : 1);
