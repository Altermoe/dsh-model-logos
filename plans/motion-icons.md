# 动态自定义图标（动图 / 视频）· 实施计划

> 状态：**待审阅**（未开始实现）
> 目标版本：`0.8.0`（版本号在发布提交里再动）
> 范围：方案 B —— 所有动态素材在浏览器内采样成一张 sprite atlas，仍以 data URL 存在设置文档里
> 关联文档：[README](../README.md) · [架构](../docs/architecture.md) · [工程约定](../docs/engineering.md)

---

## 0. 一页摘要

- 新增"动态"来源模式：**动图（GIF / WebP / APNG / AVIF）和视频（MP4 / WebM）共用一套采样流程**，用户在编辑器里框取片段、设帧数，浏览器把 N 帧烘成一张横向 sprite（`frames × 128` 宽、`128` 高），再 base64 存进设置。
- 存储形状只做**加法**：`customIcons.<id>` 仍是 `kind: image` + `image`（首帧海报），新增可选 `motion: { atlas, frames, fps, frameWidth }`。**不新增 kind**，所以旧版本读到新数据会老老实实显示首帧，而不是让图标消失。
- 渲染契约不变（仍是 `Mark.svg` 字符串 + `innerHTML`）：sprite 用内联 SVG 的 nested viewport + `<animate calcMode="discrete">` 逐帧位移。已在本机 Chromium 验证可行。
- 播放策略按**界面分面**配置：会话输入框 `always`（默认）、设置 → 模型 `hover`、模型图标页 `hover`、图标选择器 `hover`；每项可改为"始终 / 交互 / 关闭"，并尊重 `prefers-reduced-motion`。
- 编辑器改造为**采样导演台**：素材 → 取景 → 时间轴 → 采样 → 体积预算 → 真尺寸预览，一个界面里完成；静态图继续走现有裁剪器。
- 零新增运行时依赖（`ImageDecoder`、`<video>` + canvas、`canvas.toDataURL('image/webp')` 都是浏览器自带）。

---

## 1. 已确认的决策

| #   | 决策     | 值                                                                            |
| --- | -------- | ----------------------------------------------------------------------------- |
| D1  | 存储路线 | 方案 B：统一采样为 sprite，不存原始动图、不存视频                             |
| D2  | 采样预算 | **2 秒 / 24 帧 / 128px**                                                      |
| D3  | 类型分档 | 合并为 **静态图片 / 动态** 两档（视频与动图共用一个入口，按文件类型自动识别） |
| D4  | 播放策略 | 按界面分面配置；会话输入框默认**始终播放**，其余默认**仅交互播放**            |
| D5  | 交互     | 本文第 5 节即最终交互定义（用户已授权由我决定）                               |

---

## 2. 相对上一轮讨论的两处修正

### 2.1 用 `image` + `motion`，而不是 `kind: 'animation'`

上一轮我建议新增 `kind: 'animation'`。写计划时发现更好的形状：

```yaml
customIcons:
  c-1d2f…:
    kind: image          # 不变：image 仍是"这个图标有一张静图"
    image: data:…        # 首帧海报（128×128），负责所有降级场景
    motion:              # 新增、可选；有它才播
      atlas: data:…      # frames×frameWidth 宽、frameWidth 高
      frames: 24
      fps: 12
      frameWidth: 128
```

理由：**任何"降级"都退回首帧，而不是整条图标消失。**

| 场景                                   | `kind: animation`        | `image` + `motion`        |
| -------------------------------------- | ------------------------ | ------------------------- |
| 旧版本客户端读到新数据                 | 整个图标被跳过（不可见） | 显示首帧海报，正常可用    |
| atlas 数据损坏 / 手改成非法值          | 整条被跳过               | 丢掉 `motion`，退回首帧   |
| 旧版改名（老客户端会按字段重建 entry） | 不影响（本来就看不到）   | 可能丢 `motion`，图标仍在 |
| host schema 改动                       | 新字段 + 新枚举值        | 只加一个可选子对象        |

代价：`kind` 字段从此只表示"payload 是静图"，动画与否看 `motion` 是否存在。这是内部语义，UI 上用 `motion != null` 判断，不影响用户。

### 2.2 不做"小动图原样保真"，全部走转码

你选了方案 B，这里明确执行：**GIF / APNG / WebP / AVIF 都不原样存**，一律解帧后重新采样。换来的是：体积可预测、裁剪/区间/帧数统一、四类格式行为一致。仍保留的例外是"只有一帧的动图"——直接提示用户改用静态页。

