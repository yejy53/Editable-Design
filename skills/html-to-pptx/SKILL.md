---
name: html-to-pptx
description: 把 slide／poster 的 HTML 确定性地转成可编辑 PPTX——每个视觉元素（插画、图标、箭头、装饰线、文字）都是能单独选中拖动的对象，而不是压成一张背景图；也能自动识别并转换 Editable Design 的 editor.html 和 case 的图层展开图 layers.html；并可把产物渲回图片做保真度比对。当用户要导出 pptx／ppt、问「HTML 怎么转 PowerPoint」、想让生成的海报或幻灯片能在 PowerPoint 里继续改、要把图层展开图／拆解图变成 ppt、或需要检查转换后元素是否独立可编辑时使用。
---

# HTML → 可编辑 PPTX

**纯确定性转换：无 LLM、无常驻服务、离线单命令。**

目标不是「截个图塞进 ppt」，而是让 PowerPoint 里每个元素都能单独选中、拖动、改字、改色。

## 零配置入口

始终通过 `scripts/run.sh` 转换。首次调用时，它会自动找到 Codex 或系统提供的 Python
3.10+，在 Skill 内创建隔离的 `.venv`，安装 Python 依赖和 Playwright Chromium，然后继续
当前转换；以后直接复用，不让用户手动配置环境：

```bash
bash scripts/run.sh <任意 HTML> -o deck.pptx
```

不要要求用户先运行 `pip`、安装 Playwright 或处理脚本权限。若自动初始化失败，再运行
`bash scripts/setup.sh` 查看明确诊断；`HTML_TO_PPTX_PYTHON` 可用于指定兼容的 Python。

确定性转换核心已经随 Skill 固定在 `scripts/_html_to_pptx.py`，不依赖其他私有仓库。
浏览器默认保留 Chromium 沙箱；只有运行环境明确不支持沙箱时，才设置
`HTML_TO_PPTX_NO_SANDBOX=1`。

`render_check.py` 额外需要 LibreOffice（渲染 pptx）和 PyMuPDF：
`brew install --cask libreoffice && .venv/bin/python -m pip install -r requirements-check.txt`。
这两项只用于视觉比对，不影响核心转换。

## 转换

一个入口支持三类页面并自动识别：

```bash
bash scripts/run.sh <任意 HTML>                       # → 同目录同名 .pptx
bash scripts/run.sh <HTML> -o deck.pptx
bash scripts/run.sh <HTML> --selector '#hero'         # 画布识别失败时手动指定
bash scripts/run.sh <HTML> --mode exploded            # 自动识别出错时手动指定
```

| 输入页面 | 自动模式 | 转换前处理 |
| --- | --- | --- |
| `index.html`、`*.edited.html` | `plain` | 直接测量固定画布 |
| `editor.html` | `editor` | 调用编辑器的 `fullHTML()`，剥掉工具栏、面板和缩放舞台 |
| `layers.html` | `exploded` | 等动画落位、去除 overview、关闭响应式缩放 |

判别信号来自页面本身：编辑器暴露 `__layerEditor`／`__freeEditor.fullHTML()`，展开图包含
`.hf-exploded-board`。如果页面像编辑器但 API 没有成功加载，转换会停止并报错，不会把
编辑器 UI 悄悄写进 PPTX。

`editor.html` 使用的 `fullHTML()` 与编辑器的 “Download HTML” 按钮是同一条官方导出路径。
临时 HTML 写在原文件旁边以保留相对图片和字体路径，转换完成后立即删除。

输出示例，**先确认页面类型、画布和元素分布是否合理**：

```
页面类型：editor（自动识别）
   编辑器 fullHTML() 导出 15 KB，已剥掉编辑器外壳
✅ /path/dragon_poster.pptx
   画布 1067x1600 ([data-canvas-width]) · 形状 4 · 文本框 10 · 独立图片 13 · 元素 28
```

## 图层展开图（case 的 `layers.html`）

