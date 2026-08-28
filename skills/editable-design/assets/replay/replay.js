(() => {
  const data = window.__POSTER_REPLAY__;
  if (!data) {
    document.getElementById('stage-layer').innerHTML = '<p style="padding:40px">Replay data is missing.</p>';
    return;
  }

  const viewport = document.getElementById('canvas-viewport');
  const world = document.getElementById('canvas-world');
  const stageLayer = document.getElementById('stage-layer');
  const artifactLayer = document.getElementById('artifact-layer');
  const flowLines = document.getElementById('flow-lines');
  const detailPanel = document.getElementById('detail-panel');
  const detailContent = document.getElementById('detail-content');
  const mediaLightbox = document.getElementById('media-lightbox');
  const mediaLightboxFrame = document.getElementById('media-lightbox-frame');
  const mediaLightboxTitle = document.getElementById('media-lightbox-title');
  const mediaLightboxNote = document.getElementById('media-lightbox-note');
  const zoomLabel = document.getElementById('zoom-label');
  const phaseNav = document.getElementById('phase-nav');
  const WORLD_WIDTH = 2540;
  const WORLD_HEIGHT = 1780;
  const stageById = new Map(data.stages.map((stage) => [stage.id, stage]));
  const layout = {
    input:     { x: 260,  y: 110,  w: 490, h: 310 },
    reference: { x: 820,  y: 110,  w: 450, h: 330 },
    plan:      { x: 2075, y: 110,  w: 420, h: 360 },
    assets:    { x: 800,  y: 640,  w: 480, h: 390 },
    html:      { x: 1330, y: 640,  w: 690, h: 390 },
    review:    { x: 300,  y: 1240, w: 690, h: 380 },
    layers:    { x: 1330, y: 1240, w: 690, h: 380 }
  };
  const phaseColor = { think: '#567bc9', make: '#cf7626', prove: '#53856b' };
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let selected = null;
  let dragging = false;
  let dragOrigin = null;

  document.title = `${data.project.title} · Agent 创意轨迹`;
  document.getElementById('project-title').textContent = data.project.title;
  document.getElementById('project-status').textContent = data.project.status === 'ok' ? '已完成' : data.project.status;

  const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const shorten = (value = '', max = 620) => value.length > max ? `${value.slice(0, max).trim()}…` : value;

  function stageIcon(stage) {
    return `<img class="stage-icon" src="icons/${esc(stage.kind)}.png" alt="">`;
  }

  function inputVisual(stage) {
    const text = stage.raw || '未记录原始用户 Prompt。';
    return `<div class="input-body"><img src="icons/input.png" alt=""><p class="${stage.raw ? '' : 'missing'}">${esc(shorten(text, 520))}</p></div>`;
  }

  function referenceVisual(stage) {
    return `<div class="text-evidence"><small>Art-direction prompt</small><pre>${esc(shorten(stage.prompt || '未记录增强 Prompt。', 880))}</pre><div class="evidence-file">${esc(stage.promptSource || 'missing')}</div></div>`;
  }

  function planVisual(stage) {
    const slots = (stage.slots || []).slice(0, 8);
    const hasRecordedRects = slots.length > 0 && slots.every((slot) => {
      const rect = slot.rect || {};
      return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(rect[key]))) && Number(rect.width) > 0 && Number(rect.height) > 0;
    });
    let positionedSlots = [];
    if (hasRecordedRects) {
      const maxX = Math.max(1, ...slots.map((slot) => Number(slot.rect.x) + Number(slot.rect.width)));
      const maxY = Math.max(1, ...slots.map((slot) => Number(slot.rect.y) + Number(slot.rect.height)));
      positionedSlots = slots.map((slot) => ({
        slot,
        left: Math.max(1, Number(slot.rect.x) / maxX * 94),
        top: Math.max(1, Number(slot.rect.y) / maxY * 94),
        width: Math.max(12, Number(slot.rect.width) / maxX * 94),
        height: Math.max(12, Number(slot.rect.height) / maxY * 94)
      }));
    } else if (slots.length) {
      const columns = slots.length >= 5 ? 3 : slots.length >= 3 ? 2 : 1;
      const rows = Math.ceil(slots.length / columns);
      const gap = 3;
      const width = (92 - gap * (columns - 1)) / columns;
      const height = (88 - gap * (rows - 1)) / rows;
      positionedSlots = slots.map((slot, index) => ({
        slot,
        left: 4 + (index % columns) * (width + gap),
        top: 6 + Math.floor(index / columns) * (height + gap),
        width,
        height
      }));
    }
    const slotHTML = positionedSlots.length ? positionedSlots.map(({ slot, left, top, width, height }, index) => `<div class="plan-slot${hasRecordedRects ? '' : ' is-auto'}" style="left:${left}%;top:${top}%;width:${Math.min(width, 98-left)}%;height:${Math.min(height, 98-top)}%"><strong>${String(index + 1).padStart(2, '0')} · ${esc(slot.id || slot.label || 'slot')}</strong><span>${esc(slot.role || slot.form || slot.aspect || slot.prompt || '')}</span></div>`).join('') : '<div class="plan-empty"><strong>未记录可视化槽位</strong><span>右侧保留原始设计规划</span></div>';
    return `<div class="plan-body"><div class="plan-canvas">${slotHTML}</div><div class="plan-copy"><small>${esc(stage.architecture || 'DESIGN PLAN')}</small><strong>${esc(stage.planTitle || '版式与信息层级')}</strong><p>${esc(shorten(stage.raw || '', 300))}</p></div></div>`;
  }

  function assetsVisual(stage) {
    const first = stage.items?.[0] || {};
    const tabs = (stage.items || []).slice(0, 6).map((_, index) => `<span>${String(index + 1).padStart(2, '0')}</span>`).join('');
    return `<div class="asset-body"><header><strong>${esc(first.title || '生成 Prompt')}</strong><span>PROMPT 摘要 · ${stage.items?.length || 0}</span></header><pre>${esc(shorten(first.prompt || '未记录素材 Prompt。', 320))}</pre><div class="asset-tabs">${tabs}</div></div>`;
  }

  function htmlVisual(stage) {
    return `<div class="code-body"><div class="code-window"><span>index.html · live layers</span><pre>${esc(shorten(stage.code || '', 1700))}</pre></div><div class="code-facts"><small>RENDER CONTRACT</small><span>${esc(stage.canvas || 'fixed canvas')}</span><span>${stage.layerCount || 0} editable layers</span><span>${stage.groupCount || 0} explode groups</span></div></div>`;
  }

  function reviewVisual(stage) {
    const bullets = (stage.bullets || []).slice(0, 4);
    return `<div class="review-body"><div class="review-count"><strong>${stage.passCount || 1}</strong><span>REVIEW PASSES</span></div><div class="review-list">${bullets.map((line, index) => `<div>${String(index + 1).padStart(2, '0')} · ${esc(shorten(line, 96))}</div>`).join('') || '<div>未记录 Review 内容</div>'}</div></div>`;
  }

  function layersVisual(stage) {
    return `<div class="layers-body"><div class="layer-stat"><small>EDITABLE LAYERS</small><strong>${stage.layerCount || 0}</strong><span>data-layer-id</span></div><div class="layer-stat"><small>CONTENT GROUPS</small><strong>${stage.groupCount || 0}</strong><span>data-explode-group</span></div><div class="layer-stat"><small>OUTPUT</small><strong>${stage.preview ? 'LIVE' : '—'}</strong><span>${esc(stage.previewSource || '未生成分层展示')}</span></div></div>`;
  }

  const visualFor = { input: inputVisual, reference: referenceVisual, plan: planVisual, assets: assetsVisual, html: htmlVisual, review: reviewVisual, layers: layersVisual };

  function renderStage(stage) {
    const box = layout[stage.id];
    const article = document.createElement('article');
    article.className = 'stage-node';
    article.dataset.stage = stage.id;
    article.dataset.phase = stage.phase;
    article.style.cssText = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
    article.innerHTML = `<header class="stage-head">${stageIcon(stage)}<div class="stage-heading"><small>${esc(stage.order)} · ${esc(stage.kind)}</small><strong>${esc(stage.title)}</strong></div><span class="stage-status">${esc(stage.statusLabel || '已记录')}</span></header><div class="stage-body">${visualFor[stage.kind](stage)}</div><footer class="stage-meta"><span>${esc(stage.timeLabel || '')}</span><span>${esc(stage.artifactLabel || '')}</span></footer>`;
    article.addEventListener('click', (event) => { event.stopPropagation(); selectStage(stage.id); });
    stageLayer.appendChild(article);
  }

  function closeDetail(updateUrl = true) {
    detailPanel.classList.remove('is-open');
    selected = null;
    document.querySelectorAll('.stage-node').forEach((node) => node.classList.remove('is-selected'));
    phaseNav?.querySelectorAll('button').forEach((button) => button.classList.remove('is-active'));
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.delete('stage');
      history.replaceState(null, '', url);
    }
  }

  function closeMedia() {
    mediaLightbox.classList.remove('is-open');
    mediaLightbox.setAttribute('aria-hidden', 'true');
    mediaLightboxFrame.replaceChildren();
  }

  function openMedia(src, label, kind) {
    if (!src) return;
    closeDetail();
    mediaLightbox.dataset.kind = kind;
    mediaLightboxTitle.textContent = label;
    mediaLightboxNote.textContent = kind === 'animation' ? '交互式 HTML · 自动播放分层动画' : '高清图像预览';
    const media = document.createElement(kind === 'animation' ? 'iframe' : 'img');
    if (kind === 'animation') {
      const url = new URL(src, location.href);
      url.searchParams.delete('motion');
      url.searchParams.set('replay', String(Date.now()));
      media.src = url.href;
      media.title = label;
    } else {
      media.src = src;
      media.alt = label;
    }
    mediaLightboxFrame.replaceChildren(media);
    mediaLightbox.classList.add('is-open');
    mediaLightbox.setAttribute('aria-hidden', 'false');
    document.getElementById('media-lightbox-close')?.focus({ preventScroll: true });
  }

  function artifactCard({ className, x, y, w, h, src, label, code, contain = false, iframe = false, stage, openMode = 'detail' }) {
    if (!src) return;
    const figure = document.createElement('figure');
    figure.className = `external-artifact ${className}`;
    figure.dataset.stage = stage;
    figure.dataset.contain = contain ? 'true' : 'false';
    figure.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    figure.innerHTML = `${iframe ? `<iframe src="${esc(src)}" title="${esc(label)}"></iframe>` : `<img src="${esc(src)}" alt="${esc(label)}">`}<figcaption><span>${esc(label)}</span><span>${esc(code)}</span></figcaption>`;
    figure.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMode === 'image') openMedia(src, label, 'image');
      else if (openMode === 'animation') openMedia(src, label, 'animation');
      else selectStage(stage);
    });
    artifactLayer.appendChild(figure);
  }

  function renderArtifacts() {
    const reference = stageById.get('reference');
    artifactCard({ className: 'reference', x: 1538, y: 110, w: 270, h: 360, src: reference?.preview, label: '视觉参考', code: 'OUT 02', contain: true, stage: 'reference', openMode: 'image' });

    const assets = stageById.get('assets');
    const assetItems = (assets?.items || []).filter((item) => item.src).slice(0, 4);
    if (assetItems.length === 1) {
      const item = assetItems[0];
      artifactCard({ className: 'asset single-asset', x: 260, y: 610, w: 500, h: 440, src: item.src, label: item.title || 'Asset 1', code: 'OUT 04.1', contain: item.contain, stage: 'assets' });
    } else {
      assetItems.forEach((item, index) => artifactCard({ className: 'asset', x: 260 + (index % 2) * 260, y: 610 + Math.floor(index / 2) * 230, w: 240, h: 210, src: item.src, label: item.title || `Asset ${index + 1}`, code: `OUT 04.${index + 1}`, contain: item.contain, stage: 'assets' }));
    }

    const html = stageById.get('html');
    artifactCard({ className: 'render featured-output', x: 2075, y: 670, w: 420, h: 560, src: html?.render, label: '最终渲染结果', code: 'OUT 05', contain: true, stage: 'html', openMode: 'image' });

    const layers = stageById.get('layers');
    artifactCard({ className: 'layers', x: 2075, y: 1320, w: 420, h: 360, src: layers?.preview, label: '可编辑分层动画', code: 'OUT 07', contain: true, iframe: layers?.preview?.endsWith('.html') || layers?.preview?.includes('.html?'), stage: 'layers', openMode: 'animation' });
  }

  function renderLines() {
    const assetCount = (stageById.get('assets')?.items || []).filter((item) => item.src).slice(0, 4).length;
    const assetConnectorPaths = assetCount === 1
      ? ['M760 830 C775 830 790 830 800 830']
      : [
          'M500 715 C605 715 720 735 800 760',
          'M760 715 C775 715 790 730 800 760',
          'M500 945 C605 945 720 920 800 900',
          'M760 945 C775 945 790 920 800 900',
        ].slice(0, assetCount);
    const assetConnectors = assetConnectorPaths.map((d) => `<path class="flow-artifact make intro-path" d="${d}"/>`).join('');
    flowLines.innerHTML = `
      <defs>
        <marker id="arrow-blue" markerUnits="userSpaceOnUse" markerWidth="18" markerHeight="18" refX="16" refY="9" viewBox="0 0 18 18" orient="auto"><path d="M1,1 L17,9 L1,17 Z" fill="#567bc9"/></marker>
        <marker id="arrow-orange" markerUnits="userSpaceOnUse" markerWidth="18" markerHeight="18" refX="16" refY="9" viewBox="0 0 18 18" orient="auto"><path d="M1,1 L17,9 L1,17 Z" fill="#cf7626"/></marker>
        <marker id="arrow-green" markerUnits="userSpaceOnUse" markerWidth="18" markerHeight="18" refX="16" refY="9" viewBox="0 0 18 18" orient="auto"><path d="M1,1 L17,9 L1,17 Z" fill="#53856b"/></marker>
        <marker id="arrow-red" markerUnits="userSpaceOnUse" markerWidth="18" markerHeight="18" refX="16" refY="9" viewBox="0 0 18 18" orient="auto"><path d="M1,1 L17,9 L1,17 Z" fill="#df7058"/></marker>
      </defs>
      <path id="flow-input-reference" class="flow-main flow-path think" data-from="input" data-to="reference" data-color="#567bc9" marker-end="url(#arrow-blue)" d="M750 265 C770 265 790 265 820 265"/>
      <path id="flow-reference-plan" class="flow-artifact flow-path think" data-from="reference" data-to="plan" data-color="#567bc9" marker-end="url(#arrow-blue)" d="M1270 290 L2075 290"/>
      <path id="flow-plan-assets" class="flow-main flow-path make" data-from="plan" data-to="assets" data-color="#cf7626" marker-end="url(#arrow-orange)" d="M2285 470 C2285 570 1500 500 1040 640"/>
      ${assetConnectors}
      <path id="flow-assets-html" class="flow-main flow-path make" data-from="assets" data-to="html" data-color="#cf7626" marker-end="url(#arrow-orange)" d="M1280 835 C1295 835 1310 835 1330 835"/>
      <path id="flow-html-review" class="flow-main flow-path prove" data-from="html" data-to="review" data-color="#53856b" marker-end="url(#arrow-green)" d="M1675 1030 C1675 1150 1015 1140 890 1240"/>
      <path id="flow-review-layers" class="flow-main flow-path prove" data-from="review" data-to="layers" data-color="#53856b" marker-end="url(#arrow-green)" d="M990 1430 C1100 1430 1210 1430 1330 1430"/>
      <path id="flow-review-html-repair" class="flow-repair flow-path repair" data-from="review" data-to="html" data-color="#df7058" marker-end="url(#arrow-red)" d="M610 1240 C610 1130 1220 1170 1470 1030"/>
      <g class="flow-label prove-label" transform="translate(1010 1150)"><rect width="134" height="34" rx="9"/><text x="67" y="23" text-anchor="middle">反馈修正</text></g>`;
  }

  function mediaSection(src, title, iframe = false) {
    if (!src) return '';
    return `<section class="detail-section"><h3>${esc(title)}</h3><div class="detail-media">${iframe ? `<iframe src="${esc(src)}" title="${esc(title)}"></iframe>` : `<img src="${esc(src)}" alt="${esc(title)}">`}</div></section>`;
  }

  function textSection(title, text, code = false) {
    if (!text) return '';
    return `<section class="detail-section"><h3>${esc(title)}</h3><pre class="${code ? 'code' : ''}">${esc(text)}</pre></section>`;
  }

  function detailFor(stage) {
    let body = '';
    if (stage.kind === 'input') {
      body += textSection('原始用户 Prompt', stage.raw || '未记录原始用户 Prompt。');
      if (stage.attachments?.length) body += `<section class="detail-section"><h3>输入附件</h3><p>${stage.attachments.map(esc).join('\n')}</p></section>`;
    }
    if (stage.kind === 'reference') {
      body += textSection('增强后的视觉 Prompt', stage.prompt || '未记录。');
      body += mediaSection(stage.preview, '生成的视觉参考');
    }
    if (stage.kind === 'plan') {
      body += textSection('设计规划', stage.raw || '未记录。');
      if (stage.assetPlanRaw) body += textSection('asset-plan.json', stage.assetPlanRaw);
    }
    if (stage.kind === 'assets') {
      const overviewItems = (stage.items || []).filter((item) => item.src);
      if (overviewItems.length) {
        body += `<section class="detail-section asset-overview-section"><div class="detail-section-title"><h3>素材全览</h3><span>${overviewItems.length} ASSETS</span></div><div class="asset-overview-grid">${overviewItems.map((item, index) => `<figure><img src="${esc(item.src)}" alt="${esc(item.title || item.id || '')}" loading="lazy"><figcaption><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(item.title || item.id || `Asset ${index + 1}`)}</strong></figcaption></figure>`).join('')}</div></section>`;
      }
      body += `<section class="detail-section"><h3>Prompt + 结果</h3><div class="prompt-list">${(stage.items || []).map((item, index) => `<details class="prompt-item" ${index === 0 ? 'open' : ''}><summary><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(item.title || item.id || `Asset ${index + 1}`)}</strong></summary><div class="prompt-result">${item.src ? `<img src="${esc(item.src)}" alt="${esc(item.title || '')}">` : '<div></div>'}<pre>${esc(item.prompt || '未记录 Prompt。')}</pre></div></details>`).join('')}</div></section>`;
      body += textSection('prompts.md', stage.raw);
    }
    if (stage.kind === 'html') {
      body += textSection('index.html', stage.fullCode || stage.code, true);
      body += mediaSection(stage.render, '渲染结果');
    }
    if (stage.kind === 'review') {
      body += textSection('render-review.md', stage.raw || '未记录。');
    }
    if (stage.kind === 'layers') {
      body += `<section class="detail-section"><h3>分层契约</h3><p>${stage.layerCount || 0} editable layers\n${stage.groupCount || 0} explode groups\n${stage.componentCount || 0} gallery components</p></section>`;
      body += mediaSection(stage.preview, '可编辑分层动画（HTML）', stage.preview?.includes('.html'));
    }
    return `<div class="detail-head" style="--detail-color:${phaseColor[stage.phase]}"><img src="icons/${esc(stage.kind)}.png" alt=""><div><small>${esc(stage.order)} · ${esc(stage.kind)}</small><strong>${esc(stage.title)}</strong></div></div><div class="detail-body">${body}<section class="detail-section"><h3>真实来源</h3><p>${esc(stage.sources?.join('\n') || '无')}</p></section></div>`;
  }

  function selectStage(id, updateUrl = true) {
    const stage = stageById.get(id);
    if (!stage) return;
    selected = id;
    document.querySelectorAll('.stage-node').forEach((node) => node.classList.toggle('is-selected', node.dataset.stage === id));
    phaseNav?.querySelectorAll('button').forEach((button) => button.classList.toggle('is-active', button.dataset.phase === stage.phase));
    detailContent.innerHTML = detailFor(stage);
    detailPanel.classList.add('is-open');
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('stage', stage.order.replace(/^0/, ''));
      history.replaceState(null, '', url);
    }
  }

  function applyTransform() {
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    zoomLabel.value = `${Math.round(scale * 100)}%`;
    zoomLabel.textContent = zoomLabel.value;
    window.dispatchEvent(new CustomEvent('poster-replay-viewchange', { detail: { scale } }));
  }

  function fitView() {
    const pad = 34;
    const availableW = viewport.clientWidth - pad * 2;
    const availableH = viewport.clientHeight - pad * 2;
    scale = Math.min(1, availableW / WORLD_WIDTH, availableH / WORLD_HEIGHT);
    tx = (viewport.clientWidth - WORLD_WIDTH * scale) / 2;
    ty = (viewport.clientHeight - WORLD_HEIGHT * scale) / 2;
    applyTransform();
  }

  function zoomBy(factor, centerX = viewport.clientWidth / 2, centerY = viewport.clientHeight / 2) {
    const next = Math.max(.18, Math.min(1.65, scale * factor));
    const worldX = (centerX - tx) / scale;
    const worldY = (centerY - ty) / scale;
    scale = next;
    tx = centerX - worldX * scale;
    ty = centerY - worldY * scale;
    applyTransform();
  }

  data.stages.forEach(renderStage);
  renderArtifacts();
  renderLines();

  document.getElementById('fit-view').addEventListener('click', fitView);
  document.getElementById('zoom-out').addEventListener('click', () => zoomBy(.86));
  document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1.16));
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('media-lightbox-close').addEventListener('click', closeMedia);
  mediaLightbox.addEventListener('click', (event) => { if (event.target === mediaLightbox) closeMedia(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && mediaLightbox.classList.contains('is-open')) closeMedia(); });
  phaseNav?.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => selectStage(button.dataset.stage)));
  viewport.addEventListener('wheel', (event) => { if (event.target.closest('.detail-panel,.media-lightbox')) return; event.preventDefault(); const rect = viewport.getBoundingClientRect(); zoomBy(event.deltaY < 0 ? 1.08 : .92, event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
  viewport.addEventListener('pointerdown', (event) => { if (event.target.closest('.stage-node,.external-artifact,.phase-nav,.detail-panel,.view-controls')) return; dragging = true; dragOrigin = { x: event.clientX, y: event.clientY, tx, ty }; viewport.classList.add('is-panning'); viewport.setPointerCapture(event.pointerId); });
  viewport.addEventListener('pointermove', (event) => { if (!dragging) return; tx = dragOrigin.tx + event.clientX - dragOrigin.x; ty = dragOrigin.ty + event.clientY - dragOrigin.y; applyTransform(); });
  viewport.addEventListener('pointerup', () => { dragging = false; viewport.classList.remove('is-panning'); });
  window.addEventListener('resize', fitView);

  requestAnimationFrame(() => {
    fitView();
    const requested = new URLSearchParams(location.search).get('stage');
    const requestedStage = requested ? data.stages.find((item) => item.order.replace(/^0/, '') === requested || item.id === requested) : null;
    const defaultStage = document.body.dataset.defaultStage ? stageById.get(document.body.dataset.defaultStage) : null;
    const initialStage = requestedStage || defaultStage;
    if (window.__POSTER_REPLAY_MOTION__?.mount) {
      window.__POSTER_REPLAY_MOTION__.mount({ data, viewport, world, flowLines, phaseNav, detailPanel, selectStage, initialStage, getViewState: () => ({ scale, tx, ty }) });
    } else if (initialStage) {
      selectStage(initialStage.id, false);
    }
  });
})();
