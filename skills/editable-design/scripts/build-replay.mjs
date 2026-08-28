#!/usr/bin/env node
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const projectArg = args.find((arg) => !arg.startsWith('--')) || process.cwd();
const outIndex = args.indexOf('--out');
const projectRoot = resolve(projectArg);
const outDir = resolve(outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : join(projectRoot, 'replay'));
const templateCandidates = [
  join(scriptDir, 'replay-assets'),
  resolve(scriptDir, '../assets/replay'),
];
const templateDir = templateCandidates.find((path) => existsSync(join(path, 'index.html')));

if (!templateDir) {
  console.error('Replay template is unavailable. Re-run poster initialization or use the skill-local builder.');
  process.exit(2);
}
if (!existsSync(join(projectRoot, 'index.html'))) {
  console.error(`No poster index.html found in ${projectRoot}`);
  process.exit(2);
}

const posix = (value) => value.split(sep).join('/');
const read = (path, fallback = '') => existsSync(path) ? readFileSync(path, 'utf8') : fallback;
const readJSON = (path, fallback = {}) => {
  try { return JSON.parse(read(path)); } catch { return fallback; }
};
const firstExisting = (paths) => paths.find((path) => existsSync(path));
const projectPath = (...parts) => join(projectRoot, ...parts);
const browserPath = (path, query = '') => path ? `../${posix(relative(projectRoot, path))}${query}` : '';

function filesIn(path, extensions = []) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => !name.startsWith('.') && (!extensions.length || extensions.includes(extname(name).toLowerCase())))
    .map((name) => join(path, name))
    .filter((file) => statSync(file).isFile())
    .sort();
}

function markdownSections(markdown) {
  const sections = [];
  const lines = markdown.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      if (current) sections.push({ ...current, body: current.lines.join('\n').trim() });
      current = { title: match[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ ...current, body: current.lines.join('\n').trim() });
  return sections;
}

function findSection(sections, key) {
  if (!key) return null;
  const exact = sections.find((section) => section.title.toLowerCase() === String(key).toLowerCase());
  if (exact) return exact;
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return sections.find((section) => section.title.toLowerCase().replace(/[^a-z0-9]+/g, '') === normalized)
    || sections.find((section) => section.title.toLowerCase().includes(String(key).toLowerCase()));
}