`outputs/cases/*/*/layers.html` 是一张**图层展开图**：`.hf-exploded-board` 上摊开若干
`.hf-exploded-item`——整图缩略（overview）、背景底、以及各图层／分组。转成**一页**
PPTX，默认丢掉 overview 那一项：

```bash
bash scripts/run.sh <case>/layers.html                     # → 同目录 layers.pptx
bash scripts/run.sh <case>/layers.html --keep-overview
```

```
board 3060x2400 · 分块 26 （跳过 overview 1）· {'layer': 12, 'group': 13, 'background': 1}
✅ .../layers.pptx
   形状 45 · 文本框 93 · 独立图片 51 · 元素 265
```

粒度是**元素级**而非分块级：每块内部的每行字、每张照片、每张卡片都是独立对象。

这类页面有三个特性会干扰通用转换，`to_pptx.py` 识别后会转入
`exploded_to_pptx.py`，在量画布之前一次性抹平：

1. board 会按窗口自适应缩放，而转换器又要把视口调成画布大小，两者互相触发、越缩越小。
   用 `!important` 规则钉死 `transform`，压过页面脚本写的 inline style。
2. 有入场动画，要等 `[data-hf-exploded-ready='1']` 再量。
3. overview 缩略图、扫描光效、replay 按钮属于页面外壳，不是内容。

## 验收（建议每次都跑）

```bash
python3 scripts/render_check.py <index.html> <out.pptx>              # → <out>.compare.png
python3 scripts/render_check.py <layers.html> <layers.pptx> --exploded
```

四联图：源 HTML ／ PPTX 渲回 ／ 每个独立对象的边界框 ／ 误差热力图。**第三联是关键**
——框住的每一块在 PowerPoint 里都能单独选中。若某个视觉元素没有自己的框，说明它掉进
了兜底背景，按下方「排错」处理。

终端同时给出平均像素差、超阈值占比，以及误差最大的几块区域的坐标和两侧色值。
**别只看聚合数字**：整页平均差很容易被大面积正确的背景稀释，一整张卡片的内容糊掉在
均值上可能只体现为零点几的波动，一定要顺着列出的区域坐标去看具体是哪里错了。

展开图必须加 `--exploded`，它会套用与转换器完全相同的页面预处理；否则基准图里会多出
总览图和没跑完的入场动画，比对的是两张不同的画。

**注意 LibreOffice 的渲染不等于 PowerPoint**，竖排 CJK 尤其如此：同一份 pptx，
PowerPoint 排成正确的单列，LibreOffice 会把它拆成两列。已实测确认这是 LibreOffice 的
问题，不是产物的问题——别为了迁就它去改字族，那只会让 PowerPoint 里变差。

macOS 上可以让 PowerPoint 自己导 PDF 来做权威比对：

```applescript
tell application "Microsoft PowerPoint"
  open POSIX file "/abs/path/deck.pptx"
  save presentation 1 in "/abs/path/out.pdf" as save as PDF
end tell
```

PowerPoint 是沙箱应用，输出路径要挑它有权限写的位置；若长时间无输出，多半是它弹了
模态框，切过去点掉即可。

### 无法严格复刻的部分

- **字重只有两档**。OOXML 的 `b` 是布尔量，CSS 的 400/500/600/650 会被压成常规或加粗。
  实测「PingFang SC Semibold」这类带字重的字族名解析不出来，这条路走不通。
- **对方机器缺字体就会被替换**。我们写的是正确的字族名，但装没装不由我们决定；
  OOXML 的字体内嵌 python-pptx 不支持，Mac 版 PowerPoint 也不认。
- **纵向基线有零点几个百分点的偏移**。PPTX 按文本框锚定，CSS 按行盒基线，结构不同。
- **径向／conic／多层叠加渐变画不成原生填充**。没有子元素时会栅格化，仍是独立可拖动
  的对象、像素精确；带子元素的容器不能栅格化（会把子元素一起吞掉），它的底色就留在
  兜底背景里，视觉正确但那层底色本身不可单独选中。单层线性渐变则输出成真正的
  `gradFill`，双色标带 alpha 和角度。