---

## 3. 数据模型

### 3.1 类型（`src/types.ts`）

```ts
export interface CustomIconMotion {
  /** 水平 atlas 的 data URL（PNG / WebP）。 */
  atlas: string;
  /** 帧数，2–24。 */
  frames: number;
  /** 循环速度 = frames / 秒，保留两位小数，0.5–30。 */
  fps: number;
  /** 单帧边长（正方形），96–256，默认 128。 */
  frameWidth: number;
}

export interface CustomIcon {
  id: string;
  name: string;
  kind: 'image';          // 不变
  image: string;          // 首帧海报（仍是 128×128 的 data URL）
  motion?: CustomIconMotion; // 新增
  createdAt: number;
}
```

`atlas` 的隐含尺寸：`frames * frameWidth` 宽 × `frameWidth` 高；不单独存宽高，避免自相矛盾。

### 3.2 常量与预算（`src/custom-icons.ts`）

| 常量                              | 值      | 说明                                                    |
| --------------------------------- | ------- | ------------------------------------------------------- |
| `DSHML_CUSTOM_MAX_ICONS`          | 40      | 不变                                                    |
| `DSHML_CUSTOM_MAX_DATA_URL`       | 128 KiB | 不变；单张 data URL（poster / atlas 各自适用）上限      |
| `DSHML_CUSTOM_MAX_POSTER`         | 32 KiB  | 新；海报单独上限，海报远小于此                          |
| `DSHML_CUSTOM_MAX_TOTAL_DATA_URL` | 3 MiB   | 新；全部 `customIcons` 的 data URL 字符总和，写入前检查 |
| `DSHML_CUSTOM_STUDIO.framePx`     | 128     | 单帧边长默认值                                          |
| `…minFrames / maxFrames`          | 4 / 24  | 采样帧数                                                |
| `…maxRangeMs`                     | 2000    | 片段时长上限                                            |
| `…minRangeMs`                     | 120     | 太短的片段没有意义                                      |
| `…maxFps`                         | 15      | 超过 15fps 在 128px 上收益为零                          |
| `…maxImageBytes`                  | 24 MiB  | 动图源文件上限（静态仍 12 MiB）                         |
| `…maxVideoBytes`                  | 64 MiB  | 视频源上限                                              |
| `…maxSourceFrames`                | 1200    | 动图源帧数上限（防长 GIF 解码爆炸）                     |
| `…workPx`                         | 1024    | 工作分辨率长边；所有解码/裁剪都在这个坐标系里           |

总预算 3 MiB 的理由：40 个图标按平均 60 KB 计约 2.4 MB。而设置文档每次写入都会整文件 YAML 重写（见 [config-editor](../../deepseek-harness/packages/boot/config-editor/src/index.ts)）；每次 `describe()` 又用整份 config 算 revision，返回的 `value` 与 `user` 里还各带一份 `customIcons`——也就是同一个 payload 在一次设置往返里被复制多次。超过 3–5 MB 后，任何一次设置改动都会明显卡。

### 3.3 校验与拒绝（解析期，`dshmlCustomIconFrom`）

- `image` 仍是合法 data URL（PNG / JPEG / WebP），否则整条跳过（现状）。
- `motion` 可选；**任何字段非法都只丢 `motion`，保留图标**：
  - `atlas`：合法 PNG / WebP data URL 且长度 ≤ 128 KiB；
  - `frames`：整数 2–24；
  - `frameWidth`：整数 96–256；
  - `fps`：有限数 0.5–30（不强制等于 frames/时长，播放只读它）。
- 写入期（编辑器/`dshmlCreateCustomIcon`）额外检查：`image` ≤ 32 KiB、atlas ≤ 128 KiB、`frames * frameWidth ≤ 4096`、总预算 ≤ 3 MiB。

### 3.4 兼容矩阵

| 数据 \ 客户端         | 旧版（0.7.x）            | 新版（0.8+）     |
| --------------------- | ------------------------ | ---------------- |
| 旧数据（无 `motion`） | 正常                     | 正常，按静态渲染 |
| 新数据（有 `motion`） | 显示首帧，不报错         | 按分面策略播放   |
| `motion` 损坏         | 显示首帧                 | 显示首帧         |
| 未知的额外字段        | 忽略（schemastery 透传） | 忽略             |

