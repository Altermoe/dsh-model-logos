# GitHub 上的现有实现 —— DSH 的模型 / 提供方图标

> 英文原文：[prior-art.md](prior-art.md)

调研于 2026-10-27 执行，覆盖 GitHub（仓库与 API 搜索）、npm（registry API）以及
DSH 插件索引，时间在本仓库首次公开推送之前。Star 数与日期均为当日所见。除标注
*(未核实)* 者外，下列每个条目都已实际打开阅读，而非依据搜索摘要推断。

**一句话结论：** *输入区图标* 这只轮子已经被造出来了 —— 约两个月内出现了七个具名的
模型图标插件，外加一排徽标 / 主题插件，都在 DSH Web GUI 里绘制厂商或模型标识。但没有
任何实现覆盖本插件的组合：**设置 → 模型页的装饰、模型级（而非提供方级）匹配、以及按
`provider+model` 指定、带选择器并持久化在 `cordis.patch.yml` 中的图标覆盖。**
可以发布，但定位要放在这些差异点上，并引用这些邻居。

## 最接近的邻居

| 插件 | 装饰的位置 | 标识层级 | 图形来源 | 配置 / 持久化 | 与本插件的重合度 |
| --- | --- | --- | --- | --- | --- |
| [koliy82/dsh-model-icons](https://github.com/koliy82/dsh-model-icons) | 输入区模型菜单（16 px）、输入区模型按钮（14 px）、`/model` 弹层；会隐藏皮肤自带的组合标识 | 模型（对照提供方的镜像目录匹配，依据模型 id / 显示名 / id 前缀 / id 形态） | 未内嵌；提供方目录 + `/logos/*.svg` 镜像到回环路由，以 CSS mask 绘制 | 自有设置页上的 3 个开关 → `<profile>\.dsh-model-icons\config.json`；`DSH_MODEL_ICONS_*` 环境变量可覆盖 | **重合度最高。** 同样覆盖三处输入区表面、模型级匹配、带设置页。没有覆盖 设置 → 模型页，没有按模型覆盖，没有选择器。MIT。 |
| [Dogtiti/dsh-plugin-provider-icons](https://github.com/Dogtiti/dsh-plugin-provider-icons) | 输入区模型菜单、触发器、每个选项行 | 厂商（精确 id → 别名 → 前缀 → 灰点） | 24 个品牌以内联 base64 data URI 提供，来源为 [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons)（MIT） | 无（在 `client.js` 中修改 `LOGOS`） | 匹配阶梯与离线 data URI 思路接近本插件；但只做厂商、只覆盖输入区。GitHub 上许可证显示为 "Other" —— 不要假定为 MIT。 |
| [ZG2017/dsh-plugin-model-icons](https://github.com/ZG2017/dsh-plugin-model-icons) | 仅输入区模型按钮（+ 响应式收起为纯图标） | 厂商，依据**可见的模型名称文本**匹配 | 约 11 个品牌内联 + sparkle 兜底 | 无 | 最小的邻居；无选择器、无覆盖。MIT，v0.2.0 面向 DSH 0.2.1。 |
| [toyvfish/dsh-model-seat](https://github.com/toyvfish/dsh-model-seat) | 替换整个输入区模型座：触发器、带描述的分组菜单、搜索、推理滑块 | 厂商（40 个品牌标识 + 中性兜底） | 40 个品牌 SVG，颜色可调 | 通过宿主 Config schema 提供 17 项外观设置 → `cordis.patch.yml` | 在**持久化**（`cordis.patch.yml`）与设置页方面最接近，但设置只涉及外观；没有按模型选图标。MIT。 |
| [hun1315/dsh-msi-icons](https://github.com/hun1315/dsh-msi-icons) | 模型选择器行 + 四区重排、置顶 / 收藏、宿主侧故障转移路由 | 厂商 | 内置标识 + 16 槽预留库 + 用户 SVG 文件 | `~/.dsh/msi-icons/vendors.json`、`pins.json`（自有格式文件） | 与图标和模型行样式有重叠；但解决的是另一个问题（布局 + 故障转移）。MIT。 |
| [weijianguizhou/dsh-model-provider-badge](https://github.com/weijianguizhou/dsh-model-provider-badge) | 替换整个模型选择器（slot `conversation.input.model`，优先级 −10） | 厂商 | 官方 / 公开 SVG；哈希着色的云朵兜底 | 无 | 属于选择器重写，而非装饰；无设置页、无覆盖。MIT。 |
| [pc439527/dsh-model-provider](https://github.com/pc439527/dsh-model-provider) | 用 提供方 → 模型 → 思考强度 的下钻替换输入区模型座 | 暂无（"Provider icons" 在其**路线图**上） | — | 语言词典；无图标配置 | 说明即便对做选择器重写的作者来说，这块空间仍然空着。MIT。 |
| [Townrain/dsh-model-vendor-badge](https://github.com/Townrain/dsh-model-vendor-badge) | 输入区内为**当前**模型提供一个厂商 logo 座 | 厂商 | 未查看 *(未核实)* | 未查看 | 相邻项目；是当前模型徽标，而非逐行标识。 |
| [prgrmrwy/dsh-sidebar-session-provider-icon](https://github.com/prgrmrwy/dsh-sidebar-session-provider-icon) | 侧边栏会话行：提供方 logo + 10 px 模型徽标 | 厂商 + 模型 | 打包 `@lobehub/icons-static-svg@1.94.0`（MIT）+ OpenCode SVG | 无 | 表面不同（侧边栏），但验证了"提供方 logo + 模型徽标"这种组合。MIT（npm 0.1.7）。 |
| [maxeone/dsh-plugin-deeptweaks](https://github.com/maxeone/dsh-plugin-deeptweaks) | 视觉美化合集，含"矢量模型 logo" | 厂商 / 模型 *(细节未核实)* | 未查看 | 未查看 | 是合集里的一个功能，而非聚焦插件。MIT。 |
| [reimu-create/uiopt](https://github.com/reimu-create/uiopt) | 显示增强：余额、上下文环、缓存命中率、**提供方图标**、插件管理器 | 厂商 | 未查看 | 未查看 | 合集里的一个功能。 |

不属于模型图标竞争者的项目（已检查并排除）：应用 / 侧边栏品牌类插件
（`dsh-custom-logo`、`dsh-brand-custom`）、主题 / 皮肤插件、会话图标选择器
（`xieshuaix/dsh-session-icons` —— 按*会话*选图标）、以及 `dsh-icon-custom`
（浏览器标签页 favicon）。

### 设置页方面的邻居 —— 以及一处冲突

- [HiSeax/dsh-better-model-setting](https://github.com/HiSeax/dsh-better-model-setting)
  **替换**了官方发布的模型页（`settings.section id=models`，order 10），并禁用
  `ui-settings-models`。纯功能型 —— 提供方、推理档位、重试、凭据圆点 ——
  **没有任何品牌标识**。但它对我们是一处冲突风险：本插件的装饰器以
  `[data-shortcut-modal="settings"]` 为根，并用启发式方式匹配提供方行 / 模型行 /
  `<select>`，一旦官方页面被替换，很可能的结果就是静默无操作 —— 或者替换页上相似
  标记造成的误判。它不会抛错，但可能装饰到错误的东西上；请检测官方页面并跳过，或者
  记录该不兼容。BSD-3-Clause。
- [yzke/dsh-icon-theme](https://github.com/yzke/dsh-icon-theme) 是目前最接近的
  *按项图标覆盖* UX：设置 → 图标页列出所有被发现的设置 / 侧边栏目标，默认保留原图标，
  并按稳定 key 持久化覆盖。它覆盖的是界面 chrome 图标而非模型标识 —— 但"选择器 +
  覆盖 + 还原原始"的模式及其解析阶梯（用户覆盖 → 内置字形 → 原始 → 兜底）在这套生态里
  已经存在。MIT。
- [MentonLiu/dsh-any-icon](https://github.com/MentonLiu/dsh-any-icon)
  *(仅依据摘要)*：Icon Studio 面板，上传 → 1:1 裁剪，应用 / 会话行图标 —— 不是按模型
  的标识。

## 没有一家做的事（我们的差异点）

1. **设置 → 模型页从未被任何 *logo* 类竞争者触及。** 没有任何插件把厂商 logo 放到官方
   提供方行、提供方编辑器标题上，或把添加提供方的 `<select>` 绘制成带 logo 的组合框。
   唯一真正接管该页的插件是 `dsh-better-model-setting`，而它不带任何 logo（见上面的
   冲突说明）；其他设置页模型插件加的是*数据字段*，例如模态能力选择器。
2. **模型级品牌，而非提供方级。** 竞争者回答的是"哪条通道提供这个模型"；我们回答的是
   "这个模型属于哪个品牌"，因此聚合商的一行 `openrouter / anthropic/claude-sonnet-4.5`
   会得到 Claude 的标识。
3. **按 `provider+model` 的图标覆盖，并配选择器** —— 自动 / 无图标 / 字母 / 任意内置
   品牌 —— 存放在 DSH 设置文档（`cordis.patch.yml`）中，而不是 `localStorage`、自有
   JSON 或硬编码表。没有 DSH 插件为模型标识提供这个能力；覆盖选择器这种*模式*只存在于
   chrome（`dsh-icon-theme`：设置 / 侧边栏图标）和按会话（`dsh-session-icons`）两处。
4. **确定性的字母方块**，作为面向冷门 / 本地模型的诚实兜底，外加设置行上虚线样式的
   "一步可达"占位。
5. **完全离线**（离线 SVG 方块，不镜像目录、不使用回环路由），并且选择器与设置区块都支持
   **中英双语**。

说明："未找到"不等于"不存在"。这个领域远大于任何单一索引：dsh.so 索引约 2.2 万个仓库
（Appearance 分类下约 1,943 个），deepseek1024.com 约 1.39 万个插件，npm 匹配约 2.4 万个
`dsh-` 包。此处仅对 GitHub 的仓库 API 与各仓库 README 做了穷尽搜索；
`awesome-dsh-plugin` 与 `imsai-sh/awesome-deepseek-harness-plugins` 只能通过搜索摘要
阅读，`dshbase.com` 无法访问，因此上面有几个条目仅有摘要依据。逐项证据是核实过的；整体
集合并未被证明完整。

## 图形：复用而不是重画？

[`lobehub/lobe-icons`](https://github.com/lobehub/lobe-icons) 是 MIT（"Copyright ©
2023 LobeHub"），收录 340+ 个 AI 模型 / 提供方 / 应用品牌，并提供静态 SVG 包
（`@lobehub/icons-static-svg`）与 CDN。一个直接竞争者（Dogtiti）已经基于它发布，另一个
（prgrmrwy）打包了它的静态包 —— 所以这在生态里属于常态，并不新颖。

- **法律层面：** MIT 覆盖的是文件，不覆盖标识；标识仍是其所有者的商标。手工绘制**不会**
  带来额外的法律安全性 —— 无论哪种方式都需要同样的描述性使用 / 商标声明。当前 README 的
  商标段落就是恰当形式的声明；如果打包 lobe-icons 资源，还应附上其 MIT 文本并在 NOTICE
  中说明。
- **工程层面：** 图标是商品化的部分。复用 lobe-icons 可以免去别名维护（`gpt-4o`、
  `claude-sonnet-4.5`、`qwen3…`）和旧的手工重绘，代价是引入一个构建期 vendoring 步骤。
- **已采纳的决定：** 把固定版本的 lobe-icons 静态 SVG vendor 进现有的 24×24 方块外框，
  保留导入脚本与来源说明，只留下少数有记录的手工例外。不要把图形本身当作创新点 ——
  创新点是覆盖 UI 和设置页覆盖范围。

## 推送之前

1. 在 README 中加一节简短的**现有实现（Prior art）**，链接上面的邻居，并写出两行差异点。
   不要声称自己是第一个模型 logo 插件。
2. 让*仓库 / 包描述*承载差异点，因为裸名称在语义上会撞车：`dsh-model-icons`（koliy82）
   和 `dsh-plugin-model-icons`（ZG2017）都已存在。`dsh-model-logos` 本身在 GitHub 与 npm
   上仍然空闲（2026-10-27 核查）。
3. 考虑在 `koliy82/dsh-model-icons`（最近的邻居）上开 issue / PR，提供覆盖选择器，或者
   至少互相链接 —— 这才是这份调研"不要重复造轮子"的落地方式。
4. 发布时添加 `dsh-plugin` GitHub topic，并提交到社区索引（`awesome-dsh-plugin`、
   dsh.so Discover），让差异点出现在邻居旁边，而不是被埋没。
5. 发布前做共存测试：与 `dsh-better-model-setting`（会替换模型页）一起安装，确认装饰器
   干净跳过，而不是抛错或装饰到错误页面；把结果加入验证记录。
