#!/usr/bin/env node
/**
 * verify.mjs —— 编辑器功能验证
 *
 *   node verify.mjs <海报 index.html> [--timings]
 *
 * A 类断言（转换类）：固化视觉零偏差。
 * B 类断言（编辑类）：改完导出、重新加载后 computed style 与几何一致。
 *   —— 编辑功能是「故意改变视觉」的，A 类断言对它们不适用。
 *      B 类要防的是「改得动但导不出去」，尤其字体静默回落成系统字体。
 *
 * 退出码 0 = 全绿，1 = 有失败。
 */
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { launch, open, probe, diff, pixelDiff, wireTemp } from './_browser.mjs';

const file = process.argv[2];
if (!file || !existsSync(resolve(file))) {
  console.error('用法: node verify.mjs <海报 index.html>');
  process.exit(2);
}
const src = resolve(file);
const dir = dirname(src);
const layersOutput = join(dir, 'layers.html');
const showTimings = process.argv.includes('--timings');
const timingStartedAt = Date.now();
let timingMarkedAt = timingStartedAt;
let timingPhase = '启动浏览器';
const timingRows = [];

const markTiming = (nextPhase) => {
  const now = Date.now();
  if (showTimings) timingRows.push({ phase: timingPhase, ms: now - timingMarkedAt });
  timingPhase = nextPhase;
  timingMarkedAt = now;
};