不需要迁移脚本：旧记录原样可读，新记录只多一个可选字段。

---

## 4. 渲染

### 4.1 mark 契约的扩展

`ModelMark` / `DshmlCustomMark` 增加一个可选字段：

```ts
interface DshmlCustomMark {
  title?: string;
  svg: string;           // 静态/海报（永远可用）
  animatedSvg?: string;  // 仅当 icon.motion 有效时存在
}
```

所有现有调用点继续使用 `.svg`，行为不变；需要播放的界面改用 `.animatedSvg`。这样即使某个界面忘了适配，最坏也只是不播，不会空白。

### 4.2 sprite mark 的 SVG

播放态（`animatedSvg`）：

```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
  <svg x="0" y="0" width="24" height="24" overflow="hidden"
       style="clip-path: inset(0 round 25%)">
    <image href="ATLAS" x="0" y="0" width="{24*frames}" height="24"
           preserveAspectRatio="none">
      <animate attributeName="x"
               values="0;-24;-48;…;-(frames-1)*24"
               dur="{frames/fps}s" calcMode="discrete" repeatCount="indefinite"/>
    </image>
  </svg>
</svg>
```

- 单行 atlas + `x` 位移，`calcMode="discrete"` 保证逐帧跳变；`dur = frames / fps`。
- 无 id、无脚本、无外链；`values` 与 `dur` 由纯函数生成，可单测。
- 圆角沿用 25% 的共享轮廓；`clip-path: inset()` 不引入 id，多个图标并存不会串。
- 播放态**不**额外包 poster 层：静态/交互态直接渲染海报 mark（与今天完全一致）。
- 圆角依赖 nested `<svg>` 上的 CSS `clip-path: inset()`；DOM 门禁会断言它存在。若某个浏览器不认，把同样的 `style` 挪到外层根 `<svg>` 即可，结构不变。

### 4.3 播放策略（分面）

```ts
type DshmlPlaybackMode = 'always' | 'hover' | 'never';
type DshmlPlaybackSurface = 'composer' | 'settings' | 'iconsPage' | 'picker';
```

| 分面        | 覆盖的界面                                   | 默认     |
| ----------- | -------------------------------------------- | -------- |
| `composer`  | 会话输入区的模型标签（三个 placement 全部）  | `always` |
| `settings`  | 设置 → 模型：provider 行、模型行、添加方下拉 | `hover`  |
| `iconsPage` | 设置 → 模型图标页的所有行                    | `hover`  |
| `picker`    | 图标选择器网格与预览                         | `hover`  |

持久化形状（`Config.playback`，全部 `.volatile()`）：

```yaml
playback:
  composer: always     # always | hover | never
  settings: hover
  iconsPage: hover
  picker: hover
```

实现：

- **React 界面**用新组件 `DshmlPlayableMark`：`always` 直接注入 `animatedSvg`；`hover` 先注入 `svg`，`pointerenter` / `focusin` 换成 `animatedSvg`，离开换回；`never` 永远 `svg`。
- **`decorate.ts` 的直接 DOM 路径**用对应函数 `dshmlAttachPlayableMark(node, mark, mode)`，返回解绑函数；行为与组件一致。
- 系统 `prefers-reduced-motion: reduce` 时，`always` 与 `hover` 一律降级为海报（设置值保留，不写回）。
- 动态图标在选择器网格里带一个很小的"动"角标（`motion != null` 才出现），这样即使当前分面是 `never` 或系统开了 reduced-motion，用户仍知道它是一张动图。

设置界面（模型图标页底部新增一组）：

```
┌ 动态图标播放 ──────────────────────────────────┐
│ 会话输入框    ( 始终播放 | 仅交互 | 关闭 )      │
│ 设置 · 模型   ( 始终播放 | 仅交互 | 关闭 )      │
│ 模型图标页    ( 始终播放 | 仅交互 | 关闭 )      │
│ 图标选择器    ( 始终播放 | 仅交互 | 关闭 )      │
│ 系统开启"减少动态效果"时，以上一律静止。        │
└────────────────────────────────────────────────┘
```

- 配置来自 `state.playback`，任一设置改动通过现有 icon store 通知所有分面重绘。

### 4.4 性能

