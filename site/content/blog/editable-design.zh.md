---
title: Editable Visual Design
subtitle: Coding-Agent-Driven Creation of Editable Visual Artifacts
summary: 我们想讨论一个很具体的问题：当 AI 交付一张设计稿时，用户拿到的应该是一张只能整体重做的图片，还是一份可以继续修改的稿件。
date: 2026-08-28
kicker: 研究
variant: x3
ctaLabel: Gallery
ctaHref: https://yejy53.github.io/Editable-Design/
github: https://github.com/yejy53/Editable-Design
tags: editable design, coding agent, visual prior
---

<!-- 素材清单（工作备注，不会渲染到页面上）
文件都在 site/public/blog/editable-design/，正文用 /blog/editable-design/<文件名> 引用。
换素材时把新文件拷成同名即可，正文不用动；要改画框比例就调所在 case 的 aspect。
重新生成全部素材：./tools/build_assets.sh（源文件在本机，不入库）。

── 开篇 case · aspect 16/9 · 全流程演示
   promo-zh.mp4            1280x720  123.0s  6.1M  中文配音 + BGM（英文版用 promo-en.mp4，无声）

── 第 1 组 case · aspect 9/16 · 「像素图 vs 可编辑结构」
   compare-diffusion.jpg   800x1421   181K  比例 0.563
   coded-artifact.jpg      744x1323   152K  比例 0.562（同时用于第 2 组）

── 图 1 · 工作流总览 ← GenClaw-Next/figure/pipeline.png
   workflow.jpg            2600x1252  917K

── 第 2 组 case · aspect 9/16 · 视觉先验 → 编码产物
   prior-concept.jpg       744x1322   167K
   coded-artifact.jpg      744x1323   152K

── 图 2 · 图层拆解 ← promo assets/nordic/exploded.png
   layers-exploded.jpg     1400x1236  128K

── 第 3 组 case · aspect 7/6 · 可编辑画布录屏（比例 1.067–1.258，取 7/6＝1.167 使黑边最窄）
   editable-nordic-chair.mp4    1200x1000  15.7s  647K  比例 1.201
   editable-poster-edit.mp4     1200x1020  18.8s  790K  比例 1.176
   editable-dragon-year.mp4     1200x1126  37.7s  1.9M  比例 1.067
   editable-cobalt-prayer.mp4   1200x996   18.7s  1.3M  比例 1.205
   editable-ai-recruiting.mp4   1200x954   25.6s  896K  比例 1.258
   editable-shanyou-tea.mp4     1200x1120  24.9s  1.1M  比例 1.070

── 图 3 · 三个 brief 的 prompt → 编码产物 → 可编辑画布 ← figure/result2.png
   showcase-editable.jpg   2230x1856  942K

── 第 4 组 case · aspect 16/9 · Design Replay 录屏
   replay-nordic-chair.mp4 1920x1080  19.5s  1.1M

── 图 4 / 图 5 · 两个真实案例的 Agent Design Replay ← figure/Agent-Replay.png / Agent-Replay1.png
   replay-red-panda.jpg    2800x1260  669K
   replay-chongqing.jpg    2800x1200  557K

── 未被引用（留在目录里但正文没用）
   editable-canvas-wide.mp4 1728x904  17.1s  660K  北欧椅编辑器全屏视角
-->

在真实的设计与前端工程场景中，**“交付一张图片”从来不等于“完成了设计”**。

无论一张位图的光影与质感多么惊艳，只要它无法分层、文字不可修改、元素无法独立调整，它在严谨的生产链路中就只能是一个供人参考的“视觉半成品”。产品可能需要微调一行文案，运营可能需要更换一个活动时间，设计师可能需要把主体元素向左平移 20 像素——在传统的文生图工作流里，这些细微调整往往意味着推倒重来、重新“抽卡”，成本高昂且结果不可控。

所以我们把问题换了一个问法：不去追问“AI 能不能画出好看的海报”，而是追问**“AI 能不能交付一份可以继续改的稿件”**。围绕这个问题，我们做了 **Editable Visual Design**——让 Coding Agent 承担设计架构师的职责，把视觉生成从“单次位图出图”，变成图层解耦、文本可改、经过质量门禁的结构化代码工程交付。

