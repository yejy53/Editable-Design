# 已知陷阱清单

全部为实际踩到并修复的问题，编辑器外壳里已处理。**遇到偏差不为 0 或功能异常时
先查这里**，不要重写外壳。

## 固化阶段

| # | 陷阱 | 处理 |
|---|---|---|
| T1 | 边量边改导致后续元素上跳 | 严格两趟：先全量测量并缓存，再统一写入 |
| T2 | 图层抽走后容器塌陷。尤以 `bottom` 定位的容器为害：高度一塌，容器整体下移，容器内**未被抽走的**元素（如分隔线）跟着跑位 | 测量阶段一并记录所有「含图层的祖先容器」，在抽离前把 `width/height` 钉死 |
| T3 | `margin` 残留。文档流元素靠 `margin-top` 排版，转 absolute 后 margin 仍生效，元素在新坐标基础上再偏移 | 写入时统一 `margin:0` |
| T4 | 把 `transform` 一律清空虽能解决 `translateX(-50%)` 的重复偏移，却会抹掉邮戳、回形针、手写贴纸等设计旋转 | 分别保存未变换布局尺寸、computed transform 与 transform-origin；提升后重施矩阵，再用可见包围盒差值反算 `left/top` |
| T5 | `right` / `bottom` 定位的元素改 `left/top` 无效 | 写入 `left/top` 的同时把 `right/bottom` 置 `auto` |
| T6 | z-index 与上下文样式丢失。元素移出原容器后，`.dark-card .label` 等祖先选择器不再命中；模块底色、图片、未标分隔线和 copy 的绘制次序也可能翻转 | 提升前保存发生变化的 computed/pseudo 样式并最小化内联；按顶层 stacking 顺序分配 z 段，区分“容器自身是 surface”与“独立 surface 叶子”两种模块 |
| T7 | 宽度塌缩。文档流元素宽度由父容器给定，转 absolute 后塌成 `fit-content`，文字重新换行 | 写入测得的 `width` |
| T8 | 字体未加载完就测量，量到的是 fallback 字体的坐标，落盘后整个版面偏移 | 固化前 `await document.fonts.ready` |
| T9 | 图片未加载完就测量（高度为 0）。**加载失败也必须放行**，否则一张坏图卡死整个编辑器 | 等待所有 `img` 的 `load` 与 `error` |
| T10 | DOM 提升顺序反转。多个图层依次插入同一锚点后顺序会颠倒，绘制次序随之改变 | 每组维护滚动锚点，插入后把锚点更新为刚插入的元素 |
| T11 | 被抽空的容器仍会捕获 pointer 事件，挡住下方图层 | 锁尺寸时一并设 `pointer-events:none` |

## 交互阶段

| # | 陷阱 | 处理 |
|---|---|---|
| T12 | **`pointerdown` 里调 `preventDefault()` 会抑制后续 `click` / `dblclick`**（Pointer Events 规范：阻止默认行为会连带抑制兼容鼠标事件）。表现为双击完全无法进入文本编辑 | 不在 `pointerdown` 阻止默认行为；防止拖拽误选文字改为「移动超过阈值后再设 `user-select:none`」 |
| T13 | **`setPointerCapture` 会把后续 `click` / `dblclick` 的 `target` 重定向到捕获元素**。表现为双击图层内的子元素时 `e.target` 变成整个图层，找不到文本槽。若图层自身恰好就是文本槽则「碰巧能用」，极具误导性 | ① 指针捕获推迟到确认拖拽之后；② `dblclick` 不信任 `e.target`，改用 `document.elementFromPoint()` 重新命中 |
| T14 | 画布整体 `scale` 后屏幕位移与画布位移不等，不换算则拖拽明显不跟手 | `dx = (e.clientX - startX) / scale` |
| T15 | 文本编辑态下方向键同时移动光标和图层 | 编辑态的 keydown 在 capture 阶段 `stopPropagation()` |
| T16 | **中文输入法**：组字期间 Esc 是「取消候选词」、Enter 是「上屏」。不区分则用户打字打到一半就被踢出编辑态 | 按键处理第一行即 `if (e.isComposing \|\| e.keyCode === 229) return;` |
| T17 | 文本编辑粒度若取整个图层，多字号拼排结构会被破坏（如价格由 `.cup`/`.num`/`.yuan` 三个不同字号字色的 span 拼成，整块 `contenteditable` 时一个退格即崩） | 编辑单元下沉到**文本槽**：图层内部只承载文字的叶子节点；图文混排节点整体算一个槽；SVG 子树排除 |
| T18 | 从外部粘贴带格式内容会把 HTML 污染进海报 | `contenteditable="plaintext-only"` |
| T19 | 文字改长或字号变大后被固化宽度挤到换行；但用户手动缩窄文本框时又确实需要换行 | 默认提交时按需扩宽且**不主动收窄**；一旦用户使用宽度手柄，就标记为手动宽度，后续文字与字号编辑保留该宽度 |
| T23 | `documentElement` 上的 `data-hf-ready` 标记会被 `cloneNode` 带进导出物 | 导出时移除所有 `data-hf-*` 属性（含 `<html>` 自身） |