- 一个 24×128 的 atlas 解码后约 1.5 MB；128×128 的海报解码后只有 64 KiB。**列表一律先用海报**，只有悬停/选中才解码 atlas，避免打开设置页一次解 40 张。
- `composer` 默认 `always`：输入区通常只有 1 个模型标签，最多 2–3 个 placement，代价可接受。
- 同一张 atlas 被多处引用时由浏览器图片缓存按 data URL 去重，不额外解码。

---

## 5. 采样导演台（交互定义）

### 5.1 设计原则

1. **最终裁决看真尺寸**：大预览只是取景参考，20 / 22 / 36 / 64px 的预览才是真相。
2. **一个界面里完成"选素材 → 选片段 → 选帧数 → 看体积 → 保存"**，不弹二级对话框。
3. **任何自动调整都必须可见**：自动瘦身会说清楚改了什么，并且能撤销。
4. **动图与视频同构**：内部统一成"一段时间轴 + 可定位的帧"，用户不需要知道文件是 GIF 还是 MP4。

### 5.2 布局

宽屏（编辑器弹窗加宽到 760px）：

```
┌ 新建自定义图标 ─────────────────────────────────────────── [×] ┐
│ 类型 [静态图片] [● 动态]            名称 [ 我的本地模型      ] │
├──────────────────────────────────┬───────────────────────────┤
│  监视器          [成品 | 原片]    │  取景                      │
│  ┌────────────────────────────┐  │  ┌─────────────────────┐  │
│  │                            │  │  │     1:1 裁剪框       │  │
│  │      循环播放 / 当前帧      │  │  │        ▣            │  │
│  └────────────────────────────┘  │  └─────────────────────┘  │
│  ▶  ⏮ ⏭   0.80s / 2.00s          │  缩放 ─────●──────   [居中]│
│  实际尺寸  [20] [22] [36] [64]    │  裁剪应用到全部 24 帧      │
├──────────────────────────────────┴───────────────────────────┤
│  素材  00:00 ───────────────────────────────────── 00:02.0   │
│  ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐          │
│  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │          │
│  └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘          │
│  [├──── 入 0.20s ───────●────────── 出 1.80s ──────┤]        │
│  采样  ▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣   (24 帧 · 12fps)          │
├──────────────────────────────────────────────────────────────┤
│  体积 ████████░░░░ 64KB / 128KB     预计 24 帧 · 12fps       │
│                                    [取消]   [保存图标]        │
└──────────────────────────────────────────────────────────────┘
```

窄屏（< 640px）：单列，顺序为 监视器 → 时间轴（吸底）→ 取景/采样控件；采样条横向滚动。

### 5.3 状态机

```
idle ──选文件──▶ reading ──探测成功──▶ ready
                     └──失败──▶ failed（可重选）
ready ──拖动播放头/区间──▶ ready（静帧重算，防抖 60ms）
ready ──改帧数/区间──▶ sampling ──▶ ready(已编码)
ready ──点保存──▶ saving ──▶ done
任何状态 ──致命错误──▶ failed（错误行 + 重试）
```

`ready` 里持有：`probe {kind, durationMs, width, height, frameCount?}`、`range {inMs, outMs}`、`frames`、`crop {x, y, zoom}`（work 坐标）、`encoded {atlas, poster, bytes, quality, framePx}`。

### 5.4 交互细则

**导入**

- 点击、拖入、`Ctrl/⌘+V` 粘贴；接受 PNG / JPEG / WebP / GIF / APNG / AVIF / MP4 / WebM。
- 判定顺序：`type` 以 `video/` 开头 → 视频；否则交给 `ImageDecoder` 探测帧数，> 1 为动图，= 1 提示"这张图只有一帧，请用静态图片"。
- 超限直接报错：动图 24 MB、视频 64 MB（文案写清楚各自上限）。
- 读入后自动：区间 = `[0, min(时长, 2000ms)]`；帧数 = `clamp(round(区间秒数 × 12), 4, 24)`；裁剪默认居中最大正方形。
- 视频自动静音；解码失败（HEVC、DRM、损坏）给出可操作提示："换成 H.264 的 MP4 或 GIF/WebP"。

**时间轴（素材条）**

- 全宽显示整段素材；缩略图最多 16 张，按时间均匀取。
- 播放头：单击定位；播放时行走；`⏮/⏭` 跳入点/出点。
- 入 / 出手柄：拖动改变区间；拖区间中段整体平移；双击手柄复位到 0 / 末尾。
- 区间长度硬上限 2000ms：拖过界时另一侧手柄被推着走，`aria-live` 提示"片段最长 2 秒"。
- 手柄是 `role="slider"`：`←/→` ±20ms，`Shift+←/→` ±100ms，`Home/End` 到素材两端。

