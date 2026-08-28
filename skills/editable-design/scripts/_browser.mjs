/**
 * _browser.mjs —— 编辑、固化、拆解与验收脚本共用的 headless 浏览器封装
 *
 * 为什么必须用真浏览器：图层坐标只能由布局引擎算出。jsdom / cheerio
 * 没有布局引擎，getBoundingClientRect() 恒返回 0，纯文本方案不可行。
 */
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/editor');
const ASSET_FILES = ['layer-editor.css', 'layer-editor.js'];
const TAGS = '  <link rel="stylesheet" href="layer-editor.css">\n'
           + '  <script src="layer-editor.js" defer></script>\n';

/**
 * 临时把编辑器接到一张海报上，用于离线驱动。
 * 临时 HTML 必须放在海报同目录，否则 assets/ 之类的相对路径会失效。
 * cleanup() 会移除临时文件，并将项目原有的编辑器资产逐字节还原。
 * 验收不得把技能内置运行时永久覆盖到已经完成的项目里。
 */
export function wireTemp(src, name = '_hf_tmp.html') {
  const dir = dirname(src);
  const tmp = join(dir, name);
  const originalAssets = new Map(ASSET_FILES.map((f) => {
    const target = join(dir, f);
    return [f, existsSync(target) ? readFileSync(target) : null];
  }));
  const html = readFileSync(src, 'utf8');
  if (!/<\/head>/i.test(html)) throw new Error('这份 HTML 没有 </head>，无法注入编辑器');

  for (const f of ASSET_FILES) copyFileSync(join(ASSETS, f), join(dir, f));
  writeFileSync(tmp, html.includes('layer-editor.js') ? html : html.replace(/<\/head>/i, TAGS + '</head>'));

  return {
    file: tmp,
    cleanup() {
      try { unlinkSync(tmp); } catch { /* 已不存在 */ }
      for (const f of ASSET_FILES) {
        const target = join(dir, f);
        const original = originalAssets.get(f);
        if (original) writeFileSync(target, original);
        else { try { unlinkSync(target); } catch { /* 已不存在 */ } }
      }
    },
  };
}

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('缺少依赖 puppeteer-core。请先执行：');
  console.error('  cd "' + dirname(fileURLToPath(import.meta.url)) + '" && npm install');
  process.exit(2);
}

const CHROME_CANDIDATES = [
  process.env.EDITABLE_DESIGN_BROWSER,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.POSTER_BROWSER,
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

function findChrome() {
  let hit = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!hit) {
    for (const name of ['chromium', 'google-chrome', 'chrome']) {
      try {
        const found = execFileSync('which', [name], { encoding: 'utf8' }).trim();
        if (found && existsSync(found)) { hit = found; break; }
      } catch { /* try the next name */ }
    }
  }
  if (!hit) {
    console.error('找不到 Chrome。请设置 EDITABLE_DESIGN_BROWSER 指向浏览器可执行文件。');
    process.exit(2);
  }
  return hit;
}

export async function launch() {
  // 每次用全新的临时 profile：既避开用户已开着的 Chrome 实例
  // （否则会卡在 "Timed out waiting for the WS endpoint URL"），
  // 也保证 localStorage 干净，草稿不会干扰固化结果。
  const profile = mkdtempSync(join(tmpdir(), 'layer-editor-'));
  const args = [
    '--allow-file-access-from-files',
    '--font-render-hinting=none',
    '--disable-gpu',
    `--user-data-dir=${profile}`,
  ];
  if (process.env.EDITABLE_DESIGN_NO_SANDBOX === '1') args.push('--no-sandbox');
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args,
  });
  const origClose = browser.close.bind(browser);
  browser.close = async () => {
    await origClose();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* 清理失败无妨 */ }
  };
  return browser;
}

/**
 * 加载一个本地 HTML 文件并等到可以安全测量为止。
 * waitEditor=true 时额外等编辑器初始化完成（data-hf-ready）。
 */
export async function open(browser, file, { width = 1600, height = 1200, waitEditor = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + resolve(file), { waitUntil: 'networkidle0' });
  if (waitEditor) await page.waitForSelector('html[data-hf-ready]', { timeout: 20000 });
  // 字体与图片决定文字块尺寸和图层高度，量之前必须落地
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all(
    [...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => {
      i.addEventListener('load', r, { once: true });
      i.addEventListener('error', r, { once: true });
    })),
  ));
  await new Promise((r) => setTimeout(r, 350));
  return { page, errors };
}

