# 新博客：五张统计图的修改建议

这是替换图片前的修改建议记录。新版中英文图已接入；当前核对结果见 [图表核对记录](./blog-chart-audit.md)。旧的 Editable Visual Design 介绍文未带入。

## 所有图共同修改

1. 去掉图内的 Design Arena 字标、图标，以及 `Design Arena: WebDev / Poster` 标题。正文可以链接并说明比较形式受到其启发，但不要让自有模拟图看起来是官方榜单截图。
2. 每张图内直接写入 `内部探索性模拟 · 非 Design Arena 官方结果`；英文写 `Exploratory simulation · Not official Design Arena results`。标注需要跟随图片导出，不能只依赖网页图注。
3. 去掉奖牌式名次、1/2/3 排名圆标和榜单装饰。保留模型名称用于识别设置，将重点转向同一模型的策略比较。
4. 可以继续使用深蓝、橙色和灰色。深蓝表示基线，橙色表示指定策略，灰色表示平局或参照；为负变化保留清楚的标记，不能把所有变化都画成提升。
5. 中文与英文分别导出图内文本。两版共用同一份数据文件，避免数值与模型顺序漂移。
6. 样本数、评审配置、聚合方式只按原始记录填写；不能为了让两处看起来一致，直接把 30 改成 50，或把“3 位评审”猜成“三次模型调用”。

图内脚注建议：

> 仅反映本次模拟设置；VLM 偏好不等同于人类偏好。相对分数仅在本次比较集合内解释，不与外部榜单比较。

> Results apply only to this simulation setup. VLM preferences are not human preferences. Relative scores are local to this comparison pool and are not comparable with external leaderboards.

## 图 1 — elo-vs-imagecalls.png

新版对应图：[网页基线图](../site/public/blog/genclaw-next/charts/zh/wide_leaderboard.png)

- 建议标题：**素材调用与模拟偏好：一次探索性对照**。
- 英文：**Asset use and simulated preference: an exploratory comparison**。
- 用并排、对齐的两栏显示“相对偏好分数”和“平均生图调用次数”，不要用名次制造官方榜单感。分数建议用点图；Elo 没有自然零点，截断坐标的实心长条容易夸大视觉差距。
- 图片调用次数是过程指标，不是质量指标。图注应明确“共同变化不代表因果关系”。
- 必须核对：原稿正文写约 30 条任务、一个 VLM，图中写 3 judges / 50 cases。正文称 GLM 为前三，但图上 MiniMax 在其前。正文已去掉这句名次总结。

## 图 2 — design-md-ablation.png

新版对应图：[设计规划两两比较](../site/public/blog/genclaw-next/charts/zh/wide_design_ab.png)

- 建议标题：**加入设计规划后的模拟偏好比较**。
- 英文：**Simulated preferences with and without design planning**。
- 胜／平／负堆叠条形图可以保留，优先于一个笼统的胜率。右侧直接列原始计数和有效比较总数 `n`。
- “决胜局胜率”改成更明确的“排除平局后的偏好比例”，并注明 `W / (W + L)`；条形内部的胜占比则是 `W / (W + T + L)`，两者不能混用。
- 当前各行 W/T/L 合计不同，例如 15/4/4 为 23、7/3/4 为 14。需要解释有效样本数差异以及失败、缺失样本的处理方式，不能只写一个统一任务数。
- 若实际同时改变工具、提示词和生成预算，应把标题改成“组合策略比较”；只有确认变量后，才能将效果归于 `design.md`。

## 图 3 — design-md-elo.png

新版对应图：[设计规划分数变化](../site/public/blog/genclaw-next/charts/zh/wide_design_compare.png)

- 建议标题：**设计规划前后的内部相对分数**。
- 英文：**Within-study relative scores with and without design planning**。
- 改成同一行两个点相连的配对点图，分别标基线和策略版本，旁边标有正负号的差值。按模型名称或固定顺序排列，不按终点分数排名。
- 明确保留 Kimi 的 `−2`，正文不能概括成“所有模型都提升”。
- 核对本图的基线与图 1 是否来自同一比较集合。例如本图 Claude 的 1225 − 186 = 1039，而图 1 为 1117。若是不同池，应各自标明；若声称同一池，需要回查计算和版本。
- 不直接比较不同 Elo 池的绝对值；记录初始值、更新或拟合方法、对手集合与对战次序处理。

## 图 4 — no-agentic.png

新版对应图：[单轮生成比较](../site/public/blog/genclaw-next/charts/zh/wide_oneshot_board.png)

- 建议标题：**Context distillation 的内部探索性对照**。
- 英文：**An exploratory comparison of context distillation**。
- 主图聚焦 Qwen Base → SFT 的同模型配对比较，减少跨模型排行榜占据的空间。若其他模型确有可比记录，再作为次要对照保留。
- `+209` 改写为“本次比较集合内的相对分数变化”，不要把箭头画成跨越不同模型的名次晋升。
- 区分“平均配图数”和“有效加载图片数”；Non-Agentic 引用图片地址的数量不能称为生图工具调用次数。
- 17% → 3% 碎图率如要画入，应单列资源有效性面板，并注明页面数还是图片请求数作为分母。资源加载改善不直接等于设计质量改善。

## 图 5 — imaginer-ablation.png

新版对应图：[视觉参考比较](../site/public/blog/genclaw-next/charts/zh/wide_ref_compare.png)

- 建议标题：**视觉参考对海报生成的探索性影响**。
- 英文：**Exploring visual references for poster generation**。
- 采用与图 3 一致的配对点图，显示无参考／有参考及差值，不按模型的最终分数排名。
- `63% vs 37%` 只有在可以核对原始比较和分母时才作为附属标注。需要说明是否去除平局、是否按模型平均、是否汇总所有比较，以及相同 prompt 是否重复计数。
- 小幅变化（例如 +9）仅描述方向，不写“显著提升”。只有原始记录支持时才计算不确定性区间，不能补画猜测的误差条。

## 重绘前的数据边界

- **真实生成样本 + VLM 模拟偏好：** 保留可核验的数据，补全方法与局限；可称内部自动评估或 VLM 偏好模拟。
- **数值本身是人工设定／合成示意：** 应明确写“示意数据”，用条件 A/B 等标签展示机制，不使用真实模型排行榜来支持性能结论。
- **当前无法追溯的数值：** 保留在工作底稿中核对，不补编样本数、置信区间或评审设置。

后续已替换为用户提供的中英文新版图，并修正单轮配图标签；所有原数值保留。未重新验证实验记录。详见本轮核对记录。