**取景**

- 1:1 裁剪框（复用 `react-easy-crop`），底图是**当前播放头的静帧**；拖动播放头时静帧跟着更新（防抖）。
- 缩放 1–3 倍；`居中` 一键把裁剪框复位到中心最大正方形。
- 文案明确："裁剪应用到全部 N 帧"——裁剪是静态几何，不是逐帧跟踪。

**采样**

- 帧数滑杆 4–24；旁边只读显示有效帧率（`frames / 区间秒数`），低于 4fps 时提示"动作会偏跳"。
- 采样条：N 张裁剪后的样片（44px），当前帧高亮；点某张把播放头定位到对应时间。
- 修改区间/帧数后防抖 150ms 重新采样；新结果就绪前保留旧样片，界面不闪空。
- 采样中显示进度（"正在解码第 12/24 帧…"），可取消。

**监视器**

- 默认"成品"：按 `frames/fps` 循环播放最终会存进去的内容（canvas 逐帧绘制）。
- 可切"原片"：看原始时序，用来判断区间选得对不对。
- `空格` 播放/暂停；`←/→` 逐帧；`⏮/⏭` 到区间端点。
- `prefers-reduced-motion` 下默认暂停，保留播放按钮。

**真尺寸预览**

- 20 / 22 / 36 / 64 四个 tile，直接渲染线上同款 mark 字符串（不是 canvas 缩放），保证圆角、裁切、SMIL 与实际一致。

**体积与自动瘦身**

- 实时估算（防抖 200ms）：atlas 体积、海报体积、合计 / 预算条；> 80% 变黄，超限变红。
- 超限时出现"自动瘦身"，顺序固定：**质量 → 帧数 → 边长**：
  1. 质量：0.92 → 0.82 → 0.72 → 0.62 → 0.52；
  2. 帧数：每次 −2，最低 4（时长不变，等效帧率重算）；
  3. 边长：128 → 112 → 96。
- 每降一档用一行文字说明（如"已从 24 帧降到 16 帧以适配体积"），`aria-live="polite"`；提供"恢复我的设置"撤销。
- 保存按钮在超限时禁用，hover 提示原因。

**保存**

- 一次 `configForms.mutate` 写入 `customIcons.<id>`（含 `image` + `motion`）以及当前模型的 override（沿用现有"创建即应用"行为）。
- 写入中禁用表单；失败沿用现有错误行，不关闭弹窗。

### 5.5 键盘与无障碍

- 表单顺序：类型 → 名称 → 取景 → 时间轴 → 采样 → 保存。
- 所有滑杆是原生 `<input type="range">`，带 `aria-label` 与 `aria-valuetext`（"12 帧，约 6 帧每秒"）。
- 时间轴手柄 `role="slider"` + 方向键；`I` / `O` 在播放头设入点/出点。
- 自动瘦身、区间超限、解码进度都用 `aria-live` 播报。
- 焦点环沿用现有 token；弹窗的焦点陷阱仍由 picker 负责。

### 5.6 空态、错态、加载态

| 场景               | 呈现                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| 未选文件           | 大号 dropzone："拖入动图或视频，或点击选择"；下方一行限制说明                                            |
| 读取中             | 进度行 + 取消；超过 400ms 才出现，避免闪烁                                                               |
| 只有一帧           | 提示改用静态图片，附"切换"按钮                                                                           |
| 解码失败           | 错误行 + "换一个文件"；说明具体原因（编码不支持 / 文件损坏）                                             |
| 没有可采样帧       | 错误行；保存禁用                                                                                         |
| 编码超预算         | 体积条变红 + 自动瘦身按钮 + 保存禁用                                                                     |
| 总预算不足         | 错误行："自定义图标总容量已满，请删除一些图标"，附跳转到选择器的动作                                     |
| 重命名一个动态图标 | 只显示名称与删除区，并提示"动态图标不支持重新采样，需要调整请新建"——原始素材没有留在设置里，无法二次编辑 |

### 5.7 已定的取舍

- **不做运镜跟踪**（逐帧跟随主体）：图标是静态裁剪，跟踪会让背景漂移，且实现成本高。列为后续可选。
- **不做时间轴缩放**：2 秒上限内，16 张缩略图足够定位。
- **不做音频**：图标没有声音；视频一律静音采样。
- **取景用静帧而不是实时视频**：裁剪对全部帧生效，静帧 + 播放头已经能表达；换来实现简单、无额外解码开销。
- **不把动态做成第三个 tab**：动图与视频共用"动态"，减少一次用户判断。