## 转换规则

四分类，决定每个 DOM 元素在 pptx 里变成什么：

| 角色 | 产物 | 典型对象 |
| --- | --- | --- |
| `text` | 可编辑文本框（含自己的底色形状、旋转角度） | 标题、标签、斜排文字 |
| `shape` | 原生（圆角）矩形，子元素叠在上面 | 卡片、胶囊、空心圆圈 |
| `picture` | **单独隔离截图（透明底）**，各自成一张图 | 插画、内联 SVG 图标、箭头、装饰线 |
| `image` | 不重建，留在兜底背景 | 满画布渐变底、纯装饰纹理 |

关键设计：**兜底背景只装没能重建的部分**，所以永远不丢像素；重建充分时它就只剩纸张底色。

画布自动识别 `.slide-canvas` / `.poster-canvas` / `[data-canvas-width]` / `#poster`；
幻灯片尺寸按**真实宽高比**推导（长边 13.333in），1920×1080 仍是 16:9，1067×1600 保持竖版，
两轴等比例不拉伸。

已覆盖：非均匀边框（顶边强调条拆成独立细条）、只有描边的空心盒子不被填实、
`writing-mode` 竖排、字体替换后自动缩字号以免溢出。

**旋转会累积祖先的 transform**，和缩放同理。被外层 wrapper 转了角度的按钮，自身
computed `transform` 是 `none`，只读它自己会把整块导成水平的。旋转元素按「未旋转的
布局尺寸、居中于实测包围盒」放置——包围盒是斜矩形的轴对齐外接框，直接拿它当宽高会偏大。

**水平对齐取实际渲染结果，不只看 `text-align`**。用 flex `justify-content: center` 居中
的胶囊按钮从不设置 `text-align`，它继承来的值是 `start`；只读这一个属性会把文字钉在
按钮左边缘。现在 flex 行方向读 `justify-content`、列方向读 `align-items`（列布局里水平
是交叉轴），grid 优先 `justify-items` 再退回 `justify-content`；`space-between` 这类分布
关键字仍沿用 `text-align`，因为只有一段文字时它们本来就贴起始边。

**`mix-blend-mode: multiply` 的白底会烘进 alpha**。白底无 alpha 的线稿 PNG 靠 multiply
消掉自己的白（白 × 纸色 = 纸色）。PowerPoint 的图片没有混合模式，而隔离截图又是透明底，
multiply 和「什么都没有」混合等于不混合，白底会原样进 pptx，成为一块白板。
灰度墨的 multiply 与「黑墨按 alpha 叠加」在数学上等价：`src*d == a*C + (1-a)*d`
取 `C=0, a=1-src`。取 `m = min(r,g,b)` 作为要抠掉的白量即可推广到彩色墨——
压在白底上时精确，墨是灰的时候处处精确，而 `grayscale()` 滤镜留下的正是灰墨。
`darken` 同样处理，`soft-light` 之类没有等价 alpha 形式，不处理。

这条规则会让产物**偏离展开图页面、但对齐真实海报**。展开图里每个分块只含自己那一层，
纸色是另一个独立分块，所以线稿底下压根没有可乘的东西，multiply 在展开图里是失效的，
白板照样显示（实测：真海报把 multiply 强制成 normal 采样点变化 +11，展开图变化 0）。
如实复刻这种页面等于把白板抄进 pptx，所以这里选择按图层的**语义**导出。

**叠放次序**按每个元素在页面里实测的「绘制路径」排：从画布往下逐层记录
`[有效 z-index, 兄弟序号]`，字典序比较即可在最近公共祖先处分出胜负。不能把 z-index 当
成全局排序键——它只在同一个层叠上下文内给兄弟排序，拍平之后 `position:relative;
z-index:1` 的卡片会排到自己子元素后面，用底色盖住自己的图标和文字。