let fails = 0;
let verifiedLayersHTML = '';
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(` ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
};
const group = (t) => {
  markTiming(t);
  console.log(`\n【${t}】`);
};

/** 采集每个图层的 computed style 与几何，用于 B 类往返比对。
 *  不依赖编辑器注入的 class，因此导出物上同样可用。 */
const COLLECT = () => {
  const cv = document.querySelector('[data-canvas-width]') || document.querySelector('.poster-canvas');
  const c = cv.getBoundingClientRect();
  const scale = c.width / (+cv.dataset.canvasWidth || cv.offsetWidth);
  const out = {};
  for (const el of cv.querySelectorAll('[data-layer-id]')) {
    const nodes = [el, ...el.querySelectorAll('*')].filter((n) => !(n instanceof SVGElement));
    const r = el.getBoundingClientRect();
    out[el.dataset.layerId] = {
      left: +((r.left - c.left) / scale).toFixed(1),
      top: +((r.top - c.top) / scale).toFixed(1),
      width: +(r.width / scale).toFixed(1),
      height: +(r.height / scale).toFixed(1),
      fonts: nodes.map((n) => {
        const cs = getComputedStyle(n);
        return `${cs.fontSize}|${cs.fontFamily}`;
      }),
      widths: nodes.map((n) => +(n.getBoundingClientRect().width / scale).toFixed(1)),
      text: el.textContent.replace(/\s+/g, ' ').trim(),
    };
  }
  return out;
};

function compare(a, b) {
  const issues = [];
  for (const id of Object.keys(a)) {
    if (!b[id]) { issues.push(`${id} 在导出物中缺失`); continue; }
    const x = a[id], y = b[id];
    if (Math.abs(x.left - y.left) > 1 || Math.abs(x.top - y.top) > 1) {
      issues.push(`${id} 坐标漂移 ${x.left},${x.top} → ${y.left},${y.top}`);
    }
    if (Math.abs(x.width - y.width) > 1 || Math.abs(x.height - y.height) > 1) {
      issues.push(`${id} 尺寸漂移 ${x.width}×${x.height} → ${y.width}×${y.height}`);
    }
    if (x.text !== y.text) issues.push(`${id} 文本不一致`);
    if (x.fonts.join('#') !== y.fonts.join('#')) {
      const i = x.fonts.findIndex((v, k) => v !== y.fonts[k]);
      issues.push(`${id} 字体/字号不一致: "${x.fonts[i]}" → "${y.fonts[i] ?? '(缺)'}"`);
    }
    // 字体若静默回落成系统字体，computed family 可能不变但渲染宽度会变
    const wBad = x.widths.findIndex((v, k) => Math.abs(v - (y.widths[k] ?? 0)) > 1);
    if (wBad >= 0) issues.push(`${id} 渲染宽度不一致 ${x.widths[wBad]} → ${y.widths[wBad] ?? '(缺)'}（字体可能回落）`);
  }
  for (const id of Object.keys(b)) if (!a[id]) issues.push(`${id} 多出于导出物`);
  return issues;
}

const wired = wireTemp(src, '_hf_verify.html');
const browser = await launch();
try {
  /* ---------- A 类：固化零偏差 ---------- */
  group('A 类 · 固化视觉零偏差');
  const { page: p0 } = await open(browser, src);
  const before = await probe(p0);
  const { page, errors } = await open(browser, wired.file, { waitEditor: true });
  const afterBake = await probe(page);
  const dA = diff(before, afterBake, 1);
  check(`${dA.rows.length} 个图层坐标不变`, dA.ok, `最大偏差 ${dA.worst}px`);

  // 几何一致不等于视觉一致：上下文样式、背景、伪元素和绘制顺序
  // 发生变化时，图层框仍可能完全不动。所以固化类验收必须再过一道像素门。
  // 编辑器里的画布放在固定、可滚动的舞台中，直接截取超出视口的
  // DOM 可能被父层 overflow 裁掉。先导出一份未修改的 baked HTML，
  // 再在同尺寸视口中与原稿比像素，比对的仍然是 bake 结果。
  const bakedFile = join(dir, '_hf_verify_baked.html');
  writeFileSync(bakedFile, await page.evaluate(() => window.__layerEditor.fullHTML()));
  const canvasSize = await p0.evaluate(() => {
    const cv = document.querySelector('[data-canvas-width]') || document.querySelector('.poster-canvas');
    return {
      width: Math.ceil(+cv.dataset.canvasWidth || cv.offsetWidth),
      height: Math.ceil(+cv.dataset.canvasHeight || cv.offsetHeight),
    };
  });
  const pixelViewport = {
    width: Math.max(1600, Math.min(8192, canvasSize.width + 20)),
    height: Math.max(1200, Math.min(8192, canvasSize.height + 20)),
    deviceScaleFactor: 1,
  };
  await p0.setViewport(pixelViewport);
  const { page: pBaked, errors: eBaked } = await open(browser, bakedFile, pixelViewport);
  const pixels = await pixelDiff(
    p0, '[data-canvas-width],.poster-canvas',
    pBaked, '[data-canvas-width],.poster-canvas',
  );
  // 少量 mix-blend-mode / 阴影在被提升进新的 stacking context 后会产生
  // 亚像素级合成差异；同时约束“变化像素比例”和“平均通道差”，可容纳
  // 这种不可见噪声，又会拦住丢背景、错层、去旋转等真实视觉漂移。
  const pixelOK = eBaked.length === 0 && pixels.ok
    && pixels.changedRatio <= 0.005 && pixels.meanAbs <= 0.05;
  check('画布像素级无可见漂移', pixelOK, pixels.reason
    || `变化 ${(pixels.changedRatio * 100).toFixed(3)}%，平均通道差 ${pixels.meanAbs.toFixed(4)}`);
  await pBaked.close();
  try { unlinkSync(bakedFile); } catch {}

  const scale = await page.evaluate(() => window.__layerEditor.state.scale);
  const at = (sel) => page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  // puppeteer 的 clickCount:2 只改参数、不真的按两次，detail 恒为 1，
  // 浏览器不会合成 dblclick。必须手动发两轮 down/up。
  const dbl = async (sel) => {
    const { x, y } = await at(sel);
    await page.mouse.move(x, y);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
    await new Promise((r) => setTimeout(r, 180));
  };
  const layerIds = await page.evaluate(() => window.__layerEditor.layers().map((l) => l.id));
  const groupInfo = await page.evaluate(() => [...window.__layerEditor.state.groups.values()].map((group) => ({
    id: group.id,
    label: group.label,
    members: group.memberIds,
  })));
  const explodeExpectation = await page.evaluate(() => {
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
    return { primary, textSupplements, units: primary + textSupplements + 2 };
  });
  const expectedExplodedUnits = explodeExpectation.units;
  const first = await page.evaluate(() => {
    const layers = window.__layerEditor.layers();
    return layers.find(({ el }) =>
      el.classList.contains('hf-slot') || el.querySelector('.hf-slot'))?.id
      || layers[0]?.id;
  });
  const sel1 = `[data-layer-id="${first}"]`;
  const geomOf = (id) => page.evaluate((i) => {
    const el = document.querySelector(`[data-layer-id="${i}"]`);
    return el ? { left: parseFloat(el.style.left), top: parseFloat(el.style.top) } : null;
  }, id);
  const boxOf = (id) => page.evaluate((i) => {
    const el = document.querySelector(`[data-layer-id="${i}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const scale = window.__layerEditor.state.scale;
    return {
      left: parseFloat(el.style.left), top: parseFloat(el.style.top),
      width: r.width / scale, height: r.height / scale,
      widthLocked: el.dataset.hfWidthLocked === '1',
      heightLocked: el.dataset.hfHeightLocked === '1',
    };
  }, id);

  /* ---------- 拖拽 ---------- */
  group('拖拽');
  const g0 = await geomOf(first);
  const pt = await at(sel1);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 60, pt.y + 40, { steps: 12 });
  await page.mouse.up();
  const g1 = await geomOf(first);
  const moved = Math.abs(g1.left - g0.left) > 20 && Math.abs(g1.top - g0.top) > 10;
  check('位移按画布缩放换算', moved,
    `屏幕 +60,+40 → 画布 +${(g1.left - g0.left).toFixed(1)},+${(g1.top - g0.top).toFixed(1)}（缩放 ${Math.round(scale * 100)}%，含吸附修正）`);
  check('拖拽未误选文字', await page.evaluate(() => getSelection().toString() === ''));
  await page.evaluate(() => window.__layerEditor.undo());
  const g2 = await geomOf(first);
  check('撤销精确复位', Math.abs(g2.left - g0.left) < 0.5 && Math.abs(g2.top - g0.top) < 0.5);
  const release0 = await geomOf(first);
  await page.evaluate((id) => {
    const el = window.__layerEditor.layers().find((item) => item.id === id).el;
    const rect = el.getBoundingClientRect();
    const init = { bubbles: true, pointerId: 97, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', {
      ...init, button: 0, buttons: 1, clientX: rect.left + 4, clientY: rect.top + 4,
    }));
    el.dispatchEvent(new PointerEvent('pointermove', {
      ...init, button: -1, buttons: 0, clientX: rect.left + 90, clientY: rect.top + 60,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      ...init, button: 0, buttons: 0, clientX: rect.left + 90, clientY: rect.top + 60,
    }));
  }, first);
  const release1 = await geomOf(first);
  check('鼠标已松开时不会残留拖拽', Math.abs(release1.left - release0.left) < 0.5
    && Math.abs(release1.top - release0.top) < 0.5);
  const escape0 = await geomOf(first);
  const escapeAt = await at(`[data-layer-id="${first}"]`);
  await page.mouse.move(escapeAt.x, escapeAt.y);
  await page.mouse.down();
  await page.mouse.move(escapeAt.x + 42, escapeAt.y + 24, { steps: 3 });
  const escapeMoved = await geomOf(first);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const escape1 = await geomOf(first);
  check('Esc 可取消进行中的拖拽', Math.abs(escapeMoved.left - escape0.left) > 5
    && Math.abs(escape1.left - escape0.left) < 0.5
    && Math.abs(escape1.top - escape0.top) < 0.5);

  /* ---------- 宽高缩放 ---------- */
  group('宽高缩放');
  await page.evaluate((id) => {
    const layer = window.__layerEditor.layers().find((item) => item.id === id);
    window.__layerEditor.select(layer.el);
  }, first);
  check('选中后显示八个缩放手柄', await page.evaluate(() =>
    document.querySelectorAll('.hf-resize-handle').length === 8
    && !document.querySelector('.hf-resize-overlay').hidden));
  check('缩放手柄具有宽松点击热区', await page.evaluate(() =>
    [...document.querySelectorAll('.hf-resize-handle')].every((handle) => {
      const rect = handle.getBoundingClientRect();
      return rect.width >= 28 && rect.height >= 28;
    })));
  const size0 = await boxOf(first);
  const dragHandle = async (selector, dx, dy) => {
    const handle = await page.$(selector);
    const box = await handle?.boundingBox();
    if (!box) return false;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 });
    await page.mouse.up();
    return true;
  };
  const eastReady = await dragHandle('.hf-resize-handle.e', 52, 0);
  const sizeW = await boxOf(first);
  check('左右手柄只改变宽度', eastReady
    && sizeW.width > size0.width + 20
    && Math.abs(sizeW.height - size0.height) < 0.5
    && sizeW.widthLocked && !sizeW.heightLocked,
  `${size0.width.toFixed(1)}×${size0.height.toFixed(1)} → ${sizeW.width.toFixed(1)}×${sizeW.height.toFixed(1)}`);
  const southReady = await dragHandle('.hf-resize-handle.s', 0, 38);
  const sizeWH = await boxOf(first);
  check('上下手柄只改变高度', southReady
    && sizeWH.height > sizeW.height + 15
    && Math.abs(sizeWH.width - sizeW.width) < 0.5
    && sizeWH.widthLocked && sizeWH.heightLocked,
  `${sizeW.width.toFixed(1)}×${sizeW.height.toFixed(1)} → ${sizeWH.width.toFixed(1)}×${sizeWH.height.toFixed(1)}`);
  const resizedSnapshot = await page.evaluate((id) =>
    window.__layerEditor.snapshot().layers.find((layer) => layer.id === id), first);
  check('草稿快照保留手动宽高', resizedSnapshot?.manualWidth === true
    && resizedSnapshot?.manualHeight === true && !!resizedSnapshot?.height);
  const lockedWidth = sizeWH.width;
  await page.evaluate((id) => {
    const layer = window.__layerEditor.layers().find((item) => item.id === id);
    window.__layerEditor.scaleFont(layer.el, 1.08);
  }, first);
  const sizeAfterFont = await boxOf(first);
  check('手动宽度不被文字或字号自动撑回', Math.abs(sizeAfterFont.width - lockedWidth) < 0.5,
    `${lockedWidth.toFixed(1)} → ${sizeAfterFont.width.toFixed(1)}`);
  await page.evaluate(() => {
    window.__layerEditor.undo();
    window.__layerEditor.undo();
    window.__layerEditor.undo();
  });
  const sizeBack = await boxOf(first);
  check('撤销恢复原始宽高与自动适配状态', Math.abs(sizeBack.width - size0.width) < 0.5
    && Math.abs(sizeBack.height - size0.height) < 0.5
    && !sizeBack.widthLocked && !sizeBack.heightLocked,
  `${sizeBack.width.toFixed(1)}×${sizeBack.height.toFixed(1)}`);
  const resizeEscape0 = await boxOf(first);
  const seHandle = await page.$('.hf-resize-handle.se');
  const seBox = await seHandle?.boundingBox();
  if (seBox) {
    const x = seBox.x + seBox.width / 2;
    const y = seBox.y + seBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 44, y + 32, { steps: 3 });
    const resizeEscapeMoved = await boxOf(first);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const resizeEscape1 = await boxOf(first);
    check('Esc 可取消进行中的缩放', Math.abs(resizeEscapeMoved.width - resizeEscape0.width) > 5
      && Math.abs(resizeEscape1.width - resizeEscape0.width) < 1
      && Math.abs(resizeEscape1.height - resizeEscape0.height) < 1);
  } else {
    check('Esc 可取消进行中的缩放', false, '未找到右下角手柄');
  }

  /* ---------- 文本编辑 ---------- */
  group('文本编辑');
  const slotSel = await page.evaluate((id) => {
    const layer = document.querySelector(`[data-layer-id="${id}"]`);
    const slot = layer.classList.contains('hf-slot') ? layer : layer.querySelector('.hf-slot');
    if (!slot) return null;
    slot.setAttribute('data-hf-probe', '1');
    return '[data-hf-probe]';
  }, first);
  if (!slotSel) {
    check('图层内找到文本槽', false, `${first} 无文本槽`);
  } else {
    const origText = await page.evaluate((s) => document.querySelector(s).textContent, slotSel);
    await dbl(slotSel);
    check('双击进入编辑态', await page.evaluate(() => !!document.querySelector('.hf-editing')));
    check('已设为 plaintext-only',
      await page.evaluate(() => document.querySelector('.hf-editing')?.getAttribute('contenteditable') === 'plaintext-only'));
    check('内容已全选', await page.evaluate((t) => getSelection().toString().trim() === t.trim(), origText));

    const posBefore = await geomOf(first);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    const posAfter = await geomOf(first);
    check('编辑态方向键不挪图层', posBefore.left === posAfter.left && posBefore.top === posAfter.top);

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 120));
    check('Esc 回滚原文', await page.evaluate((s, t) => document.querySelector(s).textContent === t, slotSel, origText));

    await dbl(slotSel);
    await page.evaluate((s) => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector(s));
      const g = getSelection(); g.removeAllRanges(); g.addRange(r);
    }, slotSel);
    await page.keyboard.type('验证文本ABC');
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 200));
    check('Enter 提交改动', await page.evaluate((s) => document.querySelector(s).textContent === '验证文本ABC', slotSel));
    await page.evaluate(() => window.__layerEditor.undo());
    check('⌘Z 还原文字', await page.evaluate((s, t) => document.querySelector(s).textContent === t, slotSel, origText));
  }

  /* ---------- 多字号结构安全 ---------- */
  const multi = await page.evaluate(() => {
    for (const l of window.__layerEditor.layers()) {
      const slots = [...l.el.querySelectorAll('.hf-slot')];
      if (slots.length >= 2) {
        const sizes = new Set(slots.map((s) => getComputedStyle(s).fontSize));
        if (sizes.size >= 2) {
          slots[0].parentElement.setAttribute('data-hf-multi', '1');
          return { id: l.id, n: slots.length };
        }
      }
    }
    return null;
  });
  if (multi) {
    group(`结构安全 · ${multi.id}（多字号拼排）`);
    const structBefore = await page.evaluate(() => {
      const box = document.querySelector('[data-hf-multi]');
      return [...box.children].map((c) => `${c.tagName}.${(c.className || '').replace(/hf-\S+/g, '').trim()}`).join(',');
    });
    const target = await page.evaluate(() => {
      const box = document.querySelector('[data-hf-multi]');
      const slot = box.querySelector('.hf-slot');
      slot.setAttribute('data-hf-probe2', '1');
      return { fs: getComputedStyle(slot).fontSize, color: getComputedStyle(slot).color };
    });
    await dbl('[data-hf-probe2]');
    await page.keyboard.type('99');
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 200));
    const structAfter = await page.evaluate(() => {
      const box = document.querySelector('[data-hf-multi]');
      const slot = box.querySelector('[data-hf-probe2]');
      return {
        children: [...box.children].map((c) => `${c.tagName}.${(c.className || '').replace(/hf-\S+/g, '').trim()}`).join(','),
        text: slot.textContent,
        fs: getComputedStyle(slot).fontSize,
        color: getComputedStyle(slot).color,
      };
    });
    check('兄弟 span 结构未被破坏', structBefore === structAfter.children, structAfter.children);
    check('文字已改', structAfter.text === '99');
    check('字号未变', structAfter.fs === target.fs, structAfter.fs);
    check('颜色未变', structAfter.color === target.color);
    await page.evaluate(() => window.__layerEditor.undo());
  }

  /* ---------- 字号 ---------- */
  group('字号');
  const fsBefore = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).fontSize, slotSel || sel1);
  await page.evaluate((id) => {
    const l = window.__layerEditor.layers().find((x) => x.id === id);
    window.__layerEditor.select(l.el);
    window.__layerEditor.scaleFont(l.el, 1.08);
  }, first);
  await new Promise((r) => setTimeout(r, 120));
  const fsAfter = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).fontSize, slotSel || sel1);
  check('A+ 放大字号', parseFloat(fsAfter) > parseFloat(fsBefore), `${fsBefore} → ${fsAfter}`);
  await page.evaluate(() => window.__layerEditor.undo());
  const fsBack = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).fontSize, slotSel || sel1);
  check('撤销恢复字号', fsBack === fsBefore, fsBack);

  /* ---------- 字体 ---------- */
  group('字体');
  const opts = await page.evaluate(() => window.__layerEditor.fontOptions());
  check('从 :root 解析出字体族', opts.length > 0, opts.map((o) => o.label).join(' / ') || '（无）');
  let fontChanged = false;
  if (opts.length > 1) {
    const ffBefore = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).fontFamily, slotSel || sel1);
    // 选一个与当前不同的字体族
    for (const o of opts) {
      await page.evaluate((id, v) => {
        const l = window.__layerEditor.layers().find((x) => x.id === id);
        window.__layerEditor.setFont(l.el, v);
      }, first, o.value);
      await new Promise((r) => setTimeout(r, 120));
      const now = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).fontFamily, slotSel || sel1);
      if (now !== ffBefore) { fontChanged = true; break; }
      await page.evaluate(() => window.__layerEditor.undo());
    }
    check('切换字体生效', fontChanged);
  } else if (opts.length === 1) {
    check('单一字体栈无需切换', true, opts[0].label);
  }

  /* ---------- 删除图层 ---------- */
  group('删除图层');
  const victim = layerIds.find((id) => id !== first && id !== 'hero_photo') || layerIds[layerIds.length - 1];
  const othersBefore = await page.evaluate(COLLECT);
  await page.evaluate((id) => {
    const l = window.__layerEditor.layers().find((x) => x.id === id);
    window.__layerEditor.removeLayer(l.el);
  }, victim);
  await new Promise((r) => setTimeout(r, 120));
  check(`${victim} 已从 DOM 移除`, await page.evaluate((id) => !document.querySelector(`[data-layer-id="${id}"]`), victim));
  const othersAfter = await page.evaluate(COLLECT);
  const untouched = Object.keys(othersAfter).every((id) =>
    Math.abs(othersAfter[id].left - othersBefore[id].left) < 0.5
    && Math.abs(othersAfter[id].top - othersBefore[id].top) < 0.5);
  check('其他图层坐标不受影响', untouched);
  await page.evaluate(() => window.__layerEditor.undo());
  await new Promise((r) => setTimeout(r, 120));
  check('撤销恢复图层', await page.evaluate((id) => !!document.querySelector(`[data-layer-id="${id}"]`), victim));
  const restored = await page.evaluate(COLLECT);
  check('恢复后位置正确', Object.keys(othersBefore).every((id) =>
    restored[id] && Math.abs(restored[id].left - othersBefore[id].left) < 0.5));

  /* ---------- 拆解视图 ---------- */
  group('拆解视图');
  const composedBeforeSpread = await page.evaluate(COLLECT);
  const composedScreenHeight = await page.evaluate(() =>
    document.querySelector('.hf-canvas').getBoundingClientRect().height);
  const enterMotion = await page.evaluate(async () => {
    void window.__layerEditor.setExploded(true);
    await new Promise((r) => setTimeout(r, 180));
    return {
      running: document.getAnimations().filter((a) => a.playState === 'running').length,
      scanning: document.querySelector('.hf-exploded-scan-beam')?.getAnimations()
        .some((a) => a.playState === 'running') || false,
      labelsVisible: [...document.querySelectorAll('.hf-exploded-label')].some((label) =>
        Number.parseFloat(getComputedStyle(label).opacity) > .05),
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches
        || new URLSearchParams(location.search).get('motion') === '0',
    };
  });
  check('拆解前先执行扫描特效', enterMotion.reduced || enterMotion.scanning,
    enterMotion.reduced ? '已遵循 reduced-motion' : '扫描束运行中');
  check('进入时执行分层散开动画', enterMotion.reduced || enterMotion.running > 0,
    enterMotion.reduced ? '已遵循 reduced-motion' : `${enterMotion.running} 个动画运行中`);
  check('扫描与散开期间不放大模块标签', enterMotion.reduced || !enterMotion.labelsVisible,
    enterMotion.reduced ? '已遵循 reduced-motion' : '运动阶段标签保持隐藏');
  await page.waitForFunction(() => !window.__layerEditor.state.transitioning, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 220));
  const liveSpread = await page.evaluate(() => ({
    active: document.body.classList.contains('hf-exploded-on'),
    board: !!document.querySelector('.hf-exploded-board'),
    scanHeight: document.querySelector('.hf-exploded-scan')?.getBoundingClientRect().height || 0,
    boardHeight: document.querySelector('.hf-exploded-board')?.getBoundingClientRect().height || 0,
    laneCount: window.__layerEditor.state.spread?.laneCount || 0,
    units: document.querySelectorAll('.hf-exploded-board .hf-exploded-item').length,
    layers: document.querySelectorAll('.hf-exploded-board [data-exploded-layer]').length,
    uniqueLayers: new Set([...document.querySelectorAll('.hf-exploded-board [data-exploded-layer]')]
      .map((node) => node.dataset.explodedLayer)).size,
    primaryContent: Number(document.querySelector('.hf-exploded-board')?.dataset.explodedPrimaryCount || 0),
    textSupplements: document.querySelectorAll('.hf-exploded-item[data-exploded-text-supplement]').length,
    bases: document.querySelectorAll('.hf-exploded-base').length,
    overviews: document.querySelectorAll('.hf-exploded-item[data-exploded-overview]').length,
    backgrounds: document.querySelectorAll('.hf-exploded-item[data-exploded-background]').length,
    groups: document.querySelectorAll('.hf-exploded-item[data-exploded-group]').length,
    gallery: (() => {
      const board = document.querySelector('.hf-exploded-board');
      const width = parseFloat(board?.style.width) || 1;
      const height = parseFloat(board?.style.height) || 1;
      const items = [...document.querySelectorAll('.hf-exploded-item')].map((item) => ({
        left: parseFloat(item.style.left) || 0,
        top: parseFloat(item.style.top) || 0,
        width: parseFloat(item.style.width) || 0,
        height: parseFloat(item.style.height) || 0,
      }));
      const minX = Math.min(...items.map((item) => item.left));
      const maxX = Math.max(...items.map((item) => item.left + item.width));
      const special = [...document.querySelectorAll('[data-exploded-overview],[data-exploded-background]')]
        .map((item) => (parseFloat(item.style.height) || 0) / height);
      return {
        span: (maxX - minX) / width,
        centerOccupied: items.some((item) => item.left < width * .58 && item.left + item.width > width * .42),
        specialMin: Math.min(...special), specialMax: Math.max(...special),
      };
    })(),
    labelsVisible: [...document.querySelectorAll('.hf-exploded-label')].some((label) =>
      Number.parseFloat(getComputedStyle(label).opacity) > .05),
    labelsNamed: [...document.querySelectorAll('.hf-exploded-item[data-exploded-group]')].every((item) =>
      Boolean(item.title?.trim())),
    hasDrilldownAPI: typeof window.__layerEditor.openExplodedGroup === 'function',
    level: document.querySelector('.hf-exploded-board')?.dataset.explodedLevel,
    theme: document.querySelector('.hf-exploded-board')?.dataset.explodedTheme,
    expectedTheme: (() => {
      const cs = getComputedStyle(document.querySelector('.hf-canvas'));
      const parse = (raw) => {
        const rgba = String(raw).match(/rgba?\((\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*(?:\.\d+)?))?/i);
        if (rgba) return { rgb: rgba.slice(1, 4).map(Number), alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
        const hex = String(raw).match(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i);
        if (!hex) return null;
        const v = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
        return { rgb: [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)), alpha: 1 };
      };
      let color = parse(cs.backgroundColor);
      if (!color || color.alpha <= .25) {
        const tokens = String(cs.backgroundImage).match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/ig) || [];
        color = tokens.map(parse).find((entry) => entry && entry.alpha > .65) || null;
      }
      const rgb = color?.rgb || [244, 241, 232];
      const linear = rgb.map((n) => {
        const c = n / 255;
        return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      });
      return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722 > .52 ? 'light' : 'dark';
    })(),
    sourceVisible: getComputedStyle(document.querySelector('.hf-stage > .hf-canvas')).display !== 'none',
  }));
  check('可切换到横向拆解画布', liveSpread.active && liveSpread.board && !liveSpread.sourceVisible);
  check('全部内容叶子均归入一级拆解', liveSpread.uniqueLayers === layerIds.length,
    `${liveSpread.uniqueLayers}/${layerIds.length} 个唯一叶子，${liveSpread.layers} 次呈现`);
  check('完整总览与背景均作为普通组件', liveSpread.overviews === 1
    && liveSpread.backgrounds === 1 && liveSpread.bases === 0,
  `总览 ${liveSpread.overviews}、背景 ${liveSpread.backgrounds}、固定基底 ${liveSpread.bases}`);
  check('组件画廊数量完整', liveSpread.units === expectedExplodedUnits,
    `${liveSpread.units}/${expectedExplodedUnits}`);
  check('少组件时补入分组文字叶子', liveSpread.primaryContent === explodeExpectation.primary
    && liveSpread.textSupplements === explodeExpectation.textSupplements,
  `一级组件 ${liveSpread.primaryContent}，文字补充 ${liveSpread.textSupplements}`);
  check('拆解舞台跟随海报明暗主题', liveSpread.theme === liveSpread.expectedTheme,
    `${liveSpread.theme}/${liveSpread.expectedTheme}`);
  check('一级拆解保持分组兼容', liveSpread.level === '1' && liveSpread.groups === groupInfo.length,
    `${liveSpread.groups}/${groupInfo.length} 个模块`);
  check('拆解视图不提供第二级叶子钻取', !liveSpread.hasDrilldownAPI,
    '仅保留一级内容模块');
  check('静止拆解稿不叠加冗余模块标签', !liveSpread.labelsVisible,
    '名称仅在明确交互时提示');
  check('模块仍保留可发现的语义名称', !groupInfo.length || liveSpread.labelsNamed,
    groupInfo.length ? `${liveSpread.groups} 个模块均有名称` : '无一级模块标签');
  const originRatio = liveSpread.scanHeight / composedScreenHeight;
  check('扫描原点保持完整成稿的可读尺度', originRatio >= 0.68,
    `扫描态为编辑态高度的 ${(originRatio * 100).toFixed(1)}%`);
  check('终态铺满舞台且中央无大块保留区', liveSpread.laneCount >= 2
    && liveSpread.gallery.centerOccupied && liveSpread.gallery.span >= .72,
  `${liveSpread.laneCount} 列，横向覆盖 ${(liveSpread.gallery.span * 100).toFixed(1)}%`);
  check('总览与背景均为小型组件', liveSpread.gallery.specialMin >= .08
    && liveSpread.gallery.specialMax <= .38,
  `高度占舞台 ${(liveSpread.gallery.specialMin * 100).toFixed(1)}%–${(liveSpread.gallery.specialMax * 100).toFixed(1)}%`);

  if (groupInfo.length) {
    await page.hover('.hf-exploded-item[data-exploded-group]');
    await new Promise((r) => setTimeout(r, 220));
    check('悬停模块时才显示名称提示', await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.querySelector('.hf-exploded-item[data-exploded-group] .hf-exploded-label')).opacity) > .9));
    await page.mouse.move(0, 0);
    await page.click('.hf-exploded-item[data-exploded-group]');
    await new Promise((r) => setTimeout(r, 120));
    check('点击内容模块不会进入细粒度第二层', await page.evaluate(() =>
      document.querySelector('.hf-exploded-board')?.dataset.explodedLevel === '1'
      && !document.querySelector('.hf-exploded-nav')));
  }

  const spreadHTML = await page.evaluate(() => window.__layerEditor.explodedHTML());
  verifiedLayersHTML = spreadHTML;
  check('拆解导出物无编辑器依赖', !/layer-editor|class="hf-(bar|panel|modal|toast)/.test(spreadHTML));
  const spreadFile = join(dir, '_hf_verify_layers.html');
  writeFileSync(spreadFile, spreadHTML);
  const { page: pSpread, errors: eSpread } = await open(browser, spreadFile, { width: 1600, height: 1000 });
  await pSpread.waitForSelector('html[data-hf-exploded-ready]', { timeout: 20000 });
  const spreadAudit = await pSpread.evaluate(() => ({
    units: document.querySelectorAll('.hf-exploded-board .hf-exploded-item').length,
    layers: document.querySelectorAll('[data-exploded-layer]').length,
    uniqueLayers: new Set([...document.querySelectorAll('[data-exploded-layer]')]
      .map((node) => node.dataset.explodedLayer)).size,
    primaryContent: Number(document.querySelector('.hf-exploded-board')?.dataset.explodedPrimaryCount || 0),
    textSupplements: document.querySelectorAll('.hf-exploded-item[data-exploded-text-supplement]').length,
    bases: document.querySelectorAll('.hf-exploded-base').length,
    overviews: document.querySelectorAll('[data-exploded-overview]').length,
    backgrounds: document.querySelectorAll('[data-exploded-background]').length,
    groups: document.querySelectorAll('.hf-exploded-item[data-exploded-group]').length,
    level: document.querySelector('.hf-exploded-board')?.dataset.explodedLevel,
    drilldownUI: !!document.querySelector('.hf-exploded-nav'),
    centerOccupied: (() => {
      const board = document.querySelector('.hf-exploded-board');
      const width = parseFloat(board?.style.width) || 1;
      return [...document.querySelectorAll('.hf-exploded-item')].some((item) => {
        const left = parseFloat(item.style.left) || 0;
        const itemWidth = parseFloat(item.style.width) || 0;
        return left < width * .58 && left + itemWidth > width * .42;
      });
    })(),
    replay: !!document.querySelector('.hf-exploded-replay'),
    motion: document.documentElement.dataset.hfMotion,
    overflow: document.documentElement.scrollWidth > innerWidth + 1
      || document.documentElement.scrollHeight > innerHeight + 1,
  }));
  check('拆解稿可独立渲染无报错', eSpread.length === 0, eSpread.join('; '));
  check('拆解稿自适应且图层齐全', spreadAudit.uniqueLayers === layerIds.length && !spreadAudit.overflow,
    `${spreadAudit.uniqueLayers}/${layerIds.length} 个唯一叶子，${spreadAudit.layers} 次呈现`);
  check('独立拆解稿不保留中央大基底', spreadAudit.bases === 0
    && spreadAudit.centerOccupied, `${spreadAudit.bases} 个固定基底`);
  check('独立稿含完整总览与背景组件', spreadAudit.overviews === 1
    && spreadAudit.backgrounds === 1 && spreadAudit.units === expectedExplodedUnits,
  `${spreadAudit.units}/${expectedExplodedUnits} 个组件`);
  check('独立稿保留少组件文字补充', spreadAudit.primaryContent === explodeExpectation.primary
    && spreadAudit.textSupplements === explodeExpectation.textSupplements,
  `一级组件 ${spreadAudit.primaryContent}，文字补充 ${spreadAudit.textSupplements}`);
  check('拆解稿保留一级模块语义', spreadAudit.groups === groupInfo.length,
    `${spreadAudit.groups}/${groupInfo.length} 个模块`);
  check('独立拆解稿只有一级内容层', spreadAudit.level === '1' && !spreadAudit.drilldownUI,
    `level ${spreadAudit.level}`);
  check('拆解稿带自动播放与重播入口', spreadAudit.replay
    && ['played', 'reduced'].includes(spreadAudit.motion), spreadAudit.motion || '未播放');
  const replayMotion = await pSpread.evaluate(async () => {
    if (document.documentElement.dataset.hfMotion === 'reduced') return { any: true, scan: true };
    document.querySelector('.hf-exploded-replay').click();
    await new Promise((r) => setTimeout(r, 160));
    return {
      any: document.getAnimations().some((a) => a.playState === 'running'),
      scan: document.querySelector('.hf-exploded-scan-beam')?.getAnimations()
        .some((a) => a.playState === 'running') || false,
    };
  });
  check('重播按钮可重新触发扫描与拆解', replayMotion.any && replayMotion.scan);
  await pSpread.close();
  try { unlinkSync(spreadFile); } catch {}

  const exitMotion = await page.evaluate(async () => {
    void window.__layerEditor.setExploded(false);
    await new Promise((r) => setTimeout(r, 150));
    return {
      running: document.getAnimations().filter((a) => a.playState === 'running').length,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
  check('返回时执行反向合拢动画', exitMotion.reduced || exitMotion.running > 0,
    exitMotion.reduced ? '已遵循 reduced-motion' : `${exitMotion.running} 个动画运行中`);
  await page.waitForFunction(() => !window.__layerEditor.state.transitioning, { timeout: 20000 });
  const composedAfterSpread = await page.evaluate(COLLECT);
  check('返回编辑后原布局不变', compare(composedBeforeSpread, composedAfterSpread).length === 0);

  /* ---------- B 类：导出往返一致 ---------- */
  group('B 类 · 导出往返一致');
  const stateBefore = await page.evaluate(COLLECT);
  const html = await page.evaluate(() => window.__layerEditor.fullHTML());
  check('导出物无编辑器残留', !/hf-|layer-editor/.test(html));
  const outFile = join(dir, '_hf_verify_out.html');
  writeFileSync(outFile, html);
  const { page: pOut, errors: eOut } = await open(browser, outFile);
  const stateAfter = await pOut.evaluate(COLLECT);
  const issues = compare(stateBefore, stateAfter);
  check('导出物可独立渲染无报错', eOut.length === 0, eOut.join('; '));
  check('坐标 / 字号 / 字体 / 渲染宽度全部一致', issues.length === 0, issues.slice(0, 4).join(' | '));
  try { unlinkSync(outFile); } catch {}

  /* ---------- 草稿 ---------- */
  group('草稿（localStorage）');
  await page.evaluate((id) => {
    const l = window.__layerEditor.layers().find((x) => x.id === id);
    l.el.style.left = '777px';
    l.el.style.top = '333px';
    l.el.style.width = `${parseFloat(l.el.style.width) + 33}px`;
    l.el.style.height = `${parseFloat(l.el.style.height) + 17}px`;
    l.el.dataset.hfWidthLocked = '1';
    l.el.dataset.hfHeightLocked = '1';
    window.__layerEditor.state.removed.length = 0;
  }, first);
  await page.evaluate(() => window.__layerEditor.snapshot());
  await page.evaluate((id) => {
    // 走真实路径：模拟一次方向键触发 touch() 的草稿保存
    const l = window.__layerEditor.layers().find((x) => x.id === id);
    window.__layerEditor.select(l.el);
  }, first);
  await page.keyboard.press('ArrowRight');
  await new Promise((r) => setTimeout(r, 800));
  const draftRaw = await page.evaluate(() => {
    const prefix = 'hf-draft:' + location.pathname;
    const key = Object.keys(localStorage).find((candidate) =>
      candidate === prefix || candidate.startsWith(prefix + ':'));
    return key ? localStorage.getItem(key) : null;
  });
  check('草稿已写入 localStorage', !!draftRaw, draftRaw ? `${(draftRaw.length / 1024).toFixed(1)}KB` : '');

  const expect = await boxOf(first);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('html[data-hf-ready]', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 400));
  const afterReload = await boxOf(first);
  check('刷新后自动恢复草稿', afterReload && Math.abs(afterReload.left - expect.left) < 0.5,
    `期望 ${expect.left},${expect.top} 实得 ${afterReload?.left},${afterReload?.top}`);
  check('刷新后恢复手动宽高状态', afterReload
    && Math.abs(afterReload.width - expect.width) < 0.5
    && Math.abs(afterReload.height - expect.height) < 0.5
    && afterReload.widthLocked && afterReload.heightLocked,
  `期望 ${expect.width.toFixed(1)}×${expect.height.toFixed(1)} 实得 ${afterReload?.width.toFixed(1)}×${afterReload?.height.toFixed(1)}`);
  check('草稿提示条可见', await page.evaluate(() => !document.getElementById('hf-draft').hidden));

  if (!fails && verifiedLayersHTML) {
    try {
      writeFileSync(layersOutput, verifiedLayersHTML);
      check('已生成默认 layers.html', true, layersOutput);
    } catch (error) {
      check('已生成默认 layers.html', false, String(error));
    }
  }

  if (errors.length) console.log('\n编辑器页面报错:', errors.join('; '));
} finally {
  wired.cleanup();
  await browser.close();
}

markTiming('完成');
if (showTimings) {
  console.log('\n【分阶段计时】');
  for (const row of timingRows) {
    console.log(` TIMING\t${row.phase}\t${(row.ms / 1000).toFixed(3)}s`);
  }
  console.log(` TIMING\t总计\t${((Date.now() - timingStartedAt) / 1000).toFixed(3)}s`);
}

console.log(fails === 0 ? '\n全部通过 ✅\n' : `\n${fails} 项失败 ❌\n`);
process.exit(fails ? 1 : 0);