function traceEvents() {
  return read(projectPath('.trace', 'events.jsonl'))
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

const manifest = readJSON(projectPath('.trace', 'manifest.json'));
const poster = readJSON(projectPath('poster.json'));
const assetPlanPath = firstExisting([
  projectPath('asset-plan.json'),
  projectPath('.trace', 'artifacts', 'P11_asset_plan', 'asset-plan.json'),
]);
const assetPlanRaw = assetPlanPath ? read(assetPlanPath) : '';
const assetPlan = assetPlanPath ? readJSON(assetPlanPath) : {};
const promptPath = firstExisting([
  projectPath('prompts.md'),
  projectPath('.trace', 'artifacts', 'P12_generate_imagery', 'prompts.md'),
]);
const promptsRaw = promptPath ? read(promptPath) : '';
const promptSections = markdownSections(promptsRaw);
const briefPath = firstExisting([
  projectPath('brief.md'),
  projectPath('.trace', 'artifacts', 'P01_input', 'brief.md'),
]);
const briefRaw = briefPath ? read(briefPath).trim() : '';
const compositionPromptPath = firstExisting([
  projectPath('reference', 'composition-prompt.md'),
  projectPath('reference', 'reference-prompt.md'),
  projectPath('.trace', 'artifacts', 'P02_reference', 'composition-prompt.md'),
]);
const compositionSection = promptSections.find((section) => /composition reference|art-directed composition/i.test(section.title));
const compositionPrompt = compositionPromptPath ? read(compositionPromptPath).trim() : (compositionSection?.body || '');
const referenceImage = firstExisting([
  projectPath('reference', 'composition-reference.png'),
  projectPath('reference', 'art-direction.png'),
  ...filesIn(projectPath('reference'), ['.png', '.jpg', '.jpeg', '.webp']),
]);
const notesPath = firstExisting([
  projectPath('design-plan.md'),
  projectPath('reference', 'composition-notes.md'),
  projectPath('zones-plan.md'),
  projectPath('.trace', 'artifacts', 'P11_asset_plan', 'design-plan.md'),
  projectPath('.trace', 'artifacts', 'P11_asset_plan', 'zones-plan.md'),
]);
const notesRaw = notesPath ? read(notesPath).trim() : '';
const reviewPath = firstExisting([
  projectPath('render-review.md'),
  projectPath('.trace', 'artifacts', 'P16_read_render', 'render-review.md'),
]);
const reviewRaw = reviewPath ? read(reviewPath).trim() : '';
const indexRaw = read(projectPath('index.html'));
const renderPath = firstExisting([
  projectPath('out', 'poster.png'),
  ...filesIn(projectPath('out'), ['.png', '.jpg', '.jpeg', '.webp']),
]);
const layersPath = firstExisting([
  projectPath('layers.html'),
  projectPath('editor.html'),
]);
const events = traceEvents();
const assetFiles = filesIn(projectPath('assets'), ['.png', '.jpg', '.jpeg', '.webp']);

function eventTime(match) {
  return events.find(match)?.ts || '';
}

const startedAt = events.find((event) => event.type === 'run_start')?.ts || manifest.created_at || '';
function timeLabel(match) {
  const stamp = eventTime(match);
  if (!startedAt || !stamp) return '';
  const seconds = Math.max(0, Math.round((new Date(stamp) - new Date(startedAt)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `T+${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function findAssetFile(id, index) {
  if (id) {
    const exact = assetFiles.find((path) => {
      const stem = path.slice(0, -extname(path).length).split(sep).pop();
      return stem.toLowerCase() === String(id).toLowerCase();
    });
    if (exact) return exact;
    const loose = assetFiles.find((path) => path.toLowerCase().includes(String(id).toLowerCase()));
    if (loose) return loose;
  }
  return assetFiles[index] || null;
}

let assetItems = [];
if (Array.isArray(assetPlan.assets) && assetPlan.assets.length) {
  assetItems = assetPlan.assets.map((asset, index) => {
    const promptKey = asset.prompt || asset.prompt_id || asset.id;
    const section = findSection(promptSections, promptKey) || findSection(promptSections, asset.id);
    const file = findAssetFile(asset.id, index);
    return {
      id: asset.id || `asset-${index + 1}`,
      title: asset.label || asset.id || section?.title || `Asset ${index + 1}`,
      promptId: promptKey || '',
      prompt: section?.body || '',
      src: browserPath(file),
      source: file ? posix(relative(projectRoot, file)) : '',
      contain: /cutout|relief|map|diagram|logo/i.test(`${asset.form || ''} ${asset.id || ''}`),
    };
  });
} else {
  const shippingSections = promptSections.filter((section) => !/composition reference|art-directed composition/i.test(section.title));
  assetItems = assetFiles.map((file, index) => ({
    id: file.slice(0, -extname(file).length).split(sep).pop(),
    title: shippingSections[index]?.title || file.split(sep).pop(),
    promptId: shippingSections[index]?.title || '',
    prompt: shippingSections[index]?.body || '',
    src: browserPath(file),
    source: posix(relative(projectRoot, file)),
    contain: /cutout|relief|map|diagram|logo/i.test(file),
  }));
}

const layerIds = [...indexRaw.matchAll(/data-layer-id\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]);
const groupIds = [...indexRaw.matchAll(/data-explode-group\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]);
const uniqueLayers = new Set(layerIds);
const uniqueGroups = new Set(groupIds);
const layersRaw = layersPath && layersPath.endsWith('layers.html') ? read(layersPath) : '';
const componentCount = layersRaw ? (layersRaw.match(/class=["'][^"']*hf-exploded-item\b/g) || []).length : 0;
const mainMatch = indexRaw.match(/<main\b[\s\S]*?<\/main>/i);
const codeExcerpt = (mainMatch?.[0] || indexRaw).slice(0, 5200).trim();
const reviewBullets = [...reviewRaw.matchAll(/^\s*-\s+(.+)$/gm)].map((match) => match[1].trim());
const explicitPasses = (reviewRaw.match(/^##\s+Pass\b/gmi) || []).length;
const renderPasses = events.filter((event) => event.type === 'exec_done' && /^P15_render/.test(event.step || '')).length;
const passCount = explicitPasses || Math.max(1, renderPasses);
const canvas = poster.canvas?.width && poster.canvas?.height ? `${poster.canvas.width} × ${poster.canvas.height}` : 'fixed canvas';
const documentTitle = (indexRaw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim();
const title = manifest.label || documentTitle || projectRoot.split(sep).pop();

const stages = [
  {
    id: 'input', order: '01', kind: 'input', phase: 'think', title: '需求输入',
    statusLabel: briefRaw ? '原始记录' : '记录缺失',
    raw: briefRaw,
    fallbackLabel: briefRaw ? '' : manifest.label || '',
    attachments: filesIn(projectPath('input')).map((path) => posix(relative(projectRoot, path))),
    timeLabel: timeLabel((event) => event.type === 'run_start'),
    artifactLabel: briefRaw ? '1 个原始 Prompt' : '仅 trace label',
    sources: briefPath ? [posix(relative(projectRoot, briefPath))] : ['missing: brief.md'],
  },
  {
    id: 'reference', order: '02', kind: 'reference', phase: 'think', title: '视觉参考',
    statusLabel: compositionPrompt && referenceImage ? '已确定' : '证据不完整',
    prompt: compositionPrompt,
    promptSource: compositionPromptPath ? posix(relative(projectRoot, compositionPromptPath)) : (compositionSection ? 'prompts.md / composition reference' : ''),
    preview: browserPath(referenceImage),
    timeLabel: timeLabel((event) => /P11_reference|P02_reference/.test(event.step || '')),
    artifactLabel: referenceImage ? '1 个参考结果' : '无参考图',
    sources: [compositionPromptPath, referenceImage].filter(Boolean).map((path) => posix(relative(projectRoot, path))).concat(compositionSection && !compositionPromptPath ? ['prompts.md / composition reference'] : []),
  },
  {
    id: 'plan', order: '03', kind: 'plan', phase: 'think', title: '设计规划',
    statusLabel: notesRaw || assetPlanRaw ? '已决策' : '记录缺失',
    raw: notesRaw || assetPlanRaw,
    assetPlanRaw,
    architecture: assetPlan.architecture || assetPlan.type || '',
    planTitle: assetPlan.architecture || (notesPath ? notesPath.split(sep).pop() : '版式与信息层级'),
    slots: Array.isArray(assetPlan.assets) ? assetPlan.assets : [],
    timeLabel: timeLabel((event) => /P09_canvas|P11_asset_plan/.test(event.step || '')),
    artifactLabel: `${Array.isArray(assetPlan.assets) ? assetPlan.assets.length : 0} 个视觉槽位`,
    sources: [notesPath, assetPlanPath].filter(Boolean).map((path) => posix(relative(projectRoot, path))),
  },
  {
    id: 'assets', order: '04', kind: 'assets', phase: 'make', title: '素材生成',
    statusLabel: assetItems.length ? '已生成' : '无生成素材',
    items: assetItems,
    raw: promptsRaw,
    timeLabel: timeLabel((event) => /P12_generate_imagery|P21_bottom_scene/.test(event.step || '')),
    artifactLabel: `${assetItems.length} 个素材`,
    sources: [promptPath, ...assetFiles].filter(Boolean).map((path) => posix(relative(projectRoot, path))),
  },
  {
    id: 'html', order: '05', kind: 'html', phase: 'make', title: 'HTML 构建',
    statusLabel: renderPath ? '已渲染' : '已编码',
    code: codeExcerpt,
    fullCode: indexRaw.slice(0, 80000),
    render: browserPath(renderPath),
    canvas,
    layerCount: uniqueLayers.size,
    groupCount: uniqueGroups.size,
    timeLabel: timeLabel((event) => /P14_cleanup|P15_render/.test(event.step || '')),
    artifactLabel: renderPath ? 'HTML + PNG' : 'HTML',
    sources: ['index.html'].concat(renderPath ? [posix(relative(projectRoot, renderPath))] : []),
  },
  {
    id: 'review', order: '06', kind: 'review', phase: 'prove', title: 'Review 反馈',
    statusLabel: reviewRaw ? '已修正' : '记录缺失',
    raw: reviewRaw,
    bullets: reviewBullets,
    passCount,
    timeLabel: timeLabel((event) => /P16_read_render|P16_optimization|P25_read_render/.test(event.step || '')),
    artifactLabel: `${passCount} 轮 Review`,
    sources: reviewPath ? [posix(relative(projectRoot, reviewPath)), '.trace/events.jsonl'] : ['missing: render-review.md', '.trace/events.jsonl'],
  },
  {
    id: 'layers', order: '07', kind: 'layers', phase: 'prove', title: '分层展示',
    statusLabel: layersPath ? '已验证' : '未生成',
    layerCount: uniqueLayers.size,
    groupCount: uniqueGroups.size,
    componentCount,
    preview: browserPath(layersPath),
    previewSource: layersPath ? posix(relative(projectRoot, layersPath)) : '',
    timeLabel: timeLabel((event) => /P17_editor|P20_editor|P26_editor/.test(event.step || '')),
    artifactLabel: `${uniqueLayers.size} 图层 · ${uniqueGroups.size} 组`,
    sources: layersPath ? [posix(relative(projectRoot, layersPath)), 'index.html / data-layer-id'] : ['missing: editor.html or layers.html'],
  },
];

const replay = {
  schema: 'poster-replay/v1',
  generatedAt: new Date().toISOString(),
  project: {
    title,
    slug: projectRoot.split(sep).pop(),
    status: manifest.status || 'ok',
    canvas,
  },
  stages,
};

mkdirSync(outDir, { recursive: true });
for (const file of ['index.html', 'replay.css', 'replay.js', 'replay-motion.js']) {
  copyFileSync(join(templateDir, file), join(outDir, file));
}
cpSync(join(templateDir, 'icons'), join(outDir, 'icons'), { recursive: true });
writeFileSync(join(outDir, 'data.js'), `window.__POSTER_REPLAY__ = ${JSON.stringify(replay, null, 2)};\n`);

const missing = stages.filter((stage) => /缺失|不完整|未生成/.test(stage.statusLabel));
console.log(`replay      ${join(outDir, 'index.html')}`);
console.log(`stages      ${stages.length}`);
console.log(`assets      ${assetItems.length}`);
if (missing.length) console.log(`evidence    missing or partial: ${missing.map((stage) => stage.id).join(', ')}`);