**排版保真**：字族取 CSS 字体链里**本机真实装有**的那一个（用字形宽度探测，
`document.fonts.check` 恒返回 true、不能用），字号按实测值 1:1 换算，`letter-spacing`
写成 OOXML `spc`、`line-height` 写成精确行距、斜体写成 `i`。字号只在字体确实需要替换
时才收缩，字体对得上时不打折。

**文字块拆分**：一行文字若靠 flex `gap` 或内联分隔符的 margin 撑开，合成一个文本框会
塌掉近一半宽度。这类容器里的每段裸文本会被包进 span，各自成为独立文本框，落在自己
实测的位置上。

另外三项针对「元素被祖先加工过」的补偿，缺了任何一项展开图都会明显走样：

- **累积缩放**：盒子量的是变换后的尺寸，字号／边框／圆角量的却是变换前的值。二者都乘上
  祖先 `transform` 的累积缩放，否则 0.5 倍裁剪窗里的 24px 标题会撑爆自己的框。
- **累积不透明度**：元素被逐个拆出来，祖先的 `opacity` 和颜色自身的 alpha 都要折进
  每个对象。漏掉的话，12% 透明度的水印大字会导出成实心亮字。
- **裁剪**：伸出 `overflow:hidden` 祖先的部分要按可见切片摆放，图片按可见区截图；
  完全不可见的元素直接跳过。

## 排错

**某个元素没有独立边界框（掉进兜底背景）**
到 `outputs/.../scene.json` 查它的 `roles`。判成 `image` 通常是两种情况：面积占比 ≥ 0.9
（被当成满画布背景），或者它确实没有自己的墨迹（纯布局容器）。前者属误判，
需要调 `MAX_SHAPE_AREA_FRACTION` 或在 `classify_elements` 里加规则。

**整页只有一个对象**
源 HTML 整页画在**一个大 `<svg>`** 里。SVG 内部节点不拆——这类页面没有可分的顶层结构，
是转换器的已知限制，不是 bug。要拆得改 HTML 生成侧，让结构落在 DOM 元素上。

**编辑器 UI 被拍进了 PPTX**
说明页面被当作 `plain` 转换了。正常的 Editable Design `editor.html` 会被自动识别并调用
`fullHTML()`；如果编辑器 API 没有成功加载，改传原始 `index.html` 或编辑器下载的
`*.edited.html`。

**相对资源（css／字体／图片）丢失**
按 HTML 所在目录解析，所以在原目录里跑最稳。

## 分发给别人

```bash
./pack.sh                      # → ~/Desktop/html-to-pptx-skill.tar.gz
```

`pack.sh` 会把完整 Skill（含固定的 `scripts/_html_to_pptx.py`、依赖清单、许可和诊断脚本）
一起打包，解压后不依赖本仓库其他文件。

对方：`tar -xzf html-to-pptx-skill.tar.gz -C ~/.codex/skills/`。首次转换会自动准备隔离运行时，
无需另外安装 Python 包或 Playwright。
包里带着 `pack.sh` 自己，可继续二次分发。

## 与 Editable Design 的关系

两者是可独立安装的同级 Skill，不是主 Skill 与内部子 Skill。Editable Design 负责完成并交付
HTML、PNG、浏览器编辑器和设计回放；本 Skill 只负责把用户指定的 HTML 转成 PowerPoint 中
可编辑的 PPTX。

当 Editable Design 已完成核心设计，如果本 Skill 可用，可以向用户简短说明“还可以导出为
可编辑 PPTX”。**只有用户明确说需要时才运行转换**，不能让 PPTX 导出阻塞或延迟核心设计交付。
转换时可使用原始 `index.html`、编辑器下载的 `*.edited.html`、正常加载的 `editor.html`
或 `layers.html`；入口会自动选择对应的预处理路径。