---

## 6. 采样与编码算法

### 6.1 采样时刻（纯函数，`src/motion.ts`）

```
N = frames, [a, b] = 区间（毫秒）
t_i = a + i * (b - a) / N          (i = 0 … N-1)
fps = N / ((b - a) / 1000)         （保留两位小数，钳制到 0.5–30）
```

- 取左闭右开，避免首尾帧重复（循环播放时首尾同帧会"顿一下"）。
- 动图按时间戳找最近的源帧（`ImageDecoder` 的逐帧时长），相邻重复帧去重并在 UI 提示"有效帧 22/24"。
- 视频按时间 seek + `requestVideoFrameCallback`；同样去重。

### 6.2 解码与工作分辨率

- 动图：`file.arrayBuffer() → new ImageDecoder({data, type})`；逐帧 `decode()` 后画到 work canvas。
- 视频：`URL.createObjectURL(file) → <video muted playsinline>`；seek 到每个采样时刻、等 `seeked` 事件后 `drawImage` 到 work canvas（播放预览用 `requestVideoFrameCallback` 对齐）。
- **work canvas 长边 ≤ 1024**：既控内存（4K 视频不按原尺寸解），又让裁剪坐标只在一个坐标系里表达；烘焙时从同一张 work canvas 取像素，不需要坐标换算。
- 动图源帧数 > 1200 或解码超过 15s 时中止并提示"这段动图太长，建议先剪短"。

### 6.3 拼图与编码

- 每帧按裁剪矩形 `drawImage` 到 `framePx × framePx`，依次画进 `frames*framePx × framePx` 的 atlas canvas。
- 编码优先级：`image/webp`（支持 alpha，体积最小）→ 失败或浏览器不支持时 `image/png`。
- 海报：第 0 帧单独编码 128×128，质量 0.8，超 32 KiB 再降质量。
- atlas 的 `href` 仍是 PNG/WebP data URL，**不新增 MIME**，host schema 的图片正则不动。

### 6.4 预算裁决（纯函数给出顺序，浏览器层执行）

```
for q in [0.92, 0.82, 0.72, 0.62, 0.52]:
    encode(atlas, q) → fits? return
for n from frames-2 down to 4 step 2:
    resample(n) → encode(q=0.72) → fits? return     # 帧数/边长阶段固定用折中质量
for px in [128, 112, 96]:
    re-render at px → encode(q=0.72) → fits? return
throw TooBig
```

每次降档都返回 `{changed: 'quality'|'frames'|'size', from, to}`，由 UI 呈现并允许撤销。

### 6.5 可单测的纯函数

```ts
dshmlSampleTimes(rangeMs, count): number[]
dshmlEffectiveFps(rangeMs, count): number
dshmlInitialFrameCount(rangeMs): number
dshmlSpriteLayout(frames, frameWidth): { width, height }
dshmlAtlasSvg(icon, options): string
dshmlPosterSvg(icon): string
dshmlNormalizeMotion(raw): CustomIconMotion | null   // 解析期校验
dshmlBudgetPlan(atlasChars, posterChars): 'ok' | 'warn' | 'over'   // 单位是 data URL 字符数
```

---

## 7. 代码改动清单

### 7.1 新增

