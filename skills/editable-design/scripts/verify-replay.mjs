#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const input = resolve(process.argv[2] || join(process.cwd(), 'replay', 'index.html'));
const replayDir = dirname(input);
const required = ['index.html', 'replay.css', 'replay.js', 'replay-motion.js', 'data.js'];
let failed = false;

for (const file of required) {
  const ok = existsSync(join(replayDir, file));
  console.log(` ${ok ? '✅' : '❌'} ${file}`);
  failed ||= !ok;
}

if (!failed) {
  const html = readFileSync(input, 'utf8');
  const replayCSS = readFileSync(join(replayDir, 'replay.css'), 'utf8');
  const replayJS = readFileSync(join(replayDir, 'replay.js'), 'utf8');
  const motionJS = readFileSync(join(replayDir, 'replay-motion.js'), 'utf8');
  const script = readFileSync(join(replayDir, 'data.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(script, sandbox, { timeout: 1000 });
  const data = sandbox.window.__POSTER_REPLAY__;
  const ids = data?.stages?.map((stage) => stage.id) || [];
  const expected = ['input', 'reference', 'plan', 'assets', 'html', 'review', 'layers'];
  const schemaOK = data?.schema === 'poster-replay/v1';
  const stagesOK = expected.every((id, index) => ids[index] === id);
  const offlineOK = !/https?:\/\//i.test(html) && !/\bfetch\s*\(/.test(replayJS) && !/\bfetch\s*\(/.test(motionJS);
  const sourceOK = data.stages.every((stage) => Array.isArray(stage.sources));
  const phaseNavOK = html.includes('id="phase-nav"') && ['理解与规划', '生成与构建', '观察与修正'].every((label) => html.includes(label));
  const phaseIconsOK = ['icons/plan.png', 'icons/html.png', 'icons/review.png'].every((source) => html.includes(source));
  const noDefaultDetailOK = !html.includes('data-default-stage') && replayJS.includes('document.body.dataset.defaultStage ? stageById.get(document.body.dataset.defaultStage) : null');
  const arrowSizingOK = /markerUnits=["']userSpaceOnUse["']/.test(replayJS);
  const motionOK = html.includes('id="play-replay"') && ['runIntro', 'startAmbient', 'playReplay'].every((name) => motionJS.includes(name));
  const reducedMotionOK = motionJS.includes('prefers-reduced-motion');
  const flowIds = ['flow-input-reference', 'flow-reference-plan', 'flow-plan-assets', 'flow-assets-html', 'flow-html-review', 'flow-review-html-repair', 'flow-review-layers'];
  const playbackPathOK = flowIds.every((id) => replayJS.includes(`id="${id}"`) && motionJS.includes(id));
  const ambientCadenceOK = motionJS.includes('randomBetween(1800, 3000)') && motionJS.includes('randomBetween(2600, 4000)') && motionJS.includes('isRepair ? 1100 : 400') && motionJS.includes('strong ? 720 : 1150') && motionJS.includes('scale >= .20');
  const introTimingOK = motionJS.includes('INTRO_DURATION = 4700') && replayCSS.includes('.is-intro .detail-panel');
  const assetOverviewOK = replayJS.includes('asset-overview-grid') && replayCSS.includes('.asset-overview-grid');
  const planMatrixOK = replayJS.includes('hasRecordedRects') && replayJS.includes('slots.length >= 5 ? 3') && replayJS.includes('slot.role || slot.form || slot.aspect || slot.prompt') && replayJS.includes('plan-empty');
  const scaledPhaseNavOK = html.indexOf('id="canvas-world"') < html.indexOf('id="phase-nav"') && html.indexOf('id="phase-nav"') < html.indexOf('id="flow-lines"') && replayCSS.includes('width: 2540px');
  const largePhaseNavOK = replayCSS.includes('width: 210px') && replayCSS.includes('min-height: 210px') && replayCSS.includes('width: 56px; height: 56px') && replayCSS.includes('font-size: 19px');
  const assetStageOK = replayJS.includes("assets:    { x: 800,  y: 640,  w: 480, h: 390 }") && replayJS.includes("shorten(first.prompt || '未记录素材 Prompt。', 320)");
  const adaptiveAssetsOK = replayJS.includes('assetItems.length === 1') && replayJS.includes("className: 'asset single-asset'") && replayJS.includes('x: 260, y: 610, w: 500, h: 440') && replayJS.includes('x: 260 + (index % 2) * 260') && replayJS.includes('y: 610 + Math.floor(index / 2) * 230') && replayJS.includes('assetCount === 1') && replayJS.includes('.slice(0, assetCount)');
  const assetShowcaseOK = motionJS.includes('scheduleAssetShowcase') && motionJS.includes('duration: 700') && motionJS.includes('randomBetween(4000, 6000)') && motionJS.includes("transform: 'scale(1.015)'");
  const feedbackLabelOK = replayJS.includes('class="flow-label prove-label"') && replayCSS.includes('.flow-label text { fill: #47765c');
  const layersStage = data.stages.find((stage) => stage.id === 'layers');
  const liveLayerAnimationOK = !layersStage?.preview?.includes('motion=0') && replayJS.includes('可编辑分层动画（HTML）');
  const referencePlacementOK = replayJS.includes("reference: { x: 820,  y: 110,  w: 450, h: 330 }") && replayJS.includes("x: 1538, y: 110, w: 270, h: 360") && replayJS.includes('class="flow-artifact flow-path think"') && replayJS.includes('d="M1270 290 L2075 290"') && !replayJS.includes('L1900 70 C2030 70 2010 275 2075 275');
  const rightColumnPlanOK = replayJS.includes("plan:      { x: 2075, y: 110,  w: 420, h: 360 }") && replayJS.includes("x: 2075, y: 670, w: 420, h: 560") && replayJS.includes("x: 2075, y: 1320, w: 420, h: 360");
  const featuredMediaOK = replayJS.includes("x: 2075, y: 670, w: 420, h: 560") && replayJS.includes("x: 2075, y: 1320, w: 420, h: 360");
  const detailPanelOK = replayCSS.includes('width: min(620px, calc(100vw - 36px))') && replayCSS.includes('#detail-content { display: flex') && replayCSS.includes('overflow-y: auto') && replayJS.includes("event.target.closest('.detail-panel,.media-lightbox')");
  const mediaLightboxOK = html.includes('id="media-lightbox"') && ['openMode: \'image\'', "openMode: 'animation'", 'url.searchParams.delete(\'motion\')'].every((token) => replayJS.includes(token)) && replayCSS.includes('.media-lightbox.is-open');
  const fullPngContainOK = replayCSS.includes('.media-lightbox-frame img { display: block; width: auto; height: auto; max-width: 100%; max-height: 100%; min-width: 0; min-height: 0; object-fit: contain; }');
  console.log(` ${schemaOK ? '✅' : '❌'} poster-replay/v1 schema`);
  console.log(` ${stagesOK ? '✅' : '❌'} seven ordered creative stages`);
  console.log(` ${offlineOK ? '✅' : '❌'} offline file:// runtime`);
  console.log(` ${sourceOK ? '✅' : '❌'} source provenance on every stage`);
  console.log(` ${phaseNavOK ? '✅' : '❌'} three persistent phase controls`);
  console.log(` ${phaseIconsOK ? '✅' : '❌'} phase control icons`);
  console.log(` ${noDefaultDetailOK ? '✅' : '❌'} clean overview with no default detail`);
  console.log(` ${arrowSizingOK ? '✅' : '❌'} bounded flow-arrow markers`);
  console.log(` ${motionOK ? '✅' : '❌'} intro, ambient, and playback motion states`);
  console.log(` ${reducedMotionOK ? '✅' : '❌'} reduced-motion fallback`);
  console.log(` ${playbackPathOK ? '✅' : '❌'} playback path-to-stage mapping`);
  console.log(` ${ambientCadenceOK ? '✅' : '❌'} faster ambient and repair cadence`);
  console.log(` ${introTimingOK ? '✅' : '❌'} 4.7s intro with hidden detail panel`);
  console.log(` ${assetOverviewOK ? '✅' : '❌'} all-assets visual overview`);
  console.log(` ${planMatrixOK ? '✅' : '❌'} recorded-plan slot matrix fallback`);
  console.log(` ${scaledPhaseNavOK ? '✅' : '❌'} phase controls scale with the canvas world`);
  console.log(` ${largePhaseNavOK ? '✅' : '❌'} enlarged readable phase controls`);
  console.log(` ${assetStageOK ? '✅' : '❌'} compact Assets stage with Prompt summary`);
  console.log(` ${adaptiveAssetsOK ? '✅' : '❌'} adaptive single/full and multi 2x2 Assets previews`);
  console.log(` ${assetShowcaseOK ? '✅' : '❌'} 700ms Assets gallery showcase with 4-6s rest`);
  console.log(` ${feedbackLabelOK ? '✅' : '❌'} feedback label on green observation path`);
  console.log(` ${liveLayerAnimationOK ? '✅' : '❌'} live HTML layer animation`);
  console.log(` ${referencePlacementOK ? '✅' : '❌'} centered reference on a straight dashed connector`);
  console.log(` ${rightColumnPlanOK ? '✅' : '❌'} Design Plan aligned with the right output column`);
  console.log(` ${featuredMediaOK ? '✅' : '❌'} enlarged right-side output column`);
  console.log(` ${detailPanelOK ? '✅' : '❌'} wide independently scrolling detail panel`);
  console.log(` ${mediaLightboxOK ? '✅' : '❌'} image and animation lightbox behaviors`);
  console.log(` ${fullPngContainOK ? '✅' : '❌'} full uncropped PNG in image lightbox`);
  failed ||= !schemaOK || !stagesOK || !offlineOK || !sourceOK || !phaseNavOK || !phaseIconsOK || !noDefaultDetailOK || !arrowSizingOK || !motionOK || !reducedMotionOK || !playbackPathOK || !ambientCadenceOK || !introTimingOK || !assetOverviewOK || !planMatrixOK || !scaledPhaseNavOK || !largePhaseNavOK || !assetStageOK || !adaptiveAssetsOK || !assetShowcaseOK || !feedbackLabelOK || !liveLayerAnimationOK || !referencePlacementOK || !rightColumnPlanOK || !featuredMediaOK || !detailPanelOK || !mediaLightboxOK || !fullPngContainOK;

  const missing = data.stages.filter((stage) => /缺失|不完整|未生成/.test(stage.statusLabel));
  if (missing.length) console.log(` ⚠️  missing evidence is shown, not reconstructed: ${missing.map((stage) => stage.id).join(', ')}`);
}

if (failed) process.exit(1);
console.log(`\n✅ Replay contract passed: ${input}\n`);