下面这段演示，是从初始需求、概念构想、图层解耦，到原生 HTML/CSS 代码构建与交互式编辑的完整过程：

```case
mode: gallery
aspect: 16/9
item: | /blog/editable-design/promo-zh.mp4
```

## 为什么“可编辑性”是 AI 视觉设计的核心门槛

真正面向生产的设计资产，需要同时具备**视觉表现力**与**确定性可编辑性**：文字应当是纯净可交互的字符，主体与插画应当是独立透明的素材，布局与几何装饰应当遵循严密的网格坐标体系。

把这两种产物放在一起看，差别会更直观。左边是扩散模型针对同一条 brief 直接生成的位图：质感和氛围都在，但文字是画出来的、图层是粘连的，改一个字就要重新生成整张画面。右边是同一条 brief 经 Editable Visual Design 得到的产物：它在浏览器里是一棵 DOM 树，标题、正文、细节图与背景各自独立。

```case
mode: compare
aspect: 9/16
item: 扩散模型直出 · 一张位图 | /blog/editable-design/compare-diffusion.jpg
item: Editable Visual Design · HTML 结构 | /blog/editable-design/coded-artifact.jpg
caption: 同一条北欧家具长图 brief 的两种产物。右边的每一处文字都是真实字符，每一块素材都可以单独选中、移动与替换。
```

> 观感可以靠“抽卡”逼近，但可维护性不能。一份稿件是否可以被继续修改，决定了它是一张作品，还是一个交付物。

## 纯代码的“左脑”与扩散模型的“右脑”

要同时拿到高级美感与完全可编辑性，现有的自动化生成技术会遇到一个典型的“左右脑分离”困境。

**偏向“左脑”的纯代码生成。** 最新一代大语言模型精通 HTML、CSS 与 DOM 树排版，结构严谨、天然支持二次编辑。但代码本质上是一维符号序列，模型缺乏对二维空间的全局视觉直觉。直接让模型编写页面代码，往往只能产出高度模板化的“大标题 + 圆角卡片 + 色块阴影”三件套，难以跨越从“语法正确”到“视觉高级”的鸿沟。更麻烦的是，电影感背景、写实插画、自然纹理这类复杂素材极难用代码手绘，产物很容易缺乏视觉张力。

**偏向“右脑”的扩散模型生图。** 扩散模型压缩了人类数百年的美术先验，能够瞬间生成光影与氛围俱佳的画面；但它缺乏严谨的结构逻辑，生成的像素图存在文字拼写形变、图层深度粘连等固有缺陷，无法作为严谨的工程交付物。

受世界动作模型（World Action Model, WAM）的启发，我们没有在两条路线里选一条，而是把它们组成 **“创作大脑 + 视觉模拟器”** 的协同机制：

1. **VLM 担任“创作大脑”**：统筹需求理解、任务规划、结构化代码编写与最终的渲染视觉评审；
2. **生成模型担任“视觉世界模拟器”**：作为大脑随时调用的外挂工具，负责把抽象构想快速具象化为直观的视觉画面，以及产出干净独立的局部素材。

![Editable Visual Design 工作流总览](/blog/editable-design/workflow.jpg "工作流总览：需求与设计规划 → 视觉模拟 → 代码与素材协同生成 → 可编辑交付；底部的横条是贯穿全程的 Design Replay")

整条链路上，只有真正需要像素的地方才会调用图像模型：**需求与设计规划**把用户 prompt 变成关于版式、配色、字体与素材的显式计划；**视觉模拟**取得一张全局概念图，并把它的布局、色彩、层级与信息密度反馈回计划；**代码与素材协同生成**分两路并行，素材生成器按需产出干净独立的背景、插画元素与图标，代码构建器把它们与真实文本组装成原生 HTML/CSS/SVG；**可编辑交付**则把结果交付为一块画布，图层保持独立可选中，并可导出为 HTML/CSS/SVG、PPTX、PNG 或 PDF。

## 先想象，后行动

Agent 遵循一个“先想象、后行动”的闭环：在编写代码前，先调用模拟器生成概念草图，以此确立构图、光影与色彩基调；随后自主拆解资产，生成干净独立的局部素材（如无文字背景图、透明主体插画），并编写原生 HTML/CSS/SVG 重构版面；最后结合渲染观察进行多轮自愈修复。