| 文件                                         | 内容                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/motion.ts`                              | 采样/布局/预算/校验纯函数，常量表                                                 |
| `src/media-source.ts`                        | 素材探测与逐帧读取：`ImageDecoder` 路径 + `<video>` 路径，统一 `frameAt(ms)` 接口 |
| `src/sprite.ts`                              | atlas / 海报编码与自动瘦身阶梯（浏览器 API）                                      |
| `src/motion-studio.ts`                       | 导演台 React 组件（布局、时间轴、采样条、监视器、预算条）                         |
| `src/playable-mark.ts`                       | `DshmlPlayableMark` 组件 + `dshmlAttachPlayableMark` DOM 助手                     |
| `test/motion.test.ts`                        | 纯函数与 SVG 生成                                                                 |
| `test/fixtures/motion.gif.ts` 或 base64 常量 | DOM 门禁用的 4 帧小动图                                                           |

### 7.2 修改

| 文件                         | 改动                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/types.ts`               | `CustomIconMotion`、`CustomIcon.motion`、`ModelMark.animatedSvg`、`DshmlPlayback*`                    |
| `src/custom-icons.ts`        | `motion` 解析/校验、`dshmlPosterSvg` / `dshmlAtlasSvg`、预算常量、`dshmlCreateCustomIcon` 支持 motion |
| `src/custom-icon-editor.ts`  | 两档 tab；静态分支不变；动态分支挂 `DshmlMotionStudio`；保存时合并 payload；重命名模式不显示类型切换  |
| `src/picker.ts`              | 创建模式弹窗加宽（`dshml-picker-dialog-wide`）；单元格使用 `DshmlPlayableMark`                        |
| `src/section.ts`             | 新增"动态图标播放"设置组（4 行三选一）                                                                |
| `src/overrides.ts`           | icon store 增加 `playback`；`dshmlSetPlayback`；创建接口加 motion 参数；mark 解析带 `animatedSvg`     |
| `src/client.ts`              | 输入区标签改用播放策略                                                                                |
| `src/decorate.ts`            | 设置行/下拉使用 `dshmlAttachPlayableMark`                                                             |
| `src/host.ts`                | Config 增加 `motion` 子对象与 `playback` 字段                                                         |
| `src/ui-css.ts`              | 导演台样式、时间轴、采样条、播放设置组、加宽弹窗                                                      |
| `src/i18n.ts`                | 新增约 34 个键（zh/en 同步）                                                                          |
| `test/custom-icons.test.ts`  | motion 校验、SVG 快照、降级用例                                                                       |
| `test/client.test.ts`        | 播放策略与 mark 选择                                                                                  |
| `scripts/verify-dom.ts`      | 动图创建全流程断言（见 §9）                                                                           |
| `README.md` / `README.zh.md` | 自定义图标章节、播放设置、限制                                                                        |
| `docs/engineering.md`        | 模块表新增 4 个文件                                                                                   |
| `docs/architecture.md`       | 自定义图标持久化与渲染契约                                                                            |

### 7.3 不改

- `kind` 枚举、现有静态图标的编码路径、`custom:<id>` 引用方式、设置命名空间、图片正则。
- 不加依赖，不改 `pnpm-lock.yaml`。
- 不引入宿主路由 / 文件存储（方案 C 不在本期）。

---

## 8. 文案与视觉

- 文案口径：中文"动图"与"视频"在界面里统一叫**动态**；错误文案给动作（"换成 H.264 的 MP4"），不甩技术错误。
- 视觉沿用现有 token（`--dsw-alias-*`、`--dsw-radius-*`），不新增颜色；体积条用现有 warn/error 语义色。
- 新增预览图：`docs/preview-motion-studio.png`（导演台）、`docs/preview-playback-settings.png`（播放设置组），由 `pnpm run preview` 与 `verify-dom --screenshot` 产出；同步登记到 `screenshots.json`。

---

## 9. 测试与门禁

### 9.1 单元测试

- 采样时刻：N=4/24、区间 0.12s/2s、边界不重复、fps 钳制。
- 初始帧数：0.2s → 4，1.5s → 18，2s → 24，超长 → 24。
- atlas 布局：24×128 → 3072×128；`frames*frameWidth ≤ 4096`。
- `motion` 校验：缺字段、帧数 1、fps NaN、atlas 非 data URL、超长 → 全部只丢 motion。
- 降级：有 motion 的图标在解析后 `image` 仍可渲染；损坏 atlas 后 `animatedSvg` 为 undefined。
- SVG：`values` 长度 = frames、`dur` 正确、XML 转义、无 `<script>`/`on*`/外链。
- 预算：三种裁决路径与"不静默降级"的返回值。

### 9.2 打包/DOM 测试

`pnpm run verify:dom` 新增一段动图流程（沿用现在的 fake `configForms`）：

1. 打开创建器 → 断言只有"静态图片 / 动态"两个 tab，且"动态"可点。
2. 用内置 4 帧 GIF data URL 填 file input → 断言时间轴、采样条、真尺寸预览出现。
3. 拖动帧数滑杆 → 断言体积数字变化、保存按钮可用。
4. 保存 → 断言 `mutate` 写入 `customIcons.<id>.motion.atlas` 且 `frames/fps/frameWidth` 自洽。
5. 选择器单元格初始只有海报（无 `<animate`）；派发 `pointerenter` 后 innerHTML 换成含 `<animate` 的 atlas mark，`pointerleave` 后换回。
6. 播放设置组：把 `settings` 改为"始终播放" → 设置行不悬停也含 `<animate`；改为"关闭" → 悬停后仍不含。

