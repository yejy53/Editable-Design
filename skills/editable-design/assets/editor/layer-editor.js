/* ============================================================
   layer-editor —— 海报图层微调编辑器
   与 layer-editor.css 配套。接入方式：在海报 HTML 的 </head> 前加两行
     <link rel="stylesheet" href="layer-editor.css">
     <script src="layer-editor.js" defer></script>
   海报本体无需任何改动，移除这两行即还原为纯海报。

   定位：微调工具，不是设计工具。只做「改位置 / 改尺寸 / 改文字 / 改字号字体 / 删图层」。
   前置契约：画布为固定 px 尺寸并声明 data-canvas-width/height；
             可编辑单元带 data-layer-id。详见 SKILL.md。
   ============================================================ */
(() => {
  'use strict';

  const canvas = document.querySelector('[data-canvas-width]') || document.querySelector('.poster-canvas');
  if (!canvas) {
    console.error('[layer-editor] 找不到画布：需要一个带 data-canvas-width 的根节点');
    return;
  }
  canvas.classList.add('hf-canvas');

  const CW = +canvas.dataset.canvasWidth || canvas.offsetWidth;
  const CH = +canvas.dataset.canvasHeight || canvas.offsetHeight;
  const SNAP = 8;          // 吸附阈值，画布坐标系下的像素
  const FS_STEP = 1.08;    // 字号每次缩放比例
  const MIN_W = 24;        // 手动缩放的最小图层宽度
  const MIN_H = 16;        // 手动缩放的最小图层高度
  const sourceSignature = (() => {
    let hash = 2166136261;
    const source = canvas.outerHTML;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  })();
  const sourceRevision = document.documentElement.dataset.hfSourceRevision || sourceSignature;
  const runtimeRevision = document.documentElement.dataset.hfRuntimeRevision || 'runtime-v1';
  const DRAFT_KEY = `hf-draft:${location.pathname}:${sourceRevision}:${runtimeRevision}`;
  const MOTION = {
    scan: 760, scanOverlap: 0.78,
    duration: 780, reverse: 620, stagger: 58,
    ease: 'cubic-bezier(.22,1,.36,1)',
  };
  const motionOff = () => matchMedia('(prefers-reduced-motion: reduce)').matches
    || new URLSearchParams(location.search).get('motion') === '0';

  const state = {
    scale: 1, sel: null, layers: [], undo: [],
    initial: new Map(), removed: [], ui: {},
    exploded: false, spread: null, spreadGeometry: new Map(),
    groups: new Map(),
    sourceCanvas: null,
    motion: [], motionToken: null, transitioning: false,
  };

  const round = (n) => Math.round(n * 10) / 10;
  const px = (n) => round(n) + 'px';
  const h = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };

  const CONTEXT_PROPS = [
    'display', 'box-sizing', 'overflow', 'overflow-x', 'overflow-y', 'opacity',
    'color', 'background-color', 'background-image', 'background-size',
    'background-position', 'background-repeat', 'background-clip',
    'border-top-width', 'border-top-style', 'border-top-color',
    'border-right-width', 'border-right-style', 'border-right-color',
    'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
    'border-left-width', 'border-left-style', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius',
    'box-shadow', 'filter', 'clip-path', 'mix-blend-mode',
    'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch',
    'font-variant', 'line-height', 'letter-spacing', 'word-spacing',
    'text-align', 'text-transform', 'text-decoration-line',
    'text-decoration-color', 'text-decoration-style', 'text-shadow',
    'white-space', 'writing-mode',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'align-items', 'align-content', 'justify-items', 'justify-content',
    'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows',
    'grid-auto-flow', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink',
    'object-fit', 'object-position', 'fill', 'stroke', 'stroke-width',
  ];
  const PSEUDO_PROPS = [
    'content', 'display', 'position', 'left', 'top', 'right', 'bottom',
    'width', 'height', 'box-sizing', 'opacity', 'color',
    'background-color', 'background-image', 'background-size', 'background-position',
    'border-top-width', 'border-top-style', 'border-top-color',
    'border-right-width', 'border-right-style', 'border-right-color',
    'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
    'border-left-width', 'border-left-style', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius',
    'transform', 'transform-origin', 'box-shadow', 'filter',
  ];

  const styleSnapshot = (el, pseudo, props) => {
    const cs = getComputedStyle(el, pseudo);
    return Object.fromEntries(props.map((prop) => [prop, cs.getPropertyValue(prop)]));
  };
  const changedDeclarations = (el, pseudo, before, props) => {
    const after = getComputedStyle(el, pseudo);
    return props.filter((prop) => after.getPropertyValue(prop) !== before[prop])
      .map((prop) => `${prop}:${before[prop]};`).join('');
  };

  /* ---------------------------------------------------------------
   * 1. 布局固化
   *
   * 海报里通常只有少数图层是绝对定位的，其余活在文档流（margin 流、
   * flex）里 —— 没有 left/top 就无从拖起。这里把每个图层此刻的实际
   * 位置量出来，统一改写成相对画布的绝对坐标。
   *
   * 必须严格分成「先全部量完，再全部改写」两趟：一旦边量边改，前面的
   * 元素脱离文档流会让后面的元素往上跳，量到的就全是错的。
   * ------------------------------------------------------------- */
  function bake() {
    state.sourceCanvas = canvas.cloneNode(true);
    const layers = [...canvas.querySelectorAll('[data-layer-id]')];
    const cRect = canvas.getBoundingClientRect();
    const rel = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - cRect.left, top: r.top - cRect.top, width: r.width, height: r.height };
    };

    // 可选的一级内容模块契约：未标组时保持扁平内容拆解；标组时把完整
    // 模块作为一个画廊单元，不再继续钻取内部叶子。叶子提升到画布前
    // 仍要固化归属，确保下载后的 baked HTML 再接线时能恢复模块组合，
    // 而不依赖原来的 DOM 嵌套关系。
    const groupNodes = [...canvas.querySelectorAll('[data-explode-group]')];
    const groupDefs = groupNodes.map((el) => {
      const id = (el.dataset.explodeGroup || '').trim();
      const nested = layers.filter((layer) => layer.closest('[data-explode-group]') === el);
      const explicit = layers.filter((layer) => (layer.dataset.explodeParent || '').trim() === id);
      const members = [...new Set([...nested, ...explicit])];
      return {
        id, el,
        label: (el.dataset.explodeLabel || id).trim() || id,
        members,
        memberIds: members.map((layer) => layer.dataset.layerId),
        box: rel(el),
      };
    }).filter((group) => group.id && group.members.length >= 2);
    state.groups = new Map(groupDefs.map((group) => [group.id, group]));
    for (const group of groupDefs) {
      for (const member of group.members) member.dataset.explodeParent = group.id;
    }

    // 提升叶子后仍要复刻原来的组内绘制顺序：surface/image 在底层，
    // 留在组容器里的分隔线、遮罩和轨道居中，copy/icon/decoration 在上层。
    // 每个顶层模块占用独立的 z 段，模块之间继续遵循原 DOM 顺序。
    const topChildren = [...canvas.children];
    const topOf = (el) => {
      let top = el;
      while (top.parentElement && top.parentElement !== canvas) top = top.parentElement;
      return top;
    };
    // 顶层绘制顺序不能只看 DOM 顺序：显式 z-index 会让较早出现的装饰
    // 盖到较晚元素之上。先按浏览器的粗粒度 stacking 顺序排一次，
    // 再给每个顶层模块分配独立 z 段。
    const topPaintOrder = [...topChildren].sort((a, b) => {
      const za = getComputedStyle(a).zIndex;
      const zb = getComputedStyle(b).zIndex;
      const na = za === 'auto' || !Number.isFinite(+za) ? 0 : +za;
      const nb = zb === 'auto' || !Number.isFinite(+zb) ? 0 : +zb;
      return na - nb || topChildren.indexOf(a) - topChildren.indexOf(b);
    });
    const topRank = new Map(topPaintOrder.map((el, index) => [el, (index + 1) * 100]));
    const stackBase = (el) => topRank.get(topOf(el)) || 100;
    for (const top of topChildren) {
      // 未被标成叶子图层的顶层视觉（背景图、scrim、路线装饰）也要进入
      // 同一套绘制顺序，否则提升后的图层会无条件盖过它们。
      top.style.zIndex = String(stackBase(top) + 30);
    }
    const memberGroup = new Map();
    for (const group of groupDefs) {
      group.stackBase = stackBase(group.el);
      // 有独立 surface 叶子的模块通常把容器留给分隔线/遮罩，容器应位于
      // surface/image 与 copy 之间；若没有 surface 叶子，容器自身往往
      // 就是卡片底色，必须放在 image 之下，不能把照片盖住。
      const hasSurface = group.members.some((member) => member.dataset.explodeRole === 'surface');
      group.el.style.zIndex = String(group.stackBase + (hasSurface ? 30 : 10));
      for (const member of group.members) memberGroup.set(member, group);
    }
    const stackZ = (el) => {
      const group = memberGroup.get(el);
      if (!group) return String(stackBase(el) + 50);
      const role = (el.dataset.explodeRole || 'copy').trim();
      const rank = { surface: 10, image: 20, copy: 40, icon: 45, decoration: 46 }[role] || 40;
      return String(group.stackBase + rank);
    };

    // 图层被抽走后，原先靠内容撑开的容器会塌陷；用 bottom 定位的容器
    // 一塌陷，容器内未被抽走的元素（如分隔线）就会整体位移。先钉死尺寸。
    const holders = new Set();
    for (const el of layers) {
      for (let p = el.parentElement; p && p !== canvas; p = p.parentElement) holders.add(p);
    }

    const layerBox = layers.map((el) => {
      const computed = getComputedStyle(el);
      return {
        el, id: el.dataset.layerId, box: rel(el), z: stackZ(el),
        // getBoundingClientRect() 是 transform 之后的可见包围盒，不能把它
        // 直接写回 width/height 再重新施加 transform。保存布局尺寸与矩阵，
        // 提升到画布后再用包围盒差值校准 left/top。
        layoutWidth: parseFloat(computed.width) || el.offsetWidth,
        layoutHeight: parseFloat(computed.height) || el.offsetHeight,
        transform: computed.transform,
        transformOrigin: computed.transformOrigin,
        scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
        context: styleSnapshot(el, null, CONTEXT_PROPS),
        before: styleSnapshot(el, '::before', PSEUDO_PROPS),
        after: styleSnapshot(el, '::after', PSEUDO_PROPS),
      };
    });
    const holderBox = [...holders].map((el) => ({
      el, box: rel(el),
      local: { left: el.offsetLeft, top: el.offsetTop },
    }));

    for (const { el, box, local } of holderBox) {
      if (getComputedStyle(el).position === 'absolute') {
        // holder 仍留在原父级，left/top 必须使用父级坐标。旧实现写入
        // 画布坐标，会让嵌套容器把父级偏移再加一次，产生大面积漂移。
        Object.assign(el.style, { left: px(local.left), top: px(local.top), right: 'auto', bottom: 'auto' });
      }
      Object.assign(el.style, { width: px(box.width), height: px(box.height), pointerEvents: 'none' });
    }

    // 提升到画布直属子节点，让所有图层共用同一个坐标系。
    // 插入位置紧跟原来的顶层祖先，以维持原有的绘制顺序。
    const anchors = new Map();
    for (const { el, box, z, layoutWidth, layoutHeight, transform, transformOrigin } of layerBox) {
      let top = el;
      while (top.parentElement !== canvas) top = top.parentElement;
      if (top !== el) {
        (anchors.get(top) || top).insertAdjacentElement('afterend', el);
        anchors.set(top, el);
      }
      Object.assign(el.style, {
        position: 'absolute',
        left: px(box.left), top: px(box.top), width: px(layoutWidth), height: px(layoutHeight),
        right: 'auto', bottom: 'auto',
        margin: '0',
        transform, transformOrigin,
        pointerEvents: 'auto',
      });
      if (z) el.style.zIndex = z;
      el.classList.add('hf-draggable');
    }

    // 旋转/位移后的 bounding box 左上角通常不等于 CSS left/top；第一次
    // 写入只是临时锚点。按原始可见包围盒反算一次锚点，保持旋转的回形针、
    // 邮戳、手写贴纸等逐像素落在原处。
    for (const rec of layerBox) {
      const visible = rel(rec.el);
      rec.el.style.left = px(parseFloat(rec.el.style.left) + rec.box.left - visible.left);
      rec.el.style.top = px(parseFloat(rec.el.style.top) + rec.box.top - visible.top);
    }

    // 图层离开语义容器后，`.dark-card .label` 这类上下文选择器不再
    // 命中。只把确实发生变化的视觉属性固化为内联值；同时为伪元素
    // 生成最小覆盖规则。这样既保留原稿，又不把整份 computed style
    // 粗暴复制进导出物。
    const pseudoRules = [];
    for (const rec of layerBox) {
      const current = getComputedStyle(rec.el);
      for (const prop of CONTEXT_PROPS) {
        if (current.getPropertyValue(prop) !== rec.context[prop]) {
          rec.el.style.setProperty(prop, rec.context[prop]);
        }
      }
      // shrink-to-fit 文本的测量值带小数；写回到 0.1px 后偶尔会少掉
      // 几百分之一像素，恰好触发多一行换行。只在真实 scroll 尺寸
      // 超过原稿时逐像素补宽，最多 8px，不碰正常固定宽度图层。
      for (let extra = 0; extra < 8 && (
        rec.el.scrollHeight > rec.scrollHeight + .5
        || rec.el.scrollWidth > rec.scrollWidth + .5
      ); extra++) {
        rec.el.style.width = px(parseFloat(rec.el.style.width) + 1);
      }
      const escaped = rec.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const beforeDecl = changedDeclarations(rec.el, '::before', rec.before, PSEUDO_PROPS);
      const afterDecl = changedDeclarations(rec.el, '::after', rec.after, PSEUDO_PROPS);
      if (beforeDecl) pseudoRules.push(`[data-layer-id="${escaped}"]::before{${beforeDecl}}`);
      if (afterDecl) pseudoRules.push(`[data-layer-id="${escaped}"]::after{${afterDecl}}`);
    }
    if (pseudoRules.length) {
      const style = document.createElement('style');
      style.dataset.hfRuntimeContext = '1';
      style.textContent = pseudoRules.join('\n');
      document.head.appendChild(style);
    }

    state.layers = layerBox.map(({ el, id }) => ({ el, id }));
    for (const { el, id } of state.layers) {
      state.initial.set(id, {
        left: parseFloat(el.style.left), top: parseFloat(el.style.top),
        width: parseFloat(el.style.width), height: parseFloat(el.style.height),
      });
    }
  }

  // 元素移出原容器后会丢掉继承来的层级，先把最近一个显式 z-index 记下来
  function inheritedZ(el) {
    for (let n = el; n && n !== canvas; n = n.parentElement) {
      const z = getComputedStyle(n).zIndex;
      if (z !== 'auto') return z;
    }
    return '';
  }

  /* ---------------------------------------------------------------
   * 2. 文本槽
   *
   * 可编辑单元是「文本槽」而非整个图层：价格这类图层内部靠多个不同
   * 字号的 span 拼出排版，整块设成 contenteditable 的话，一个退格就
   * 能删掉 span，样式随之崩掉。所以只把承载文字的叶子节点标为可编辑。
   * ------------------------------------------------------------- */
  function markSlots() {
    for (const { el } of state.layers) {
      for (const slot of findSlots(el)) slot.classList.add('hf-slot');
    }
  }

  function findSlots(root) {
    const out = [];
    (function walk(n) {
      if (n instanceof SVGElement) return;      // 二维码、装饰图形不参与文本编辑
      // 叶子节点，或「加 <b>3</b> 元升级」这种图文混排，都作为一个整体编辑
      const ownText = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (!n.children.length || ownText) {
        if (n.textContent.trim()) out.push(n);
        return;
      }
      for (const c of n.children) walk(c);
    })(root);
    return out;
  }

  // 图层自身可能就是一个槽（此时它内部不会再有子槽）
  const slotsOf = (layer) => {
    const out = layer.classList.contains('hf-slot') ? [layer] : [];
    out.push(...layer.querySelectorAll('.hf-slot'));
    return out;
  };

  /* ---------------------------------------------------------------
   * 3. 编辑器 UI（全部动态创建，海报 HTML 里不留痕迹）
   * ------------------------------------------------------------- */
  function buildUI() {
    const title = (document.title || '海报').slice(0, 40);
    const bar = h(`
      <div class="hf-bar">
        <span class="hf-title">${title}</span>
        <span class="hf-sep"></span>
        <button class="hf-btn" id="hf-undo" disabled>撤销</button>
        <button class="hf-btn" id="hf-reset">还原初始布局</button>
        <button class="hf-btn" id="hf-explode">拆解视图</button>
        <span class="hf-sep"></span>
        <button class="hf-btn primary" id="hf-save">下载 HTML</button>
        <button class="hf-btn" id="hf-explode-save">下载拆解稿</button>
        <button class="hf-btn" id="hf-css">复制定位 CSS</button>
        <label class="hf-zoom">缩放
          <input type="range" id="hf-scale" min="10" max="100" step="1">
          <output id="hf-scale-out">—</output>
        </label>
      </div>`);

    const panel = h(`
      <div class="hf-panel">
        <div class="hf-draft" id="hf-draft" hidden>
          <span id="hf-draft-msg"></span>
          <button class="hf-btn" id="hf-draft-drop">丢弃草稿</button>
        </div>
        <h4>图层</h4>
        <div class="hf-layers" id="hf-layers"></div>
        <div class="hf-props" id="hf-props" hidden>
          <h4 style="padding-left:0">属性</h4>
          <div class="hf-field">
            <label>字号</label>
            <div class="hf-step">
              <button class="hf-btn" id="hf-fs-down">A−</button>
              <span class="val" id="hf-fs-val">—</span>
              <button class="hf-btn" id="hf-fs-up">A+</button>
            </div>
          </div>
          <div class="hf-field">
            <label>尺寸</label>
            <span class="hf-size-val" id="hf-size-val">—</span>
          </div>
          <div class="hf-field" id="hf-ff-field">
            <label>字体</label>
            <select id="hf-ff"></select>
          </div>
          <button class="hf-btn danger" id="hf-del">删除此图层</button>
        </div>
        <div class="hf-hint">
          <b>单击</b>选中并拖动　<b>绿色手柄</b>改宽高<br>
          <b>双击</b>改文字　<b>角点</b>同时改宽高<br>
          <kbd>方向键</kbd> 微调 1px　<kbd>Shift</kbd>+<kbd>方向键</kbd> 10px<br>
          <kbd>Alt</kbd> 临时关闭吸附　<kbd>Delete</kbd> 删除图层<br>
          <kbd>Enter</kbd> 提交文字　<kbd>Esc</kbd> 放弃本次修改<br>
          <kbd>⌘Z</kbd> 撤销　<kbd>⌘S</kbd> 下载
        </div>
      </div>`);

    const modal = h(`
      <div class="hf-modal" id="hf-modal" hidden>
        <div class="box">
          <header>
            <span id="hf-modal-title">导出</span>
            <button class="hf-btn hf-spacer" id="hf-modal-copy">复制</button>
            <button class="hf-btn" id="hf-modal-close">关闭</button>
          </header>
          <textarea id="hf-modal-text" spellcheck="false" readonly></textarea>
        </div>
      </div>`);

    const toast = h('<div class="hf-toast" id="hf-toast" hidden></div>');
    document.body.append(bar, panel, modal, toast);
    for (const id of ['undo', 'reset', 'explode', 'save', 'explode-save', 'css', 'scale', 'scale-out', 'layers', 'props',
      'fs-down', 'fs-up', 'fs-val', 'size-val', 'ff', 'ff-field', 'del', 'modal', 'modal-title',
      'modal-text', 'modal-copy', 'modal-close', 'toast', 'draft', 'draft-msg', 'draft-drop']) {
      state.ui[id] = document.getElementById('hf-' + id);
    }
  }

  const $ = (id) => state.ui[id];

  /* ---------------------------------------------------------------
   * 4. 舞台与缩放：画布通常放不进屏幕，整体 scale 显示
   * ------------------------------------------------------------- */
  const guides = Object.assign(document.createElement('div'), { className: 'hf-guides' });
  const resizeOverlay = h(`
    <div class="hf-resize-overlay" hidden>
      <i class="hf-resize-handle nw" data-hf-resize-dir="nw"></i>
      <i class="hf-resize-handle n" data-hf-resize-dir="n"></i>
      <i class="hf-resize-handle ne" data-hf-resize-dir="ne"></i>
      <i class="hf-resize-handle e" data-hf-resize-dir="e"></i>
      <i class="hf-resize-handle se" data-hf-resize-dir="se"></i>
      <i class="hf-resize-handle s" data-hf-resize-dir="s"></i>
      <i class="hf-resize-handle sw" data-hf-resize-dir="sw"></i>
      <i class="hf-resize-handle w" data-hf-resize-dir="w"></i>
    </div>`);
  let stage;

  function buildStage() {
    document.body.classList.add('hf-on');
    const wrap = Object.assign(document.createElement('div'), { className: 'hf-stage-wrap' });
    stage = Object.assign(document.createElement('div'), { className: 'hf-stage' });
    document.body.insertBefore(wrap, document.body.firstChild);
    wrap.appendChild(stage);
    stage.appendChild(canvas);
    stage.appendChild(guides);
    stage.appendChild(resizeOverlay);
    setScale(fitScale());
  }

  const fitScale = () => {
    const w = state.exploded && state.spread ? state.spread.width : CW;
    const h = state.exploded && state.spread ? state.spread.height : CH;
    return Math.min((window.innerWidth - 300 - 96) / w, (window.innerHeight - 52 - 72) / h);
  };

  function setScale(s) {
    state.scale = Math.max(0.1, Math.min(1, s));
    if (state.exploded && state.spread) {
      state.spread.board.style.transform = `scale(${state.scale})`;
      stage.style.width = state.spread.width * state.scale + 'px';
      stage.style.height = state.spread.height * state.scale + 'px';
    } else {
      canvas.style.transform = `scale(${state.scale})`;
      stage.style.width = CW * state.scale + 'px';
      stage.style.height = CH * state.scale + 'px';
    }
    $('scale').value = Math.round(state.scale * 100);
    $('scale-out').textContent = Math.round(state.scale * 100) + '%';
    updateResizeOverlay();
  }

  /* ---------------------------------------------------------------
   * 5. 拆解视图
   *
   * 把当前已经固化的成稿拆成完整总览、背景基底与一级内容模块，
   * 再铺成横向组件画廊；内容仍保留原 DOM / CSS，不改编辑状态。
   * ------------------------------------------------------------- */
  const cleanClone = (root) => {
    for (const n of [root, ...root.querySelectorAll('*')]) {
      if (n.classList) {
        for (const c of [...n.classList]) if (c.startsWith('hf-')) n.classList.remove(c);
        if (!n.getAttribute('class')) n.removeAttribute('class');
      }
      n.removeAttribute('contenteditable');
      for (const a of [...n.attributes]) if (a.name.startsWith('data-hf-')) n.removeAttribute(a.name);
    }
    root.style.transform = '';
    return root;
  };

  const finishExplodedSource = (copy, transparent = false, marker = 'layer') => {
    for (const n of copy.querySelectorAll('[data-layer-id]')) {
      if (marker === 'layer') {
        n.dataset.explodedLayer = n.dataset.layerId;
        const live = state.layers.find((layer) => layer.id === n.dataset.layerId)?.el;
        const opacity = live ? Number.parseFloat(getComputedStyle(live).opacity) : 1;
        if (Number.isFinite(opacity) && opacity < .55) {
          n.style.opacity = String(Math.max(.46, Math.min(.68, opacity * 1.8)));
          n.dataset.explodedVisibilityBoosted = '1';
        }
      }
      if (marker === 'reference') n.dataset.explodedReferenceLayer = n.dataset.layerId;
      n.removeAttribute('data-layer-id');
    }
    copy.classList.add('hf-exploded-source');
    Object.assign(copy.style, {
      position: 'absolute', left: '0', top: '0',
      transform: 'none', transformOrigin: 'top left',
    });
    if (transparent) Object.assign(copy.style, { background: 'transparent', boxShadow: 'none' });
    return copy;
  };

  const parseColor = (value) => {
    const raw = String(value);
    const rgb = raw.match(/rgba?\((\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*(?:\.\d+)?))?/i);
    if (rgb) return { rgb: rgb.slice(1, 4).map(Number), alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) };
    const hex = raw.match(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i);
    if (!hex) return null;
    const value6 = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return {
      rgb: [0, 2, 4].map((i) => parseInt(value6.slice(i, i + 2), 16)), alpha: 1,
    };
  };

  function posterBackgroundRGB() {
    const cs = getComputedStyle(canvas);
    const solid = parseColor(cs.backgroundColor);
    if (solid && solid.alpha > .25) return solid.rgb;
    // 许多纸张海报用纯渐变覆盖整块画布，background-color 本身是
    // transparent。此时从 background-image 中选第一个近乎不透明的颜色；
    // 低透明度网点/纹理不应把暖白纸张误判成黑色舞台。
    const tokens = String(cs.backgroundImage).match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/ig) || [];
    for (const token of tokens) {
      const parsed = parseColor(token);
      if (parsed && parsed.alpha > .65) return parsed.rgb;
    }
    // 最后退到页面底色；仍透明时使用中性暖白。
    for (const el of [canvas.parentElement, document.body, document.documentElement]) {
      if (!el) continue;
      const parsed = parseColor(getComputedStyle(el).backgroundColor);
      if (parsed && parsed.alpha > .25) return parsed.rgb;
    }
    return [244, 241, 232];
  }

  function explodedTheme() {
    const rgb = posterBackgroundRGB();
    const linear = rgb.map((n) => {
      const c = n / 255;
      return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    });
    const light = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722 > .52;
    const bg = `rgb(${rgb.map((n) => Math.round(n)).join(',')})`;
    const labelRGB = rgb.map((n) => Math.max(0, Math.min(255, Math.round(n * .42))));
    return light ? {
      kind: 'light', bg, fg: '#26313a',
      border: 'rgba(38,49,58,.28)', labelBg: 'rgba(255,255,255,.92)',
      labelFg: '#26313a', shadow: 'rgba(31,42,48,.18)',
    } : {
      kind: 'dark', bg, fg: '#f7fbff',
      border: 'rgba(247,251,255,.40)', labelBg: `rgba(${labelRGB.join(',')},.88)`,
      labelFg: '#f7fbff', shadow: 'rgba(0,0,0,.34)',
    };
  }

  function applyExplodedTheme(board) {
    const theme = explodedTheme();
    board.dataset.explodedTheme = theme.kind;
    board.style.setProperty('--hf-exploded-bg', theme.bg);
    board.style.setProperty('--hf-exploded-fg', theme.fg);
    board.style.setProperty('--hf-exploded-border', theme.border);
    board.style.setProperty('--hf-exploded-label-bg', theme.labelBg);
    board.style.setProperty('--hf-exploded-label-fg', theme.labelFg);
    board.style.setProperty('--hf-exploded-shadow', theme.shadow);
    return theme;
  }

  function isolatedCanvas(layerId = null) {
    const copy = cleanClone(canvas.cloneNode(true));
    copy.querySelectorAll('script').forEach((n) => n.remove());
    const layerNodes = [...copy.querySelectorAll('[data-layer-id]')];
    if (layerId) {
      const keep = layerNodes.find((n) => n.dataset.layerId === layerId);
      for (const child of [...copy.children]) if (child !== keep) child.remove();
    } else {
      for (const n of layerNodes) n.remove();
      // 背景组件不重复呈现已被抽成一级内容模块的表面。
      for (const n of [...copy.querySelectorAll('[data-explode-group]')]) {
        if (state.groups.has(n.dataset.explodeGroup)) n.remove();
      }
    }
    return finishExplodedSource(copy, !!layerId, 'layer');
  }

  function isolatedOverviewCanvas() {
    const copy = cleanClone(canvas.cloneNode(true));
    copy.querySelectorAll('script').forEach((n) => n.remove());
    return finishExplodedSource(copy, false, 'none');
  }

  const topChildOf = (root, node) => {
    let top = node;
    while (top && top.parentElement !== root) top = top.parentElement;
    return top;
  };

  function isolatedGroupCanvas(groupId) {
    const group = state.groups.get(groupId);
    const copy = cleanClone(canvas.cloneNode(true));
    copy.querySelectorAll('script').forEach((n) => n.remove());
    if (!group) return finishExplodedSource(copy, true, 'layer');

    const memberIds = new Set(group.memberIds);
    const target = [...copy.querySelectorAll('[data-explode-group]')]
      .find((n) => n.dataset.explodeGroup === groupId);
    const keepTop = target ? topChildOf(copy, target) : null;
    for (const child of [...copy.children]) {
      const member = child.dataset.layerId && memberIds.has(child.dataset.layerId);
      if (child !== keepTop && !member) child.remove();
    }
    if (keepTop) {
      for (const n of [...keepTop.querySelectorAll('[data-explode-group]')]) {
        if (n.dataset.explodeGroup !== groupId) {
          // Grid/Flex 模块不能直接删兄弟：目标卡会自动补到第一个槽位，
          // 原坐标裁切时便只剩提升后的文字，卡片底色已经跑走。隐藏但保留
          // 占位，既维持布局轨道，又不会把其他模块画进当前切片。
          n.style.visibility = 'hidden';
          n.setAttribute('aria-hidden', 'true');
        }
      }
    }
    for (const n of [...copy.querySelectorAll('[data-layer-id]')]) {
      if (!memberIds.has(n.dataset.layerId)) n.remove();
    }
    return finishExplodedSource(copy, true, 'layer');
  }

  const cropOf = (g) => {
    const pad = Math.min(84, Math.max(16, Math.max(CW, CH) * 0.035));
    const left = Math.max(0, g.left - pad);
    const top = Math.max(0, g.top - pad);
    const right = Math.min(CW, g.left + g.width + pad);
    const bottom = Math.min(CH, g.top + g.height + pad);
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  };

  function makeExplodedItem(rec, scale, interactive) {
    const tile = Object.assign(document.createElement('div'), { className: 'hf-exploded-item' });
    tile.dataset.layerName = rec.id;
    tile.dataset.explodedUnit = rec.kind;
    if (rec.supplementalText) tile.dataset.explodedTextSupplement = '1';
    if (rec.kind === 'group') tile.dataset.explodedGroup = rec.group.id;
    if (rec.kind === 'background') tile.dataset.explodedBackground = '1';
    if (rec.kind === 'overview') tile.dataset.explodedOverview = '1';
    tile.title = rec.label || rec.id;
    tile.style.width = px(rec.crop.width * scale);
    tile.style.height = px(rec.crop.height * scale);
    tile.style.zIndex = rec.kind === 'overview' ? '30' : rec.kind === 'background' ? '1' : '10';

    const crop = Object.assign(document.createElement('div'), { className: 'hf-exploded-crop' });
    Object.assign(crop.style, {
      width: px(rec.crop.width), height: px(rec.crop.height),
      transform: `scale(${scale})`, transformOrigin: 'top left',
    });
    const source = rec.kind === 'group' ? isolatedGroupCanvas(rec.group.id)
      : rec.kind === 'overview' ? isolatedOverviewCanvas()
        : rec.kind === 'background' ? isolatedCanvas()
          : isolatedCanvas(rec.id);
    source.style.left = px(-rec.crop.left);
    source.style.top = px(-rec.crop.top);
    crop.appendChild(source);
    tile.appendChild(crop);
    if (rec.kind !== 'layer') {
      const label = Object.assign(document.createElement('div'), {
        className: 'hf-exploded-label', textContent: rec.label,
      });
      label.setAttribute('aria-hidden', 'true');
      tile.appendChild(label);
    }
    if (interactive && rec.kind !== 'group') tile.addEventListener('click', async () => {
      await setExploded(false);
      const live = state.layers.find((l) => l.id === rec.id);
      if (live) select(live.el);
    });
    return tile;
  }

  function makeExplodedBoard(interactive = true) {
    // 舞台保持与海报高度相同，并给横向组件画廊足够宽度。终态没有
    // 永久中央基底：完整成稿、背景和内容都使用同一种 tile 排布。
    const width = Math.round(Math.max(CW * 1.7, CH * 1.275));
    const height = CH;
    const margin = height * 0.045;
    const board = Object.assign(document.createElement('div'), { className: 'hf-exploded-board' });
    const theme = applyExplodedTheme(board);
    board.dataset.explodedLevel = '1';
    board.dataset.width = width;
    board.dataset.height = height;
    Object.assign(board.style, { width: px(width), height: px(height) });

    const layerRecords = state.layers.map(({ el, id }, index) => {
      const g = state.exploded && state.spreadGeometry.has(id)
        ? state.spreadGeometry.get(id) : geom(el);
      return { kind: 'layer', el, id, index, g, crop: cropOf(g), area: g.width * g.height };
    }).filter((r) => r.g.width > 0 && r.g.height > 0);
    const grouped = new Set([...state.groups.values()].flatMap((group) => group.memberIds));
    const unionBox = (records) => {
      if (!records.length) return null;
      const left = Math.min(...records.map((rec) => rec.g.left));
      const top = Math.min(...records.map((rec) => rec.g.top));
      const right = Math.max(...records.map((rec) => rec.g.left + rec.g.width));
      const bottom = Math.max(...records.map((rec) => rec.g.top + rec.g.height));
      return { left, top, width: right - left, height: bottom - top };
    };
    const moduleRecords = [...state.groups.values()].map((group) => {
      const members = group.memberIds.map((id) => layerRecords.find((rec) => rec.id === id)).filter(Boolean);
      const index = Math.min(...group.memberIds.map((id) =>
        layerRecords.find((rec) => rec.id === id)?.index ?? Number.MAX_SAFE_INTEGER));
      const memberBox = unionBox(members);
      const declared = group.box;
      const declaredArea = Math.max(0, declared.width) * Math.max(0, declared.height);
      const memberArea = memberBox ? memberBox.width * memberBox.height : 0;
      const g = declared.width > 1 && declared.height > 1 && declaredArea >= memberArea * .2
        ? declared : memberBox;
      if (!g) return null;
      return {
        kind: 'group', id: `group:${group.id}`, label: group.label, group,
        index, g, crop: cropOf(g), area: g.width * g.height,
      };
    }).filter(Boolean);
    const primaryContentRecords = [...layerRecords.filter((rec) => !grouped.has(rec.id)), ...moduleRecords];
    const isTextLayer = (rec) => {
      const role = (rec.el.dataset.explodeRole || 'copy').trim();
      if (['surface', 'image', 'icon', 'decoration'].includes(role)) return false;
      return Boolean((rec.el.innerText || rec.el.textContent || '').replace(/\s+/g, ' ').trim());
    };
    const supplementalTextRecords = primaryContentRecords.length < 5
      ? layerRecords.filter((rec) => grouped.has(rec.id) && isTextLayer(rec))
        .map((rec) => ({ ...rec, supplementalText: true }))
      : [];
    const contentRecords = [...primaryContentRecords, ...supplementalTextRecords]
      .sort((a, b) => a.index - b.index)
      .map((rec) => ({ ...rec, motionOrder: Math.min(12, rec.index + 1) }));
    const full = { left: 0, top: 0, width: CW, height: CH };
    const overview = {
      kind: 'overview', id: '__overview__', label: '完整成稿总览', index: -2,
      motionOrder: 0, g: full, crop: full, area: CW * CH,
    };
    const background = {
      kind: 'background', id: '__background__', label: '背景基底', index: Number.MAX_SAFE_INTEGER,
      motionOrder: 13, g: full, crop: full, area: CW * CH,
    };
    const records = [overview, ...contentRecords, background];
    board.dataset.explodedPrimaryCount = primaryContentRecords.length;
    board.dataset.explodedTextSupplements = supplementalTextRecords.length;

    // 动画原点仍是一张可读的完整成稿。所有 tile 先叠回这个矩形，
    // 扫描结束后再散开；overview 在最上层保证起始画面像素完整。
    const originScale = Math.min((width * 0.52) / CW, (height * 0.86) / CH, 1);
    const originW = CW * originScale, originH = CH * originScale;
    const originLeft = (width - originW) / 2, originTop = (height - originH) / 2;

    // 扫描层覆盖“尚未拆开”的中央成稿。它只负责视觉提示，不参与
    // 几何和导出图层计数；扫描结束后保持透明，由同一 WAAPI 时间线驱动。
    const scan = Object.assign(document.createElement('div'), {
      className: 'hf-exploded-scan', ariaHidden: 'true',
    });
    Object.assign(scan.style, {
      left: px(originLeft), top: px(originTop), width: px(originW), height: px(originH),
    });
    scan.append(
      Object.assign(document.createElement('div'), { className: 'hf-exploded-scan-grid' }),
      Object.assign(document.createElement('div'), { className: 'hf-exploded-scan-beam' }),
    );
    board.appendChild(scan);

    // 组件数少时两列、常规三列、极多时最多五列。列数只由组件数决定，
    // 不依赖海报题材；原始横向位置仅作为轻量偏好，避免完全打乱拓扑。
    const laneCount = Math.max(2, Math.min(5, Math.ceil(records.length / 5)));
    const laneGap = width * 0.022;
    const laneWidth = (width - margin * 2 - laneGap * (laneCount - 1)) / laneCount;
    const lanes = Array.from({ length: laneCount }, () => []);
    const weights = Array(laneCount).fill(0);
    const addToLane = (rec, lane, weight = 1) => {
      lanes[lane].push(rec);
      weights[lane] += weight;
    };
    addToLane(overview, 0, .95);
    addToLane(background, laneCount - 1, .95);
    for (const rec of [...contentRecords].sort((a, b) => b.area - a.area)) {
      const desired = Math.round(((rec.g.left + rec.g.width / 2) / CW) * (laneCount - 1));
      let lane = 0, best = Infinity;
      for (let i = 0; i < laneCount; i++) {
        const score = weights[i] + Math.abs(i - desired) * .16;
        if (score < best) { best = score; lane = i; }
      }
      addToLane(rec, lane, Math.min(1.35, rec.g.height / CH * .72 + rec.g.width / CW * .28));
    }

    const place = (items, laneIndex) => {
      items.sort((a, b) => {
        const ar = a.kind === 'overview' || a.kind === 'background' ? -1 : a.g.top;
        const br = b.kind === 'overview' || b.kind === 'background' ? -1 : b.g.top;
        return ar - br || a.index - b.index;
      });
      if (!items.length) return;
      const usableH = height - margin * 2;
      const minGap = height * 0.022;
      const prepared = items.map((rec) => ({
        rec,
        scale: rec.kind === 'overview' || rec.kind === 'background'
          ? Math.min(.42, laneWidth / rec.crop.width, height * .34 / rec.crop.height)
          : Math.min(.86, laneWidth / rec.crop.width,
            height * (items.length <= 3 ? .30 : .24) / rec.crop.height),
      }));
      const rawH = prepared.reduce((sum, p) => sum + p.rec.crop.height * p.scale, 0);
      const roomForItems = Math.max(1, usableH - minGap * Math.max(0, items.length - 1));
      const shrink = rawH > roomForItems ? roomForItems / rawH : 1;
      for (const p of prepared) p.scale *= shrink;
      const usedH = prepared.reduce((sum, p) => sum + p.rec.crop.height * p.scale, 0);
      const gap = prepared.length > 1
        ? Math.max(minGap, Math.min(height * .055, (usableH - usedH) / (prepared.length - 1))) : 0;
      const blockH = usedH + gap * Math.max(0, prepared.length - 1);
      let y = margin + Math.max(0, (usableH - blockH) / 2);
      const laneX = margin + laneIndex * (laneWidth + laneGap);
      for (const p of prepared) {
        const tile = makeExplodedItem(p.rec, p.scale, interactive);
        const tw = p.rec.crop.width * p.scale;
        const left = laneX + (laneWidth - tw) / 2;
        Object.assign(tile.style, { left: px(left), top: px(y) });
        tile.dataset.motionFromLeft = round(originLeft + p.rec.crop.left * originScale);
        tile.dataset.motionFromTop = round(originTop + p.rec.crop.top * originScale);
        tile.dataset.motionFromScale = round(originScale / p.scale);
        tile.dataset.motionOrder = p.rec.motionOrder;
        const tiltIndex = Number.isFinite(p.rec.index) ? Math.abs(p.rec.index) : laneIndex;
        tile.dataset.motionTilt = round((tiltIndex % 2 ? 1 : -1) * (0.7 + tiltIndex % 3 * 0.35));
        y += p.rec.crop.height * p.scale + gap;
        board.appendChild(tile);
      }
    };
    lanes.forEach(place);
    board.addEventListener('pointermove', () => {
      if (board.classList.contains('hf-exploded-settled')) {
        board.classList.add('hf-exploded-interacted');
      }
    }, { passive: true });
    return {
      board, width, height, layerCount: layerRecords.length, level: 1,
      laneCount, laneWidth, originScale, theme,
      primaryContentCount: primaryContentRecords.length,
      supplementalTextCount: supplementalTextRecords.length,
    };
  }

  function stopExplodedMotion() {
    for (const a of state.motion) try { a.cancel(); } catch {}
    state.motion = [];
    state.motionToken = null;
  }

  async function animateExploded(board, reverse = false) {
    stopExplodedMotion();
    if (!board || motionOff() || !Element.prototype.animate) {
      board?.classList.toggle('hf-exploded-settled', !reverse);
      return;
    }
    const token = Symbol('explode-motion');
    state.motionToken = token;
    board.classList.add('hf-exploded-animating');
    board.classList.remove('hf-exploded-settled', 'hf-exploded-interacted');
    const items = [...board.querySelectorAll('.hf-exploded-item')];
    const maxOrder = Math.max(0, ...items.map((n) => +n.dataset.motionOrder || 0));
    const animations = [];

    if (!reverse) {
      const scan = board.querySelector('.hf-exploded-scan');
      const grid = board.querySelector('.hf-exploded-scan-grid');
      const beam = board.querySelector('.hf-exploded-scan-beam');
      const scanH = parseFloat(scan?.style.height) || 0;
      if (scan) animations.push(scan.animate([
        { opacity: 0 },
        { offset: .08, opacity: 1 },
        { offset: .86, opacity: 1 },
        { opacity: 0 },
      ], { duration: MOTION.scan, easing: 'linear', fill: 'both' }));
      if (grid) animations.push(grid.animate([
        { opacity: 0 },
        { offset: .16, opacity: .56 },
        { offset: .78, opacity: .28 },
        { opacity: 0 },
      ], { duration: MOTION.scan, easing: MOTION.ease, fill: 'both' }));
      if (beam) animations.push(beam.animate([
        { transform: `translateY(${round(-scanH * .2)}px)`, opacity: 0 },
        { offset: .08, opacity: 1 },
        { offset: .92, opacity: 1 },
        { transform: `translateY(${round(scanH * 1.02)}px)`, opacity: 0 },
      ], { duration: MOTION.scan, easing: 'cubic-bezier(.34,0,.25,1)', fill: 'both' }));
    }

    for (const item of items) {
      const left = parseFloat(item.style.left) || 0;
      const top = parseFloat(item.style.top) || 0;
      const dx = (+item.dataset.motionFromLeft || left) - left;
      const dy = (+item.dataset.motionFromTop || top) - top;
      const fromScale = +item.dataset.motionFromScale || 1;
      const order = Math.min(12, +item.dataset.motionOrder || 0);
      const tilt = +item.dataset.motionTilt || 0;
      const origin = `translate(${round(dx)}px,${round(dy)}px) scale(${round(fromScale)}) rotate(0deg)`;
      const overshoot = `translate(0,0) scale(1.018) rotate(${tilt}deg)`;
      const frames = reverse ? [
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, filter: 'blur(0)' },
        { offset: .2, transform: overshoot, opacity: 1, filter: 'blur(0)' },
        { transform: origin, opacity: .56, filter: 'blur(1.5px)' },
      ] : [
        { transform: origin, opacity: 1, filter: 'blur(0)' },
        { offset: .12, transform: origin, opacity: 1, filter: 'blur(0)' },
        { offset: .74, transform: overshoot, opacity: 1, filter: 'blur(0)' },
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, filter: 'blur(0)' },
      ];
      const delay = reverse ? (maxOrder - order) * 34
        : MOTION.scan * MOTION.scanOverlap + 70 + order * MOTION.stagger;
      animations.push(item.animate(frames, {
        duration: reverse ? MOTION.reverse : MOTION.duration,
        delay, easing: MOTION.ease, fill: 'both',
      }));
    }

    state.motion = animations;
    await Promise.allSettled(animations.map((a) => a.finished));
    if (state.motionToken !== token) return;
    for (const a of animations) a.cancel();
    state.motion = [];
    state.motionToken = null;
    board.classList.remove('hf-exploded-animating');
    board.classList.toggle('hf-exploded-settled', !reverse);
  }

  function syncExplodedUI(on) {
    document.body.classList.toggle('hf-exploded-on', on);
    $('explode').classList.toggle('active', on);
    $('explode').textContent = on ? '返回编辑' : '拆解视图';
    $('undo').disabled = on || !state.undo.length;
    $('reset').disabled = on;
    $('css').disabled = on;
  }

  async function setExploded(on = !state.exploded) {
    if (state.transitioning || on === state.exploded) return;
    state.transitioning = true;
    $('explode').disabled = true;
    endEdit(true);
    try {
      if (on) {
        state.spreadGeometry = new Map(state.layers.map(({ el, id }) => [id, geom(el)]));
        if (state.spread?.board) state.spread.board.remove();
        state.spread = makeExplodedBoard(true);
        state.exploded = true;
        syncExplodedUI(true);
        select(null);
        stage.appendChild(state.spread.board);
        stage.parentElement.style.setProperty('--hf-exploded-bg', state.spread.theme.bg);
        setScale(fitScale());
        await animateExploded(state.spread.board, false);
      } else {
        await animateExploded(state.spread?.board, true);
        state.spread?.board.remove();
        state.spread = null;
        state.exploded = false;
        syncExplodedUI(false);
        stage.parentElement.style.removeProperty('--hf-exploded-bg');
        setScale(fitScale());
      }
    } finally {
      state.transitioning = false;
      $('explode').disabled = false;
    }
  }

  /* ---------------------------------------------------------------
   * 5. 拖拽
   * ------------------------------------------------------------- */
  const geom = (el) => ({
    left: parseFloat(el.style.left) || 0,
    top: parseFloat(el.style.top) || 0,
    // 拆解视图会暂时 display:none 原画布；此时 offsetWidth/Height 为 0，
    // 仍要能从固化后的内联尺寸重建并下载拆解稿。
    width: el.offsetWidth || parseFloat(el.style.width) || parseFloat(getComputedStyle(el).width) || 0,
    height: el.offsetHeight || parseFloat(el.style.height) || parseFloat(getComputedStyle(el).height) || 0,
  });

  let drag = null;

  const releaseCapture = (el, pointerId) => {
    try {
      if (el?.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
    } catch { /* 指针可能已经被浏览器释放 */ }
  };

  const discardGestureUndo = (type, el) => {
    const last = state.undo[state.undo.length - 1];
    if (last?.type === type && last.el === el) state.undo.pop();
    $('undo').disabled = !state.undo.length;
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (edit && edit.slot.contains(e.target)) return;   // 编辑框内，光标定位交给浏览器
    const el = e.target.closest('[data-layer-id]');
    if (!el) { select(null); return; }
    // 这里刻意不调 preventDefault：在 pointerdown 上阻止默认行为会连带抑制
    // click / dblclick 兼容事件，双击进入文本编辑就失效了。防止拖拽误选
    // 文字改由下面「真正拖起来之后」再禁用 user-select。
    select(el);
    const g = geom(el);
    drag = { el, id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: g.left, oy: g.top, w: g.width, h: g.height, moved: false };
    // 指针捕获推迟到确认拖拽之后：一旦在 pointerdown 阶段就捕获，后续
    // click / dblclick 的 target 会被重定向到捕获元素，双击时拿到的就是
    // 整个图层而不是被点的那个文本槽。
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!(e.buttons & 1)) return finishDrag(true);
    // 画布被 scale 过，屏幕位移要换算回画布坐标才不会跟手偏移
    const dx = (e.clientX - drag.sx) / state.scale;
    const dy = (e.clientY - drag.sy) / state.scale;
    if (!drag.moved && Math.hypot(dx, dy) > 2) {
      drag.moved = true;
      drag.el.setPointerCapture(drag.id);   // 捕获后指针滑出元素范围也不会「掉手」
      document.body.style.userSelect = 'none';
      getSelection().removeAllRanges();
      pushUndo({ type: 'move', el: drag.el, left: drag.ox, top: drag.oy });
    }
    const snapped = e.altKey
      ? { left: drag.ox + dx, top: drag.oy + dy, lines: [] }
      : snap(drag.el, drag.ox + dx, drag.oy + dy, drag.w, drag.h);
    move(drag.el, snapped.left, snapped.top);
    drawGuides(snapped.lines);
  });

  function finishDrag(commit = true) {
    if (!drag) return;
    const current = drag;
    drag = null;
    if (!commit && current.moved) {
      Object.assign(current.el.style, { left: px(current.ox), top: px(current.oy) });
      discardGestureUndo('move', current.el);
      syncPanel();
    } else if (current.moved) touch();
    releaseCapture(current.el, current.id);
    drawGuides([]);
    document.body.style.userSelect = '';
  }
  const endDrag = () => finishDrag(true);
  const cancelDrag = () => finishDrag(false);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  window.addEventListener('pointerup', endDrag, true);
  window.addEventListener('pointercancel', endDrag, true);

  // 图片图层不拦的话会走浏览器原生的「拖动图片」
  canvas.addEventListener('dragstart', (e) => e.preventDefault());

  function move(el, left, top) {
    el.style.left = px(left);
    el.style.top = px(top);
    syncPanel();
  }

  // 选框放在未缩放的舞台坐标系中，手柄始终保持可点击的屏幕尺寸；
  // 图层几何与指针位移则在画布坐标系内计算。
  function updateResizeOverlay() {
    if (!stage || !state.sel || state.exploded || edit) {
      resizeOverlay.hidden = true;
      return;
    }
    const g = geom(state.sel);
    Object.assign(resizeOverlay.style, {
      left: px(g.left * state.scale),
      top: px(g.top * state.scale),
      width: px(g.width * state.scale),
      height: px(g.height * state.scale),
    });
    resizeOverlay.hidden = false;
  }

  let resize = null;

  resizeOverlay.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-hf-resize-dir]');
    if (!handle || !state.sel || edit) return;
    e.preventDefault();
    e.stopPropagation();
    const g = geom(state.sel);
    resize = {
      el: state.sel, handle, id: e.pointerId, dir: handle.dataset.hfResizeDir,
      sx: e.clientX, sy: e.clientY,
      left: g.left, top: g.top, width: g.width, height: g.height,
      widthLocked: state.sel.dataset.hfWidthLocked === '1',
      heightLocked: state.sel.dataset.hfHeightLocked === '1',
      moved: false,
    };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('active');
  });

  resizeOverlay.addEventListener('pointermove', (e) => {
    if (!resize || e.pointerId !== resize.id) return;
    if (!(e.buttons & 1)) return finishResize(true, e);
    const dx = (e.clientX - resize.sx) / state.scale;
    const dy = (e.clientY - resize.sy) / state.scale;
    if (!resize.moved && Math.hypot(dx, dy) > 1) {
      resize.moved = true;
      document.body.style.userSelect = 'none';
      getSelection().removeAllRanges();
      pushUndo({
        type: 'resize', el: resize.el,
        left: resize.left, top: resize.top,
        width: resize.width, height: resize.height,
        widthLocked: resize.widthLocked, heightLocked: resize.heightLocked,
      });
    }
    if (!resize.moved) return;

    const right = resize.left + resize.width;
    const bottom = resize.top + resize.height;
    let left = resize.left, top = resize.top;
    let width = resize.width, height = resize.height;

    if (resize.dir.includes('w')) {
      left = Math.max(0, Math.min(resize.left + dx, right - MIN_W));
      width = right - left;
    } else if (resize.dir.includes('e')) {
      width = Math.max(MIN_W, Math.min(CW - resize.left, resize.width + dx));
    }
    if (resize.dir.includes('n')) {
      top = Math.max(0, Math.min(resize.top + dy, bottom - MIN_H));
      height = bottom - top;
    } else if (resize.dir.includes('s')) {
      height = Math.max(MIN_H, Math.min(CH - resize.top, resize.height + dy));
    }

    Object.assign(resize.el.style, {
      left: px(left), top: px(top), width: px(width), height: px(height),
    });
    if (resize.dir.includes('w') || resize.dir.includes('e')) resize.el.dataset.hfWidthLocked = '1';
    if (resize.dir.includes('n') || resize.dir.includes('s')) resize.el.dataset.hfHeightLocked = '1';
    syncPanel();
  });

  function finishResize(commit = true, e) {
    if (!resize || (e && e.pointerId !== resize.id)) return;
    const current = resize;
    resize = null;
    current.handle.classList.remove('active');
    if (!commit && current.moved) {
      Object.assign(current.el.style, {
        left: px(current.left), top: px(current.top),
        width: px(current.width), height: px(current.height),
      });
      if (current.widthLocked) current.el.dataset.hfWidthLocked = '1';
      else delete current.el.dataset.hfWidthLocked;
      if (current.heightLocked) current.el.dataset.hfHeightLocked = '1';
      else delete current.el.dataset.hfHeightLocked;
      discardGestureUndo('resize', current.el);
      syncPanel();
    } else if (current.moved) touch();
    releaseCapture(current.handle, current.id);
    document.body.style.userSelect = '';
    updateResizeOverlay();
  }
  const endResize = (e) => finishResize(true, e);
  const cancelResize = () => finishResize(false);
  resizeOverlay.addEventListener('pointerup', endResize);
  resizeOverlay.addEventListener('pointercancel', endResize);
  resizeOverlay.addEventListener('lostpointercapture', endResize);
  window.addEventListener('pointerup', endResize, true);
  window.addEventListener('pointercancel', endResize, true);

  const finishPointerGestures = () => {
    finishDrag(true);
    finishResize(true);
  };
  document.addEventListener('pointerdown', finishPointerGestures, true);
  window.addEventListener('blur', finishPointerGestures);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finishPointerGestures();
  });

  // 很矮或很窄的文字层中，边中点手柄可能覆盖文字的视觉中心。
  // 双击手柄时临时移开选框重新命中，让原本的双击编辑仍可用。
  resizeOverlay.addEventListener('dblclick', (e) => {
    if (!state.sel || resize?.moved) return;
    e.preventDefault();
    e.stopPropagation();
    resizeOverlay.hidden = true;
    const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest('.hf-slot');
    resizeOverlay.hidden = false;
    if (slot && state.sel.contains(slot)) beginEdit(slot, state.sel);
  });

  /* ---------------------------------------------------------------
   * 6. 吸附：对齐画布中线／边缘，以及其它图层的边和中心
   * ------------------------------------------------------------- */
  function snap(el, left, top, w, h) {
    const vt = [0, CW / 2, CW], ht = [0, CH / 2, CH];
    for (const { el: o } of state.layers) {
      if (o === el) continue;
      const g = geom(o);
      vt.push(g.left, g.left + g.width / 2, g.left + g.width);
      ht.push(g.top, g.top + g.height / 2, g.top + g.height);
    }
    const axis = (edges, targets) => {
      let best = null;
      for (const edge of edges) {
        for (const t of targets) {
          const d = Math.abs(edge - t);
          if (d <= SNAP && (!best || d < best.d)) best = { d, delta: t - edge, at: t };
        }
      }
      return best;
    };
    const v = axis([left, left + w / 2, left + w], vt);
    const hh = axis([top, top + h / 2, top + h], ht);
    const lines = [];
    if (v) lines.push({ dir: 'v', at: v.at });
    if (hh) lines.push({ dir: 'h', at: hh.at });
    return { left: left + (v ? v.delta : 0), top: top + (hh ? hh.delta : 0), lines };
  }

  function drawGuides(lines) {
    guides.textContent = '';
    for (const l of lines) {
      const d = document.createElement('div');
      d.className = 'hf-guide ' + l.dir;
      d.style[l.dir === 'v' ? 'left' : 'top'] = l.at * state.scale + 'px';
      guides.appendChild(d);
    }
  }

  /* ---------------------------------------------------------------
   * 7. 选中、撤销、面板
   * ------------------------------------------------------------- */
  function select(el) {
    if (state.sel) state.sel.classList.remove('hf-sel');
    state.sel = el;
    if (el) el.classList.add('hf-sel');
    syncPanel();
  }

  // 位置 / 文字 / 样式 / 删除共用一个栈，保证 ⌘Z 的时间顺序符合直觉
  function pushUndo(entry) {
    state.undo.push(entry);
    $('undo').disabled = false;
  }

  function undo() {
    const last = state.undo.pop();
    if (last) {
      if (last.type === 'text') {
        last.slot.innerHTML = last.html;
        refit(last.layer);
      } else if (last.type === 'style') {
        last.slots.forEach((s, i) => { s.style[last.prop] = last.before[i]; });
        refit(last.layer);
      } else if (last.type === 'remove') {
        last.parent.insertBefore(last.el, last.next);
        state.layers.splice(last.idx, 0, { el: last.el, id: last.id });
        state.removed = state.removed.filter((id) => id !== last.id);
        rebuildPanel();
      } else if (last.type === 'resize') {
        Object.assign(last.el.style, {
          left: px(last.left), top: px(last.top),
          width: px(last.width), height: px(last.height),
        });
        if (last.widthLocked) last.el.dataset.hfWidthLocked = '1';
        else delete last.el.dataset.hfWidthLocked;
        if (last.heightLocked) last.el.dataset.hfHeightLocked = '1';
        else delete last.el.dataset.hfHeightLocked;
        syncPanel();
      } else {
        move(last.el, last.left, last.top);
      }
    }
    $('undo').disabled = !state.undo.length;
    touch();
  }

  function rebuildPanel() {
    const list = $('layers');
    list.textContent = '';
    for (const { el, id } of state.layers) {
      const row = h('<div class="hf-layer"><span class="dot"></span><span class="nm"></span><span class="pos"></span></div>');
      row.querySelector('.nm').textContent = id;
      row.addEventListener('click', async () => {
        if (state.exploded) await setExploded(false);
        select(el);
      });
      list.appendChild(row);
    }
    syncPanel();
  }

  function syncPanel() {
    const list = $('layers');
    if (list.children.length !== state.layers.length) return rebuildPanel();
    state.layers.forEach(({ el }, i) => {
      const row = list.children[i];
      const g = geom(el);
      row.classList.toggle('sel', el === state.sel);
      row.querySelector('.pos').textContent = `${Math.round(g.left)}, ${Math.round(g.top)} · ${Math.round(g.width)}×${Math.round(g.height)}`;
    });
    updateResizeOverlay();
    syncProps();
  }

  function syncProps() {
    const box = $('props');
    if (!state.sel) { box.hidden = true; return; }
    box.hidden = false;
    const g = geom(state.sel);
    $('size-val').textContent = `${Math.round(g.width)} × ${Math.round(g.height)} px`;
    const slots = slotsOf(state.sel);
    if (slots.length) {
      $('fs-val').textContent = Math.round(parseFloat(getComputedStyle(slots[0]).fontSize)) + 'px';
      $('fs-up').disabled = $('fs-down').disabled = false;
    } else {
      $('fs-val').textContent = '无文字';
      $('fs-up').disabled = $('fs-down').disabled = true;
    }
    $('ff').disabled = !slots.length;
  }

  /* ---------------------------------------------------------------
   * 8. 文本编辑
   * ------------------------------------------------------------- */
  let edit = null;

  function beginEdit(slot, layer) {
    if (edit) endEdit(true);
    edit = { slot, layer, html: slot.innerHTML };
    slot.setAttribute('contenteditable', 'plaintext-only');
    slot.classList.add('hf-editing');
    updateResizeOverlay();
    slot.focus();
    const range = document.createRange();
    range.selectNodeContents(slot);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function endEdit(commit = true) {
    if (!edit) return;
    const { slot, layer, html } = edit;
    edit = null;
    slot.removeAttribute('contenteditable');
    slot.classList.remove('hf-editing');
    if (!commit) {
      slot.innerHTML = html;
    } else if (slot.innerHTML !== html) {
      pushUndo({ type: 'text', slot, layer, html });
      refit(layer);
      touch();
    }
    getSelection().removeAllRanges();
    syncPanel();
  }

  // 文字变长或字号变大后会被图层锁定的宽度挤到换行。这里按需扩宽，
  // 但不主动收窄，免得吃掉版式上刻意留白的宽度。用户用缩放手柄
  // 明确设过宽度后则保留该宽度，让文字按用户意图换行。
  function refit(layer) {
    if (layer.dataset.hfWidthLocked === '1') {
      syncPanel();
      return;
    }
    const cur = parseFloat(layer.style.width) || 0;
    const left = parseFloat(layer.style.left) || 0;
    layer.style.width = 'max-content';
    const natural = layer.getBoundingClientRect().width / state.scale;
    layer.style.width = px(Math.min(Math.max(cur, natural), CW - left));
    syncPanel();
  }

  canvas.addEventListener('dblclick', (e) => {
    // 按坐标重新做命中测试，而不是信任 e.target：指针一旦被捕获，
    // dblclick 的 target 会被重定向到捕获元素，拿不到真正被点的文本槽。
    const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest('.hf-slot');
    const layer = slot?.closest('[data-layer-id]');
    if (slot && layer) beginEdit(slot, layer);
  });

  // 点到别处即提交。capture 阶段处理，抢在拖拽逻辑之前。
  document.addEventListener('pointerdown', (e) => {
    if (edit && !edit.slot.contains(e.target)) endEdit(true);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!edit) return;
    // 输入法组字期间按键一律归输入法，此时的 Esc 是取消组字而不是退出编辑
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); endEdit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
    e.stopPropagation();   // 方向键交给光标，别拿去挪图层
  }, true);

  /* ---------------------------------------------------------------
   * 9. 字号与字体
   *
   * 作用对象是图层内的全部文本槽，不引入「选中子元素」这一层交互。
   * 字号按比例缩放而非绝对赋值，一对 A−/A+ 即可覆盖微调场景。
   * ------------------------------------------------------------- */
  function applyStyle(layer, prop, valueOf) {
    const slots = slotsOf(layer);
    if (!slots.length) return;
    const before = slots.map((s) => s.style[prop]);
    slots.forEach((s) => { s.style[prop] = valueOf(s); });
    pushUndo({ type: 'style', slots, layer, prop, before });
    refit(layer);
    touch();
  }

  const scaleFont = (layer, factor) => applyStyle(layer, 'fontSize',
    (s) => round(parseFloat(getComputedStyle(s).fontSize) * factor) + 'px');

  const setFont = (layer, value) => applyStyle(layer, 'fontFamily', () => value);

  /* 字体选项只从海报 :root 已声明的字体族变量里取。
     不提供任意字体：那需要动态注入 @font-face，中文字体动辄数 MB，
     且导出后若引用丢失会静默回落成系统字体。 */
  function fontOptions() {
    const out = [], seen = new Set();
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }   // 跨域样式表（如 Google Fonts）不可读
      for (const rule of rules) {
        if (!rule.style || !rule.selectorText) continue;
        if (!/(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText)) continue;
        for (const prop of rule.style) {
          if (!prop.startsWith('--') || seen.has(prop)) continue;
          const val = rule.style.getPropertyValue(prop).trim();
          if (!/serif|sans|mono|cursive|fantasy/i.test(val)) continue;
          seen.add(prop);
          out.push({ label: prop.slice(2), value: `var(${prop})` });
        }
      }
    }
    return out;
  }

  function buildFontSelect() {
    const opts = fontOptions();
    if (!opts.length) { $('ff-field').hidden = true; return; }
    const sel = $('ff');
    sel.append(h('<option value="">（保持原样）</option>'));
    for (const o of opts) {
      const el = h('<option></option>');
      el.value = o.value;
      el.textContent = o.label;
      sel.append(el);
    }
    sel.addEventListener('change', () => {
      if (state.sel && sel.value) setFont(state.sel, sel.value);
      sel.value = '';
    });
  }

  /* ---------------------------------------------------------------
   * 10. 删除图层
   * ------------------------------------------------------------- */
  function removeLayer(layer) {
    const idx = state.layers.findIndex((l) => l.el === layer);
    if (idx < 0) return;
    const { id } = state.layers[idx];
    pushUndo({ type: 'remove', el: layer, id, idx, parent: layer.parentNode, next: layer.nextSibling });
    layer.remove();
    state.layers.splice(idx, 1);
    state.removed.push(id);
    state.sel = null;
    rebuildPanel();
    touch();
    toast(`已删除 ${id}`);
  }

  /* ---------------------------------------------------------------
   * 11. 草稿：localStorage 自动保存，刷新与误关不丢
   * ------------------------------------------------------------- */
  let draftTimer;
  function touch() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 500);
  }

  function snapshot() {
    return {
      at: Date.now(),
      removed: state.removed,
      layers: state.layers.map(({ el, id }) => ({
        id,
        left: parseFloat(el.style.left) || 0,
        top: parseFloat(el.style.top) || 0,
        width: el.style.width || '',
        height: el.style.height || '',
        manualWidth: el.dataset.hfWidthLocked === '1',
        manualHeight: el.dataset.hfHeightLocked === '1',
        slots: slotsOf(el).map((s) => ({
          html: s.innerHTML, fs: s.style.fontSize || '', ff: s.style.fontFamily || '',
        })),
      })),
    };
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot()));
    } catch (err) {
      console.warn('[layer-editor] 草稿保存失败', err);
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  // 自动恢复，同时给出「丢弃草稿」入口 —— 默认不丢失用户的改动
  function applyDraft(d) {
    const byId = new Map(state.layers.map((l) => [l.id, l.el]));
    for (const rec of d.layers || []) {
      const el = byId.get(rec.id);
      if (!el) continue;
      el.style.left = px(rec.left);
      el.style.top = px(rec.top);
      if (rec.width) el.style.width = rec.width;
      if (rec.height) el.style.height = rec.height;
      if (rec.manualWidth) el.dataset.hfWidthLocked = '1';
      if (rec.manualHeight) el.dataset.hfHeightLocked = '1';
      const slots = slotsOf(el);
      (rec.slots || []).forEach((s, i) => {
        if (!slots[i]) return;
        if (s.html !== undefined) slots[i].innerHTML = s.html;
        if (s.fs) slots[i].style.fontSize = s.fs;
        if (s.ff) slots[i].style.fontFamily = s.ff;
      });
    }
    for (const id of d.removed || []) {
      const idx = state.layers.findIndex((l) => l.id === id);
      if (idx < 0) continue;
      state.layers[idx].el.remove();
      state.layers.splice(idx, 1);
      state.removed.push(id);
    }
  }

  function showDraftBar(d) {
    const t = new Date(d.at);
    const pad = (n) => String(n).padStart(2, '0');
    $('draft-msg').textContent =
      `已恢复草稿（${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}）`;
    $('draft').hidden = false;
  }

  function dropDraft() {
    localStorage.removeItem(DRAFT_KEY);
    location.reload();
  }

  /* ---------------------------------------------------------------
   * 12. 导出
   * ------------------------------------------------------------- */
  function positionCSS() {
    const rules = state.layers.map(({ el, id }) => {
      const g = geom(el);
      return `[data-layer-id="${id}"]{ left:${round(g.left)}px; top:${round(g.top)}px; width:${round(g.width)}px; height:${round(g.height)}px; }`;
    });
    return '/* 图层定位（前提是各图层均为 position:absolute，父级为画布） */\n' + rules.join('\n');
  }

  function fullHTML() {
    endEdit(true);
    const doc = document.documentElement.cloneNode(true);
    doc.querySelectorAll('.hf-bar,.hf-panel,.hf-modal,.hf-toast,.hf-guides,.hf-resize-overlay').forEach((n) => n.remove());
    doc.querySelectorAll('link[href*="layer-editor"],script[src*="layer-editor"]').forEach((n) => n.remove());

    const cv = doc.querySelector('.hf-canvas');
    cv.style.transform = '';
    doc.querySelector('.hf-stage-wrap').replaceWith(cv);
    doc.querySelector('body').removeAttribute('class');
    doc.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    doc.querySelectorAll('[class*="hf-"]').forEach((n) => {
      n.classList.remove('hf-canvas', 'hf-draggable', 'hf-sel', 'hf-slot', 'hf-editing');
      if (!n.getAttribute('class')) n.removeAttribute('class');
    });
    // data-hf-ready 挂在 <html> 上，会被 cloneNode 一起带走
    for (const n of [doc, ...doc.querySelectorAll('*')]) {
      for (const attr of [...n.attributes]) {
        if (attr.name.startsWith('data-hf-')) n.removeAttribute(attr.name);
      }
    }
    return '<!doctype html>\n' + doc.outerHTML;
  }

  const EXPLODED_EXPORT_CSS = `
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--hf-exploded-bg,#0b0c0d)}
    body.hf-exploded-export{display:flex!important;align-items:center!important;justify-content:center!important;
      padding:0!important;min-height:100%!important;background:var(--hf-exploded-bg,#0b0c0d)!important}
    .hf-exploded-shell{position:relative;flex:none;overflow:visible}
    .hf-exploded-board{position:absolute;left:0;top:0;overflow:hidden;transform-origin:top left;
      background:var(--hf-exploded-bg,#0b0c0d);color:var(--hf-exploded-fg,#f4f1e8);isolation:isolate}
    .hf-exploded-item{position:absolute;overflow:hidden;transform-origin:top left;
      will-change:transform,opacity,filter}
    .hf-exploded-scan{position:absolute;z-index:40;overflow:hidden;pointer-events:none;opacity:0;
      border-radius:18px;mix-blend-mode:screen;
      box-shadow:inset 0 0 0 1px rgba(188,255,243,.36),inset 0 0 42px rgba(113,244,222,.09)}
    .hf-exploded-scan-grid{position:absolute;inset:0;opacity:0;
      background-image:linear-gradient(rgba(151,255,237,.16) 1px,transparent 1px),
        linear-gradient(90deg,rgba(151,255,237,.16) 1px,transparent 1px);
      background-size:48px 48px;
      mask-image:linear-gradient(180deg,transparent,black 12%,black 88%,transparent)}
    .hf-exploded-scan-beam{position:absolute;left:-3%;top:0;width:106%;height:18%;opacity:0;
      background:linear-gradient(180deg,transparent 0%,rgba(118,255,231,.08) 28%,
        rgba(185,255,244,.25) 50%,rgba(255,255,255,.96) 55%,
        rgba(104,255,230,.34) 58%,transparent 100%);
      filter:drop-shadow(0 0 18px rgba(152,255,237,.9))}
    .hf-exploded-item{filter:drop-shadow(0 16px 28px var(--hf-exploded-shadow,rgba(0,0,0,.28)));
      transition:transform .22s cubic-bezier(.22,1,.36,1),filter .18s}
    .hf-exploded-item:is([data-exploded-overview],[data-exploded-background]){
      border:1px solid var(--hf-exploded-border,rgba(244,241,232,.42));border-radius:16px;box-sizing:border-box}
    .hf-exploded-label{position:absolute;left:18px;top:18px;z-index:8;max-width:calc(100% - 36px);
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;padding:12px 18px;
      border:1px solid var(--hf-exploded-border,rgba(255,255,255,.22));border-radius:999px;
      background:var(--hf-exploded-label-bg,rgba(11,12,13,.78));
      color:var(--hf-exploded-label-fg,#f4f1e8);font:650 28px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
      opacity:0;transform:translateY(6px);transition:opacity .16s ease,transform .22s cubic-bezier(.22,1,.36,1)}
    .hf-exploded-settled.hf-exploded-interacted .hf-exploded-item:is(:hover,:focus-visible) .hf-exploded-label{
      opacity:1;transform:translateY(0)}
    .hf-exploded-settled .hf-exploded-item:hover{transform:translateY(-8px) scale(1.015);
      filter:drop-shadow(0 18px 34px rgba(0,0,0,.38)) brightness(1.08)}
    .hf-exploded-animating .hf-exploded-item{pointer-events:none}
    .hf-exploded-crop{position:absolute;left:0;top:0;overflow:hidden}
    .hf-exploded-source{max-width:none!important;max-height:none!important;transform:none!important}
    .hf-exploded-replay{position:fixed;right:22px;top:20px;z-index:20;appearance:none;
      border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:8px 14px;
      color:#eee;background:rgba(20,22,24,.7);backdrop-filter:blur(12px);cursor:pointer;
      font:500 12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
    .hf-exploded-replay:hover{background:rgba(42,45,49,.88);border-color:rgba(255,255,255,.38)}
    .hf-exploded-replay:disabled{opacity:.45;cursor:default}
    @media(prefers-reduced-motion:reduce){.hf-exploded-item{transition:none}.hf-exploded-scan{display:none}}
  `;

  function explodedHTML() {
    endEdit(true);
    const spread = makeExplodedBoard(false);
    const doc = document.documentElement.cloneNode(true);
    doc.querySelectorAll('script').forEach((n) => n.remove());
    doc.querySelectorAll('link[href*="layer-editor"]').forEach((n) => n.remove());
    for (const n of [doc, ...doc.querySelectorAll('*')]) {
      for (const attr of [...n.attributes]) if (attr.name.startsWith('data-hf-')) n.removeAttribute(attr.name);
    }
    const head = doc.querySelector('head');
    const style = document.createElement('style');
    style.textContent = EXPLODED_EXPORT_CSS;
    head.appendChild(style);
    const title = head.querySelector('title');
    if (title) title.textContent += ' · 分层展示';

    const body = doc.querySelector('body');
    body.textContent = '';
    body.removeAttribute('style');
    body.className = 'hf-exploded-export';
    body.style.setProperty('--hf-exploded-bg', spread.theme.bg);
    body.style.setProperty('--hf-exploded-fg', spread.theme.fg);
    body.style.setProperty('--hf-exploded-border', spread.theme.border);
    body.style.setProperty('--hf-exploded-label-bg', spread.theme.labelBg);
    body.style.setProperty('--hf-exploded-label-fg', spread.theme.labelFg);
    body.style.setProperty('--hf-exploded-shadow', spread.theme.shadow);
    const shell = Object.assign(document.createElement('div'), { className: 'hf-exploded-shell' });
    shell.appendChild(spread.board);
    body.appendChild(shell);
    const replay = Object.assign(document.createElement('button'), {
      className: 'hf-exploded-replay', textContent: '↻ 再次播放分层动画', type: 'button',
    });
    body.appendChild(replay);

    const fit = document.createElement('script');
    fit.textContent = `(() => {
      const board = document.querySelector('.hf-exploded-board');
      const shell = document.querySelector('.hf-exploded-shell');
      const replay = document.querySelector('.hf-exploded-replay');
      const w = ${spread.width}, h = ${spread.height};
      const resize = () => {
        const s = Math.min(innerWidth / w, innerHeight / h);
        board.style.transform = 'scale(' + s + ')';
        shell.style.width = (w * s) + 'px';
        shell.style.height = (h * s) + 'px';
      };
      const reduced = matchMedia('(prefers-reduced-motion:reduce)').matches
        || new URLSearchParams(location.search).get('motion') === '0';
      board.addEventListener('pointermove', () => {
        if (board.classList.contains('hf-exploded-settled')) {
          board.classList.add('hf-exploded-interacted');
        }
      }, {passive:true});
      const scanDuration = 760, scanRelease = scanDuration * .78;
      let running = [];
      const play = async () => {
        for (const a of running) try { a.cancel(); } catch {}
        running = [];
        board.classList.remove('hf-exploded-settled','hf-exploded-interacted');
        if (reduced || !Element.prototype.animate) {
          replay.hidden = true;
          board.classList.add('hf-exploded-settled');
          document.documentElement.dataset.hfMotion = 'reduced';
          return;
        }
        board.classList.add('hf-exploded-animating');
        replay.disabled = true;
        const items = [...board.querySelectorAll('.hf-exploded-item')];
        const scan = board.querySelector('.hf-exploded-scan');
        const grid = board.querySelector('.hf-exploded-scan-grid');
        const beam = board.querySelector('.hf-exploded-scan-beam');
        const scanH = parseFloat(scan?.style.height)||0;
        if (scan) running.push(scan.animate([
          {opacity:0},{offset:.08,opacity:1},{offset:.86,opacity:1},{opacity:0}
        ],{duration:scanDuration,easing:'linear',fill:'both'}));
        if (grid) running.push(grid.animate([
          {opacity:0},{offset:.16,opacity:.56},{offset:.78,opacity:.28},{opacity:0}
        ],{duration:scanDuration,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'}));
        if (beam) running.push(beam.animate([
          {transform:'translateY('+(-scanH*.2)+'px)',opacity:0},
          {offset:.08,opacity:1},{offset:.92,opacity:1},
          {transform:'translateY('+(scanH*1.02)+'px)',opacity:0}
        ],{duration:scanDuration,easing:'cubic-bezier(.34,0,.25,1)',fill:'both'}));
        for (const item of items) {
          const left = parseFloat(item.style.left)||0, top = parseFloat(item.style.top)||0;
          const dx = (+item.dataset.motionFromLeft||left)-left;
          const dy = (+item.dataset.motionFromTop||top)-top;
          const scale = +item.dataset.motionFromScale||1;
          const order = Math.min(12,+item.dataset.motionOrder||0);
          const tilt = +item.dataset.motionTilt||0;
          running.push(item.animate([
            {transform:'translate('+dx+'px,'+dy+'px) scale('+scale+') rotate(0deg)',opacity:1,filter:'blur(0)'},
            {offset:.12,transform:'translate('+dx+'px,'+dy+'px) scale('+scale+') rotate(0deg)',opacity:1,filter:'blur(0)'},
            {offset:.74,transform:'translate(0,0) scale(1.018) rotate('+tilt+'deg)',opacity:1,filter:'blur(0)'},
            {transform:'translate(0,0) scale(1) rotate(0deg)',opacity:1,filter:'blur(0)'}
          ],{duration:780,delay:scanRelease+70+order*58,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'}));
        }
        await Promise.allSettled(running.map((a)=>a.finished));
        for (const a of running) a.cancel();
        running=[];
        board.classList.remove('hf-exploded-animating');
        board.classList.add('hf-exploded-settled');
        replay.disabled=false;
        document.documentElement.dataset.hfMotion='played';
      };
      replay.addEventListener('click',play);
      addEventListener('resize',resize); resize();
      play().finally(()=>{document.documentElement.dataset.hfExplodedReady='1';});
    })();`;
    body.appendChild(fit);
    return '<!doctype html>\n' + doc.outerHTML;
  }

  function downloadBlob(html, name) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('已下载 ' + name);
  }

  function download() {
    const html = fullHTML();
    const base = (location.pathname.split('/').pop() || 'poster').replace(/\.html?$/i, '');
    const name = (/^(editor|index)$/i.test(base) ? 'index' : base) + '.edited.html';
    downloadBlob(html, name);
  }

  function downloadExploded() {
    const base = (location.pathname.split('/').pop() || 'poster').replace(/\.html?$/i, '');
    const name = (/^(editor|index)$/i.test(base) ? 'index' : base) + '.layers.html';
    downloadBlob(explodedHTML(), name);
  }

  function openModal(title, text) {
    $('modal-title').textContent = title;
    $('modal-text').value = text;
    $('modal').hidden = false;
    $('modal-text').select();
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制到剪贴板');
    } catch {
      toast('浏览器拒绝了剪贴板访问，请手动复制');
    }
  }

  /* ---------------------------------------------------------------
   * 13. 接线
   * ------------------------------------------------------------- */
  function wire() {
    $('undo').addEventListener('click', undo);

    $('reset').addEventListener('click', () => {
      endEdit(true);
      for (const { el, id } of state.layers) {
        const p = state.initial.get(id);
        if (p) {
          el.style.left = px(p.left); el.style.top = px(p.top);
          el.style.width = px(p.width); el.style.height = px(p.height);
          delete el.dataset.hfWidthLocked;
          delete el.dataset.hfHeightLocked;
        }
      }
      state.undo.length = 0;
      $('undo').disabled = true;
      syncPanel();
      touch();
      toast('已还原到固化后的初始布局');
    });

    $('save').addEventListener('click', download);
    $('explode').addEventListener('click', () => setExploded());
    $('explode-save').addEventListener('click', downloadExploded);
    $('css').addEventListener('click', () => openModal('图层定位 CSS', positionCSS()));
    $('modal-copy').addEventListener('click', () => copy($('modal-text').value));
    $('modal-close').addEventListener('click', () => { $('modal').hidden = true; });
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').hidden = true; });
    $('scale').addEventListener('input', (e) => setScale(e.target.value / 100));
    $('fs-up').addEventListener('click', () => state.sel && scaleFont(state.sel, FS_STEP));
    $('fs-down').addEventListener('click', () => state.sel && scaleFont(state.sel, 1 / FS_STEP));
    $('del').addEventListener('click', () => state.sel && removeLayer(state.sel));
    $('draft-drop').addEventListener('click', dropDraft);
    window.addEventListener('resize', () => setScale(fitScale()));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (drag || resize)) {
        e.preventDefault();
        cancelDrag();
        cancelResize();
        return;
      }
      if (edit) return;                       // 编辑态的按键由 §8 的 capture 处理器负责
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); return download(); }
      if (e.key === 'Escape') return state.exploded ? setExploded(false) : select(null);
      if (!state.sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        return removeLayer(state.sel);
      }
      if (!e.key.startsWith('Arrow')) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const g = geom(state.sel);
      pushUndo({ type: 'move', el: state.sel, left: g.left, top: g.top });
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      move(state.sel, g.left + d[0], g.top + d[1]);
      touch();
    });
  }

  /* 字体决定文字块的实际尺寸，图片决定图层的实际高度 —— 两者都必须
     落地后再测量，否则固化下来的是 fallback 字体或零高图片的坐标。
     图片加载失败也要放行，否则一张坏图会卡死整个编辑器。 */
  function ready() {
    const imgs = [...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => {
      i.addEventListener('load', r, { once: true });
      i.addEventListener('error', r, { once: true });
    }));
    return Promise.all([document.fonts.ready, ...imgs]);
  }

  ready().then(() => {
    bake();
    markSlots();
    buildUI();
    buildFontSelect();
    buildStage();
    wire();
    const draft = loadDraft();
    if (draft) { applyDraft(draft); showDraftBar(draft); }
    rebuildPanel();

    /* 供 scripts/ 下的离线固化与验证脚本驱动。编辑器不加载时不存在，
       导出的 HTML 也不含此脚本，因此不会污染产物。 */
    window.__layerEditor = {
      fullHTML, explodedHTML, positionCSS, snapshot, download, downloadExploded, undo, toast,
      select, scaleFont, setFont, removeLayer, fontOptions,
      setExploded,
      layers: () => state.layers.map(({ el, id }) => ({ el, id })),
      state,
    };
    document.documentElement.dataset.hfReady = '1';   // 自动化脚本的等待锚点
  });
})();