需要强调的是，我们并不要求 Agent 一比一复刻这张视觉参考。它更像是一份**美学先验**：告诉 Agent 画面应该有多满、主视觉放在哪、色调偏冷还是偏暖、留白留多少。

```case
mode: gallery
aspect: 9/16
item: | /blog/editable-design/prior-concept.jpg
item: | /blog/editable-design/coded-artifact.jpg
caption: 左：图像模型给出的概念参考，确立构图、色调与信息密度。右：Agent 依据这份先验重新用代码构建的产物，文字全部为真实字符，细节图与背景是独立素材。
```

> “美学”是一种极难用一维文字量化、却极易被图像具象化的先验知识。让 Agent 先“看见”一个可能的设计方向，再去写真实内容与可编辑结构，比让它闭着眼睛盲写要可靠得多。

代码构建完成后，产物本身就是分层的。把同一份产物在编辑器里“炸开”，可以看到它由哪些图层组成：

![可编辑产物的图层拆解](/blog/editable-design/layers-exploded.jpg "同一份产物的图层拆解视图：标题、说明文字、细节图、背景与装饰各自独立，可单独选中、移动、重排与导出")

首轮生成的代码难免带着瑕疵：样式溢出、元素重叠、图文遮挡。所以在交付之前还有一道双重校验与自愈：系统先在无头浏览器里跑确定性的版式规则检查，检测元素是否越界、外部资源是否加载失败、DOM 结构是否异常；再把页面的真实渲染截图交给 VLM 评审，比对渲染结果与设计意图，评估视觉平衡、对齐精度与文字可读性。发现问题时，Agent 生成针对性的局部补丁，通常一到两轮反思修复就能让渲染达到预期。

## 交付一份可以继续改的稿件

今天，多模态创作的终点大多是一张**像素图**。图片一旦交付，文字、图层和布局基本也就定型了。而由 Visual Code 生成的 **HTML、PPTX** 等产物本身是可编辑的：文字准确、图层可控，用户拿到的不是一张只能整体重做的图片，而是一份**可以继续修改的稿件**。

下面这组录屏更直观：每一段都是在浏览器里直接拖动元素、改写文字、替换素材。

```case
mode: gallery
aspect: 7/6
item: | /blog/editable-design/editable-nordic-chair.mp4
item: | /blog/editable-design/editable-poster-edit.mp4
item: | /blog/editable-design/editable-dragon-year.mp4
item: | /blog/editable-design/editable-cobalt-prayer.mp4
item: | /blog/editable-design/editable-ai-recruiting.mp4
item: | /blog/editable-design/editable-shanyou-tea.mp4
caption: 六个不同类别的产物在可编辑画布中的表现：文字双击即改，素材可拖动缩放，图层可以单独导出。
```

同一套工作流在不同的信息密度与视觉语汇下都成立。下图取了三条刻意拉开风格差距的 brief——纸雕质感的冬季城市图鉴、明亮的 3D 夏日音乐海报、以及扁平网格的孟菲斯风科技展海报——每一条都展示了 prompt、最终编码产物，以及同一份产物打开后的可编辑画布：

![三条 brief 的 prompt、编码产物与可编辑画布](/blog/editable-design/showcase-editable.jpg "从 prompt 到可编辑画布：右侧面板才是重点——交付物不是一张压平的图片，而是一组可独立寻址的元素")

如果某块图像素材需要更换，也只需要调用一次图像模型做局部替换，而不必把整张作品推翻重来。这是“结构化交付”与“重新抽卡”之间最实际的区别。

## Agent Design Replay：让设计过程不再是黑盒

过去无论是文生图还是端到端代码生成，本质上多呈现为不可解释的黑盒：用户输入提示词后只能被动等待结果，无法窥探模型的构思过程，也难以在中间环节精准干预。

我们引入 **Agent Design Replay**，把 Agent 从需求理解、概念模拟、素材生成到代码调整的全过程完整记录下来，并按“理解与规划 / 生成与构建 / 评审与修复”三个阶段带时间戳地呈现：

```case
mode: gallery
aspect: 16/9
item: | /blog/editable-design/replay-nordic-chair.mp4
caption: Design Replay 的交互视图：每一步都带时间戳与自己的产出，右侧同步展示当前的图层结构与渲染结果。
```