视频路径不做 DOM 断言（headless 视频解码不稳），用 `test/motion.test.ts` 覆盖时间计算 + 手动验收清单。

### 9.3 手动验收

- 2 秒 720p MP4、30 帧 GIF、APNG、动态 WebP、动态 AVIF 各导入一次，确认采样、体积、最终渲染。
- 深色主题、窄屏（600px）、键盘全流程、reduced-motion 下不自动播放。
- 40 个图标的设置页打开耗时与内存（任务管理器抽样）。

### 9.4 门禁

```bash
pnpm run verify
EDGE=$(command -v google-chrome) pnpm run verify:dom            # 本机没有 msedge，用 Chrome 等价
pnpm run preview                                                 # CSS/预览图变化
pnpm run verify:live                                             # client.js 变化且 GUI 在跑时
```

> 环境备注：`scripts/verify-dom.ts` 的 `findEdge()` 只认 Windows 路径和 `EDGE` 环境变量；本机通过 `EDGE=$(command -v google-chrome)` 运行。若顺手，另开一个 `chore:` 提交让它也识别 Linux 的 `google-chrome/chromium`，但这不是本功能的必需项。

---

## 10. 提交拆分

| #   | 提交                                           | 内容                                            |
| --- | ---------------------------------------------- | ----------------------------------------------- |
| 1   | `feat: persist motion icons as sprite atlases` | 类型、解析/校验、mark SVG、纯函数、单测         |
| 2   | `feat: add the motion sampling studio`         | 导演台 UI + 动图解码 + 编码阶梯 + 静态/动态 tab |
| 3   | `feat: sample videos into motion icons`        | `<video>` 源、传输控件、错误态                  |
| 4   | `feat: configure motion playback per surface`  | `playback` 配置、分面渲染、播放设置组           |
| 5   | `docs: document motion custom icons`           | README/架构/工程文档 + 预览图                   |

每个提交都跑 `pnpm run verify`；2–4 额外跑 `verify:dom`；5 额外跑 `preview`。

---

## 11. 风险与回滚

| 风险                                 | 影响             | 对策                                                                                             |
| ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------ |
| SMIL 未来被移除                      | 动图不动         | 已隔离在 `dshmlAtlasSvg` 一个函数里，可换成 CSS `steps()`（全局 keyframes 需唯一命名）或改存 GIF |
| `ImageDecoder` 不可用（非 Chromium） | 动态入口不可用   | 启动时特性检测，隐藏入口并给提示；静态路径不受影响                                               |
| 长 GIF 解码卡顿 / OOM                | 编辑器无响应     | 源帧数 ≤1200、解码超时 15s、进度与取消                                                           |
| atlas 内存（40 个同时解）            | 设置页内存尖峰   | 列表只用海报，hover 才解 atlas                                                                   |
| 设置文档变大                         | 每次设置写入变慢 | 单图标 128 KiB + 总量 3 MiB 预算，写入前检查                                                     |
| 自动瘦身静默改变用户选择             | 结果与预期不符   | 强制显示变更说明 + 撤销                                                                          |
| 视频编码不支持                       | 导入失败         | 明确错误 + 建议格式；不假装成功                                                                  |
| WebP 编码器跨平台差异                | 体积估算偏差     | 以运行时真实编码结果为准，阶梯在浏览器里跑                                                       |

回滚：功能是纯加法；若上线后发现渲染问题，可只回退"动态"入口（隐藏 tab），已存数据退回首帧，不影响旧功能。

---

## 12. 待你确认

1. **播放策略的分面数量**：我用了 4 个（输入框 / 设置-模型 / 模型图标页 / 图标选择器）。选择器要不要独立，还是跟随"模型图标页"？（我倾向独立，默认 `hover`。）
2. **总预算 3 MiB** 是否接受？按 40 个图标、平均 60 KB 估算，一般用户远用不到；上限主要是保护设置文件的写入与 describe 往返。
3. **降级行为**：旧版本打开新数据会显示首帧（不播），旧版改名可能丢掉 `motion`（图标退回首帧）。可接受吗？如果需要"绝不丢"，就得把动画写进独立顶层字典，代价是旧版 schema 直接报错——我认为不划算。