## 测试与环境

| # | 陷阱 | 处理 |
|---|---|---|
| T20 | **Puppeteer 的 `clickCount: 2` 不产生 `dblclick`**。它只设置参数、不真的按两次，`detail` 恒为 1，浏览器不合成双击。会误判成功能 bug | 手动发两轮 down/up，第二轮传 `clickCount: 2`，此时 `detail=2`、`dblclick` 正常派发 |
| T21 | headless Chrome 启动被用户已开着的实例干扰，报 `Timed out waiting for the WS endpoint URL` | 每次用全新的临时 `--user-data-dir`（顺带保证 localStorage 干净，草稿不干扰固化） |
| T22 | 断言「导出物无编辑器残留」时，注入的 **HTML 注释节点**不会被 `querySelectorAll` 删除 | 用 `TreeWalker(SHOW_COMMENT)` 一并清理（当前外壳改为动态创建 DOM，已不注入注释） |
| T24 | `document.fonts` 含**所有**声明的 `@font-face`，未被使用的（如仅作 fallback 列出的字体）一直是 `unloaded`，这是按需加载的正常行为 | 断言只用 `document.fonts.status === 'loaded'`，不要求每个 FontFace 都 loaded |
| T25 | Google Fonts 把中文字体切成上百个 `unicode-range` 分片，同一 family 下必然部分 loaded 部分 unloaded | 判断一个 family 是否真的没用上，要看「是否**没有任何**分片被加载」 |
| T26 | 契约检查里把图层的祖先容器误报成「漏标 `data-layer-id`」——容器本身没有 layer-id，但它只是包装 | 候选块需额外排除「内部含 `[data-layer-id]`」的元素 |
| T27 | 拆解视图开启后原画布被 `display:none`，此时再次下载拆解稿若现场读 `offsetWidth/Height` 会全部得到 0，导出空稿 | 进入拆解态前缓存每层几何；隐藏后导出使用缓存，不重新测量不可见画布 |
| T28 | 用随机数或直接动画 `left/top` 做拆解，会让每次录制位置不同、截图中途态漂移，并破坏确定性验收；系统“减少动态效果”下还可能卡在初始态 | 终态只由确定性 `left/top` 决定；动画仅叠加 Web Animations 的 `transform/opacity/filter`，结束后取消动画回到 CSS 终态；支持 `prefers-reduced-motion` 与 `?motion=0`，独立稿动画完成后才设置 ready 锚点 |
| T29 | 拆解舞台过宽会让扫描原稿骤缩；列数太少又会把组件挤成细小侧注 | 使用平衡舞台 `max(1.7×画布宽, 1.275×画布高)`；扫描原点保留编辑态高度至少约 68%，终态按组件数自动使用 2–5 列，并分别约束总览、背景和内容组件的缩放 |
| T30 | 先播放扫描、之后才创建拆解动画，会让图层在扫描期间提前闪到最终位置；扫描层若未纳入统一结束处理，也会残留遮罩或卡住 ready | 首帧即创建全部 WAAPI：利用 `delay + fill:both` 把图层钉在成稿位置，扫描尾段与散开重叠；扫描层置于独立高层且终帧透明，统一等待和取消；reduced-motion / `?motion=0` 直接跳到终态 |
| T31 | 只比较 `getBoundingClientRect()` 会把“坐标没变、底色/伪元素/图片/层级已丢”的稿件误判为零偏差 | A 类验收同时截取原稿与 baked 稿做像素比较；几何比较负责定位，像素比较负责视觉真值 |
| T32 | 海报画布用渐变纸张而 `background-color:transparent` 时，直接读 backgroundColor 会得到透明黑并把拆解舞台误判成黑色 | 优先读取不透明背景色；透明时解析 background-image 中的近不透明颜色，再回退页面底色/暖白 |
| T33 | 中央常驻完整成稿或大幅空背景，会让终态看起来没有真正拆开并制造无意义留白；继续钻取第二层又会产生过细采集 | 动画起点把组件叠回完整成稿；终态把完整总览、未标记背景和一级内容全部缩成画廊组件，中央不留固定基底，也不提供第二级叶子钻取 |
| T34 | 从 Grid/Flex 模块容器中直接删除非目标兄弟，会让目标卡自动补位；按原坐标裁切时卡片底色消失，只剩已提升的文字/图标 | 非目标模块改用 `visibility:hidden` 保留布局占位，随后再移除其叶子；不要删除决定轨道位置的兄弟包装 |
| T35 | FLIP 散开动画把整个模块从扫描原点移动到画廊时，模块说明标签也会随父项同步缩放，运动中变成遮住海报的巨型省略文字；即使停稳后全部常驻，也会重复模块内已有标题 | 模块标签默认隐藏；仅在舞台停稳且用户悬停/聚焦具体模块时淡入，离开即隐藏。名称仍保存在 `title` 中供发现，但不污染扫描动画或静止拆解稿 |
| T36 | 分组容器只包绝对定位叶子时自身宽高可能为 0，按容器盒裁切会把模块压成不可见细条；一级有效组件过少时画廊也显得空 | 分组盒无效或远小于成员联合边界时回退到成员几何并集；一级内容组件少于 5 个时，把分组内有文字且非 surface/image/icon/decoration 的叶子作为同级补充 tile，保持一级结构不增加钻取层级 |
| T37 | 把缩放手柄画在已整体 `scale()` 的画布内，会让点击区域随缩放变小；用图层伪元素又无法可靠接收独立的八向拖拽；可见角点若同时就是命中区，在高密度海报上仍很难点中 | 在未缩放舞台中维护独立选框：显示坐标乘 `scale`，指针位移除以 `scale`；手柄使用约 32px 的透明命中区包住 12px 可见标记；进入文字编辑或拆解视图时隐藏，导出时彻底移除 |
| T38 | 在真正拖动前尚未建立 pointer capture；此时若指针在画布外松开、窗口失焦或浏览器取消手势，`pointerup` 可能不到达画布，旧手势会保持 armed，鼠标回来后图层继续跟随 | 在 window capture 阶段兜底处理 `pointerup/pointercancel`，监听 `lostpointercapture`、窗口失焦和页面隐藏；`pointermove` 发现主键已松开就立即结束；`Esc` 取消并恢复本次手势，下一次 pointerdown 先终止任何残留手势 |

## 诊断偏差不为 0

`bake.mjs` 报偏差时，按可能性排序检查：

1. 契约未满足 —— 先跑 `check-contract.mjs`，十有八九是 `vw/vh/%` 或字体没等到
2. 上表 T1–T11 未覆盖的布局：`float`、`position:sticky`、伪元素撑开高度、
   `writing-mode`、CSS `columns`、`subgrid`
3. 图层之间有重叠依赖（一个图层的位置由另一个图层的内容高度决定）

定位方法：`bake.mjs` 的输出逐图层列出了原始与固化后坐标，先看**哪些图层偏了、
偏移量是否相同**。同一容器内的图层偏移量一致，通常是 T2 容器塌陷；单个图层偏移
等于某个 margin 值，是 T3；旋转饰物的包围盒与角度不一致，是 T4。