两个真实案例可以看出这条轨迹如何随 brief 的性质改变：

![红熊猫图鉴的 Agent Design Replay](/blog/editable-design/replay-red-panda.jpg "信息密集型 brief：独立素材（栖息地主视觉 + 面部、爪部、尾部细节）在 1600 × 2400 的渲染契约下组装为 13 组、120 个可编辑图层，评审阶段捕捉并修复了“速览事实溢出网格行”这类真实缺陷")

![山城雨夜海报的 Agent Design Replay](/blog/editable-design/replay-chongqing.jpg "视觉驱动型 brief：一张通版背景承担构图，契约为 1200 × 1600、1 组 6 个图层，评审逐行读排版并直接通过")

同样的工作流与同样的质量门禁，会得到与 brief 密度相匹配的图层结构。这种过程可见性不仅有助于建立人机协同（Human-in-the-Loop）中的理解与信任，也让“在中间环节介入”这件事第一次变得可行。

## 几点讨论

### 重新审视“生成辅助理解”：人不可能在梦里做数学题

长期以来，统一多模态模型（UMM）在探索“生成辅助理解（Generation for Understanding）”时，多集中于几何辅助线绘制、迷宫路径推理等强符号逻辑任务，但实际收益往往相对有限。

究其原因，严密的符号逻辑推导并不契合生成模型的隐式反馈机制。一个形象的比喻是：**人类很难在梦境中解出严密的数学题，但梦境却常常是视觉灵感、意象与创意构思迸发的温床。** 扩散模型的生成机制正类似于一种“视觉做梦”，让它直接参与精确计算容易产生偏差；但“美学”恰恰是极难用一维纯文本量化、却极易被图像具象化的先验知识。

将生成模型前置为视觉模拟器，让 Agent 在编写代码前先借助图像感知全局效果，正是利用“生成”获取高维审美与构图先验，从而自然地反哺后续的结构化代码排版与决策。

### 生成模型的真实生态位：认知大脑的外挂渲染器，而非全能智能体

从 GenClaw、Mind-Brush 到本文的实践，在一定程度上反映出不同模型之间自然的分工定位。当前的图像生成模型核心优势在于对高维视觉画面质感的拟合，但其本身并不直接具备通用逻辑推理与系统规划能力。

因此，将生成模型作为 **Agent 创作大脑随时调用的外挂模拟器与局部素材渲染工具**，是一种相对务实且高效的组合方式。高阶的需求拆解、任务规划、代码组织与质量检查由具备通用推理能力的 VLM 主导，生成模型则根据需要把抽象构想快速呈现为具体画面。这种协同既发挥了生成模型的视觉表现力，又用代码补上了它缺乏结构控制力的短板。

### 从“位图输出”到“结构化工程交付”

在实际的设计与商业应用场景中，设计交付物必须具备一定的可维护性与调整空间。传统文生图模型虽然画面质感丰富，但由于像素深度粘连、文字易错，后期微调较为困难。

Editable Visual Design 尝试使用原生 HTML/CSS 和解耦素材来组织版面，使文本、背景与图形图层相对独立，便于用户进行二次选中、修改与导出。这标志着 AI 驱动的视觉设计正逐步从“单次位图抽卡”，走向兼具视觉表现力与确定性可维护性的**工程级交付（Engineering Artifacts）**。

### Agent Design Replay：从过程可见到拟人化交互

通过 Agent Design Replay，设计决策链条的透明度与可追溯性得到提升。更进一步，它也为未来更自然的设计交互形式提供了参考思路——例如 AI 结合 GUI 直接操作鼠标，在画布上排版与绘制。产物可编辑，过程也可回看，人和 Agent 才有可能在同一份稿件上真正协作。

## 结语

Editable Visual Design 的核心，在于探索一种让 AI 像人类设计师一样构思、规划与交付的完整工作流：**以直觉感知美学，以代码构筑秩序，以工程交付价值。**

Gallery 收录了五个视觉设计类别下的 17 条 prompt，附最终产物、可编辑演示与 Agent Design Replay。这套能力已经整理成 `poster-building` 的 Skill 形式，面向 Codex、Claude Code 这类宿主；可安装的 Skill 包与可复现的起始项目正在准备公开发布。