/** 读出每个 data-layer-id 图层相对画布的位置与尺寸（换算掉画布缩放） */
export function probe(page) {
  return page.evaluate(() => {
    const cv = document.querySelector('[data-canvas-width]') || document.querySelector('.poster-canvas');
    if (!cv) return null;
    const c = cv.getBoundingClientRect();
    const scale = c.width / (+cv.dataset.canvasWidth || cv.offsetWidth);
    const out = {};
    for (const el of cv.querySelectorAll('[data-layer-id]')) {
      const r = el.getBoundingClientRect();
      out[el.dataset.layerId] = {
        left: +((r.left - c.left) / scale).toFixed(1),
        top: +((r.top - c.top) / scale).toFixed(1),
        width: +(r.width / scale).toFixed(1),
        height: +(r.height / scale).toFixed(1),
      };
    }
    return out;
  });
}

/** 逐图层比对两次测量，返回最大偏差与超差清单 */
export function diff(a, b, tol = 1) {
  const ids = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
  const rows = [];
  let worst = 0;
  for (const id of ids) {
    if (!a?.[id] || !b?.[id]) { rows.push({ id, missing: true }); continue; }
    const d = Math.max(Math.abs(a[id].left - b[id].left), Math.abs(a[id].top - b[id].top));
    worst = Math.max(worst, d);
    rows.push({ id, a: a[id], b: b[id], d: +d.toFixed(2), fail: d > tol });
  }
  return { worst: +worst.toFixed(2), rows, ok: rows.every((r) => !r.fail && !r.missing) };
}

/**
 * 对两个页面中的画布做真实像素比对。
 *
 * 几何一致只能证明图层框没有移动，无法发现上下文选择器失效、背景消失、
 * 伪元素丢失或绘制顺序改变。这里直接截取元素并交给浏览器解码 PNG，避免
 * 再引入 sharp/pngjs 等依赖。perChannelTolerance 用于忽略极轻微的抗锯齿噪声。
 */
export async function pixelDiff(pageA, selectorA, pageB, selectorB, { perChannelTolerance = 2 } = {}) {
  const elA = await pageA.$(selectorA);
  const elB = await pageB.$(selectorB);
  if (!elA || !elB) return { ok: false, reason: '找不到待比较画布' };
  const capture = async (page, el) => {
    const box = await el.boundingBox();
    if (!box) throw new Error('待比较画布不可见');
    // ElementHandle.screenshot() 会先尝试滚动元素到可见区。对于高于
    // 普通视口的竖版海报，某些 Chrome 版本会在这一步长时间等待。
    // 画布已被安置在足够大的视口中，直接按 bounding box 裁剪更稳定。
    return page.screenshot({
      type: 'png', omitBackground: true, captureBeyondViewport: true,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  };
  // Puppeteer 会用同一把截图锁保护 BrowserContext，必须顺序执行。
  const pngA = await capture(pageA, elA);
  const pngB = await capture(pageB, elB);
  if (Buffer.compare(pngA, pngB) === 0) {
    return { ok: true, width: 0, height: 0, changed: 0, changedRatio: 0, meanAbs: 0, exact: true };
  }
  return pageA.evaluate(async ({ a, b, tolerance }) => {
    const load = (base64) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('PNG 解码失败'));
      img.src = `data:image/png;base64,${base64}`;
    });
    const [imgA, imgB] = await Promise.all([load(a), load(b)]);
    if (imgA.naturalWidth !== imgB.naturalWidth || imgA.naturalHeight !== imgB.naturalHeight) {
      return {
        ok: false, reason: '尺寸不一致',
        a: [imgA.naturalWidth, imgA.naturalHeight], b: [imgB.naturalWidth, imgB.naturalHeight],
      };
    }
    const width = imgA.naturalWidth, height = imgA.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height); ctx.drawImage(imgA, 0, 0);
    const aData = ctx.getImageData(0, 0, width, height).data;
    ctx.clearRect(0, 0, width, height); ctx.drawImage(imgB, 0, 0);
    const bData = ctx.getImageData(0, 0, width, height).data;
    let changed = 0, totalAbs = 0, worst = 0;
    for (let i = 0; i < aData.length; i += 4) {
      const dr = Math.abs(aData[i] - bData[i]);
      const dg = Math.abs(aData[i + 1] - bData[i + 1]);
      const db = Math.abs(aData[i + 2] - bData[i + 2]);
      const da = Math.abs(aData[i + 3] - bData[i + 3]);
      const local = Math.max(dr, dg, db, da);
      if (local > tolerance) changed++;
      totalAbs += dr + dg + db + da;
      if (local > worst) worst = local;
    }
    const pixels = width * height;
    return {
      ok: true, width, height, changed,
      changedRatio: changed / pixels,
      meanAbs: totalAbs / (pixels * 4), worst, exact: false,
    };
  }, {
    a: Buffer.from(pngA).toString('base64'),
    b: Buffer.from(pngB).toString('base64'),
    tolerance: perChannelTolerance,
  });
}
