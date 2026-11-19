# 动图导演台 · 拖动时间轴后的 UI 卡顿优化计划

> 状态：**待审阅**（未开始实现）
> 目标版本：`0.8.0`（版本号在发布提交里再定；若评审只保留内部优化也可切 `0.7.1`）
> 范围：只处理"拖动时间轴 → 松手后 UI 卡住一小段"这一条。不改采样算法、存储格式（atlas 仍是设置文档里的 data URL）、既有视觉与交互（A3 例外，见开放问题 Q2）
> 关联文档：[架构](../docs/architecture.md) · [工程约定](../docs/engineering.md) · [README（中文）](../README.zh.md)
> 调研数据：2026-11-19，用 `scripts/verify-dom.ts` 的 motion harness + CDP 探针在本地 headless Chromium 实测（环境与口径见第 4 节）

---

## 0. 一页摘要

- **根因**：拖动时间轴时每个 `pointermove` 只更新 React state，不采样；采样与"原片"仍图都由 `useEffect + setTimeout` 防抖，**指针一停，两段重活就先后落到主线程**：
  1. `+60ms`：把当前播放头帧按工作画布尺寸（≤1024×1024）重新 `toDataURL('image/webp')` 成裁剪器的 still，且**不看当前视图**——在"成品"视图下拉时间轴也会算；
  2. `+150ms`：按新采样窗完整重采样，在最后一个 `await` 之后同步做 46 次 `getImageData` 去重 → 合成最大 `24×128 = 3072×128` atlas → `toDataURL` WebP → poster 编码 → 整套 React 重渲染（4 个真尺寸 SVG tile 内嵌 ~100KB atlas、最多 24 个采样格各带 `url(atlas)`）。
- **优化主线**：把重活从拖动过程中彻底挪走 + 把主线程编码改成异步/按需：
  - **A1（P0）** 拖动期间不启动采样（`drag !== null` 直接早退），松手后才起防抖；
  - **A2（P0）** 成品视图不生成 still；原片视图的 still 改 `canvas.toBlob` + object URL（编码移出主线程）；
  - **B1（P1）** atlas / poster 的 WebP 编码改 `toBlob` → `FileReader` data URL；
  - **C1–C4（P1）** 渲染去抖：tile SVG 只算一次、atlas 图片只解一次、采样进度节流、strip 的 atlas URL 合并成一份；
  - **D1/D2（P1/P2）** 去重扫描 2(N−1)→N 次 read、给 128px 帧画布加 `willReadFrequently`；
  - **A3（P1，需拍板）** 拖动时间轴时先暂停播放；
  - **B2 / D3（P2）** 仅当真机复测仍不够时才上 Worker + OffscreenCanvas、视频 seek 批量化。
- **预期效果**（本机 harness，1024×1024 / 24 帧 GIF）：松手后 ≥50ms 长任务 **2 条（63ms + 53ms）→ 0 条**；拖动期间编码次数 **0**；一次拖拽最多 1 轮采样（基线在"按住停顿 420ms"时是 2 轮）。
- **已知约束**：零新增运行时依赖（OffscreenCanvas / Worker / `toBlob` 均为浏览器内置）；每步都要过 `pnpm run verify`，改 `src/test/scripts` 的步骤还要过 `pnpm run verify:dom`；改 CSS 要过 `pnpm run preview`。

---

## 1. 问题与实测证据

### 1.1 触发链（现状代码）

1. `pointerdown` → `startDrag`（[`src/motion-studio.ts:1696`](../src/motion-studio.ts#L1696-L1701)）；`pointermove` 在 window 上由 effect 接管（[`src/motion-studio.ts:1532`](../src/motion-studio.ts#L1532-L1578)），每次只 `setRange` / `setPlayhead`（[`src/motion-studio.ts:1542`](../src/motion-studio.ts#L1542-L1563)）。**拖动过程中没有采样**，这是设计好的防抖。
2. **still 防抖**：`refreshStillOnPlayhead` 在 `playhead` 变化后 60ms 把播放头帧画进工作画布，再 `work.toDataURL('image/webp', 0.84)`（[`src/motion-studio.ts:1371`](../src/motion-studio.ts#L1371-L1383)、[`src/motion-studio.ts:1270`](../src/motion-studio.ts#L1270-L1281)、[`src/motion-studio.ts:244`](../src/motion-studio.ts#L244-L246)）。工作画布长边 ≤1024（[`src/motion.ts:69`](../src/motion.ts#L69)、[`src/media-source.ts:213`](../src/media-source.ts#L213-L218)）。**effect 没有 `view` 依赖**。
3. **采样防抖**：`sample` effect 在 `currentKey`（含 range）变化时立即 `setSampling(true)` 并挂 150ms 定时器（[`src/motion-studio.ts:1386`](../src/motion-studio.ts#L1386-L1433)、[`src/motion-studio.ts:1427`](../src/motion-studio.ts#L1427)），到点后 `dshmlEncodeMotionIcon`：
   - `range` 一变，crop 缓存键就变（[`src/sprite.ts:244`](../src/sprite.ts#L244-L246)），compose → encode 两层必然 miss；
   - 最后一个帧 `await` 之后，**同一个 continuation** 里同步执行：相邻帧去重（24 帧 = 46 次 `getImageData`，[`src/sprite.ts:388`](../src/sprite.ts#L388-L413)）→ 合成 atlas（[`src/sprite.ts:312`](../src/sprite.ts#L312-L327)）→ `canvas.toDataURL('image/webp')`（[`src/sprite.ts:344`](../src/sprite.ts#L344-L349)）→ poster 编码（[`src/sprite.ts:364`](../src/sprite.ts#L364-L376)）；
   - 返回后 `setEncoded` 触发重渲染：真尺寸 tiles 每次 render 重拼内嵌 ~100KB atlas 的 SVG（`escapeXml` 扫整条 data URL，[`src/motion.ts:365`](../src/motion.ts#L365-L388)、[`src/artwork.ts:83`](../src/artwork.ts#L83-L88)、[`src/motion-studio.ts:922`](../src/motion-studio.ts#L922-L957)）；最多 24 个采样格各拼一份 `url(<atlas>)`（[`src/motion-studio.ts:865`](../src/motion-studio.ts#L865)）；舞台还要 `new Image()` 解码整条 atlas（[`src/motion-studio.ts:1473`](../src/motion-studio.ts#L1473-L1493)）；采样中每帧 `setProgress` 让整个 studio 再渲染一次（[`src/motion-studio.ts:1406`](../src/motion-studio.ts#L1406-L1408)）。
4. 默认 2s 素材初始化就是 24 帧（`round(秒 × 12)`，[`src/motion.ts:302`](../src/motion.ts#L302-L307)、[`src/motion.ts:51`](../src/motion.ts#L51)、[`src/motion.ts:24`](../src/motion.ts#L24)），而拖 range 不会自动降帧数——所以每次拖动都在编码最大宽度的 atlas。
5. 视频路径还有一层：`frameKeyAt` 按 10ms 桶（[`src/media-source.ts:483`](../src/media-source.ts#L483-L488)），时间窗一挪几乎全 miss，`drawFrame` 是单链串行 seek（[`src/media-source.ts:447`](../src/media-source.ts#L447-L469)、[`src/media-source.ts:476`](../src/media-source.ts#L476-L482)），每次拖动最多 24 次 seek；still 再 seek 一次。

### 1.2 实测基线（本机 harness，数字只用于量级与前后对比）

| 手势 / 素材                                  | 松手后 ≥50ms 长任务                 | 同步编码                                                              | 其它                               |
| -------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| 439×390 docs 示例 GIF，拖入点                | 无                                  | still 12.2ms；atlas 28.7ms；poster 1.5ms                              | 46 次 read ≈2.6ms                  |
| 1024×1024 / 24 帧 GIF，拖入点（成品视图）    | **63ms（still）+ 53ms（采样收尾）** | still 59.6ms（`1024×1024`）；atlas 23.5ms（`3072×128`）；poster 0.9ms | 46 次 read；松手 +296ms 才出 atlas |
| 同素材，原片视图（挂 Cropper）               | 61ms + 采样收尾                     | still 58.5ms；atlas 20.5ms                                            | Cropper 换图没有额外长任务         |
| 仅拖播放头（6s / 1024×1024 GIF，range 不变） | **58ms**                            | still 54.1ms                                                          | 即使成品视图也整帧编码             |
| 平移采样窗（6s GIF 0–2s → 1.2–3.2s）         | 58ms（still）                       | still 54.1ms；atlas 29.8ms                                            | 采样墙钟 ≈450ms（GIF 逐帧 decode） |
| 按住拖到一半**停 420ms** 再继续              | **61ms + 62ms 两轮完整周期**        | 6 次 `toDataURL`（2×still、2×atlas、2×poster）                        | 92 次 read                         |
| 640×640 MP4 2s，拖入点                       | 无                                  | still 14.1ms；atlas 20.7ms                                            | 采样墙钟 ≈500ms（24 次串行 seek）  |

长任务出现时间都精确落在松手后 +50ms（still）与 +250ms 附近（采样收尾），和两个防抖定时器吻合。

### 1.3 为什么体感是"拖动之后"而不是"拖动之中"

两个定时器在每个 `pointermove` 上都会被清掉重排；指针一直在动时不会到点，所以工作被**推迟到松手**。代价是松手瞬间集中爆发，且两段相隔约 90–150ms，用户感知为连续两次卡顿。反过来，**按住不动 ≥150ms** 会让采样在拖动中途就启动（实测一次拖拽出现两轮完整编码）——防抖只是"推迟"，不是"拖动期间禁止"。

### 1.4 真实机器上的放大因素

- Canvas2D 在 Windows/Edge 上通常由 GPU 合成；`toDataURL` / `getImageData` 需要 GPU→CPU 回读，代码里没有任何 `willReadFrequently`。本机是软件光栅，46 次 read 只要 3–9ms，真机可能贵一个数量级。
- WebP 编码本身是 CPU 工作，1MP 的 still 与 `3072×128` 的 atlas 在慢一些的机器上会明显超过本机数字。
- 拖动/采样期间大量 ~100KB 的 data URL 字符串参与构建、比较与 GC，机器越慢越容易被放大。
- 视频素材的"卡"更多来自 async seek 排队（墙钟拉长），不是单个主线程长任务；两者在体感上混在一起。

---

## 2. 目标与非目标

### 2.1 目标（可验证）

1. **拖动期间（pointerdown → pointerup）不产生采样编码**：没有 atlas / poster 的 `toDataURL` / `toBlob`；成品视图下也没有整帧 still 编码（原片视图允许 still 的 `toBlob`，但不挡主线程）。
2. **松手后每类工作最多一轮**：一次拖拽最多触发 1 次采样 run、1 次 still 生成；不再出现"停一下 → 跑一轮 → 松手又跑一轮"。
3. **主线程长任务消失**：本机 harness 上，1024×1024 / 24 帧 GIF 松手后 ≥50ms 长任务从 2 条降到 0 条；439×390 示例保持 0 条；拖动期间 `requestAnimationFrame` 最大间隔 ≤33ms。
4. **成品视图不再为不可见的 still 付费**；原片视图仍能随播放头更新（异步编码，不挡主线程）。
5. **功能与结果不变**：采样帧/atlas/海报的像素与 data URL 语义不变（编码方式变，质量参数不变）；crop、播放、体积预算、自动瘦身路径不变。

### 2.2 非目标

- 不改采样上限（2s / 24 帧 / 128px）、存储格式、设置文档形状、播放策略。
- 不引入新的运行时依赖；不使用第三方 canvas/worker 库。
- 不改 `DshmlMediaSource` 的 `drawFrame` / `frameKeyAt` 接口（视频 seek 优化另议，见 D3）。
- 不做"拖动中实时预览降级"（例如拖动中只画低清 atlas）——先看 A1/A2/B1 是否足够。
- 不改静态图片裁剪器的行为。

---

## 3. 优化方案（按优先级）

> 每项的"验收"都是结构性的（编码次数 / 走哪个 API / 是否在拖动窗口内），不把绝对毫秒数写进自动门禁；毫秒数只在第 4 节的手工基准里跟踪。

### A. 触发时机

#### A1（P0）拖动期间不启动采样

- **现状**：`sample` effect 在 `currentKey` 一变就 `setSampling(true)` + 150ms 定时器；按住停顿 ≥150ms 会中途启动整轮采样，继续拖会再来一轮。
- **改法**：effect 顶部加 `if (drag !== null) return;`，并把 `drag` 加进依赖数组（`drag` 是现有 state，`up` 时 `setDrag(null)`）。拖动中每次 `currentKey` 变化只做一次早退；松手后 effect 重跑，恢复现有 150ms 防抖。同时拖动中不会再出现 `setSampling(true)` 的假"正在采样"状态。
- **补一个竞态**：`startDrag`（[`src/motion-studio.ts:1696`](../src/motion-studio.ts#L1696-L1701)）里递增 `encodeGeneration.current`（沿用 `cancelWork` 的取消语义，但不必清状态），防止"松手后刚启动、立刻又抓住时间轴"时上一轮的收尾仍在这个新拖动中途 `setEncoded` 并触发重渲染。
- **保持不动**：帧数滑杆、裁剪框拖动、键盘 `i/o/箭头`（这些场景 `drag === null`）继续走原防抖；`cancelWork` / `encodeGeneration` 的其余逻辑不改。
- **风险**：低。
- **验收**：DOM 门禁中合成一次 `pointerdown → 24 次 pointermove → 按住等待 300ms`：期间没有采样编码（atlas / poster 尺寸的画布），成品视图下也没有整帧 still 编码；`pointerup` 后 500ms 内断言出现一次采样编码。

#### A2（P0）still 只在原片视图生成，并改异步 `toBlob`

- **现状**：`refreshStillOnPlayhead` 不看 `view`；`refreshStill` 每次都新建工作画布并 `toDataURL`。
- **改法**：
  1. effect 增加 `view !== 'source'` 早退，`view` 进依赖；切到"原片"时 effect 重跑自然补一次 still。
  2. `refreshStill` 复用一块缓存的 work canvas（ref），用 `canvas.toBlob('image/webp', 0.84)` → `URL.createObjectURL(blob)` 代替 `toDataURL`，把 WebP 编码移出主线程。
  3. state 从 `stillUrl: string` 继续用（存 object URL 即可）；替换时与组件卸载/换素材时 `revokeObjectURL`；保留 `stillGeneration` 丢弃过期回调。
  4. `toBlob` 不可用时回退 `toDataURL`（测试替身/旧引擎路径），行为与今天一致。
- **注意**：Cropper 的 `image` 接受 object URL；分辨率保持工作画布尺寸，**不改变** `onCropComplete` 的像素坐标系与 `dshmlCropRect` 的换算，避免重蹈"crop 形状"那类回归。
- **风险**：中低（object URL 生命周期与竞态）。回滚点集中在这一个函数。
- **验收**：成品视图下拖动 → 整帧编码（`toBlob`/`toDataURL`，画布尺寸 = 工作画布）计数为 0；切到原片后 playhead 变化 → 出现 1 次 `toBlob`（尺寸记录正确），主线程无 ≥50ms 长任务。

#### A3（P1，需评审拍板）拖动时间轴时暂停播放

- **现状**：`startDrag` 不暂停播放；播放中拖 range 会让 `loopBaked` effect 因 `range.inMs/outMs` 变化在**每个 pointermove** 上重建（每次 `new Image()` 解码整条 atlas + 重启 rAF，[`src/motion-studio.ts:1495`](../src/motion-studio.ts#L1495-L1530)），rAF 每 80ms 还会写回 playhead，与拖动写 playhead 互相拉扯。
- **改法**：`startDrag` 里 `setPlaying(false)`；松手后是否恢复播放由 Q2 决定。
- **收益**：去掉拖动期间的 atlas 解码/rAF 重启与 playhead 竞争；也让 scrub 的落点可预期。
- **风险**：用户可见的行为变化，需要评审确认。
- **验收**：播放中按下时间轴后 `playing === false`；拖动期间 rAF 循环不重启；松手后状态符合 Q2 决定。

### B. 主线程编码

#### B1（P1）atlas / poster 编码异步化：`toBlob` → `FileReader` data URL

- **现状**：`dshmlEncodeCanvas` 是同步 `toDataURL`（[`src/sprite.ts:344`](../src/sprite.ts#L344-L349)），被 `dshmlEncodeAttempt`（[`src/sprite.ts:438`](../src/sprite.ts#L438-L459)）在最后一个 `await` 之后同步调用，是第二个长任务的主体。
- **改法**：
  1. 新增 `async function dshmlEncodeCanvasAsync(canvas, quality)`：优先 `canvas.toBlob('image/webp', quality)` → `FileReader.readAsDataURL(blob)`；若 `blob.type` 不是 webp，再按现有逻辑试 PNG；若没有 `toBlob`，回退同步 `toDataURL`。
  2. `DshmlEncodedChunk` 缓存仍存最终 data URL（缓存键不变）；`dshmlEncodeAttempt` / `dshmlEncodeMotionIcon` / `dshmlFitMotionBudget` 改为 async 并 await；调用方本来就是 async。
  3. 安全前提：缓存里的 atlas / poster canvas 生成后不会再被重绘（`dshmlComposeAtlas`、`dshmlRenderFrames` 都是新 canvas），异步编码期间内容稳定。
- **预期**：主线程只剩 compose（24 次 `drawImage`）+ 46 次 read + base64 字符串转换（异步）；本机 23–34ms 的 atlas 编码长任务消失。
- **风险**：中（API async 化；`test/sprite.test.ts` 的 fake canvas 需要补 `toBlob`/`FileReader`，并调整 encode 计数断言）。
- **验收**：`test/sprite.test.ts` 覆盖"每次变化 encode 0/1 次"的既有契约保持；新增断言：编码经 `toBlob`（fake 计数器），返回值仍是 data URL；DOM 门禁里松手后 `toDataURL` 计数为 0、`toBlob` 计数 ≥1。

#### B2（P2，按真机数据决定）Worker + OffscreenCanvas

- 仅当 B1 之后 Windows/Edge 上仍有可感卡顿：把 `dshmlRenderFrames` / `dshmlComposeAtlas` / WebP 编码搬进 Worker，帧以 `ImageBitmap`/`OffscreenCanvas` 传递。
- 改动大、测试面广，默认不做；真机复测数字（见 Q5）再决定。

### C. 渲染抖动

#### C1（P1）真尺寸 tiles：atlas SVG 只算一次

- **现状**：`DshmlMotionTiles` 每次 render 调 `dshmlAtlasSvg`（`escapeXml` 扫 100KB+ data URL，`dshmlNormalizeMotion` 再校验一次），同一字符串塞进 4 个 tile 的 `dangerouslySetInnerHTML`（[`src/motion-studio.ts:922`](../src/motion-studio.ts#L922-L957)）。
- **改法**：组件内 `React.useMemo(() => dshmlAtlasSvg(...), [props.encoded, props.reducedMotion])`；并用 `React.memo` 包住 `DshmlMotionTiles`（props 只有 `encoded` / `reducedMotion`，playhead/range 变化时整块跳过渲染）。
- **风险**：低；视觉不变。
- **验收**：Profiler 里拖动/采样期间不再出现 `escapeXml` / `dshmlNormalizeMotion` 的成片样本；DOM 门禁断言 4 个 tile 的 innerHTML 字符串一致且未随 playhead 变化重写（可选）。

#### C2（P1）strip：一份 atlas URL 走 CSS 变量

- **现状**：最多 24 个格子各自 `backgroundImage: 'url(' + atlas + ')'`（[`src/motion-studio.ts:865`](../src/motion-studio.ts#L865)），每次 render 拼 24 份 ~100KB 字符串并参与 style 比较。
- **改法**：在 `.dshml-motion-strip` 容器上设一次自定义属性（`--dshml-atlas: url(...)`、`--dshml-atlas-size: <frames×44 px> 44px`），格子只保留 `background-position`；CSS 在 [`src/ui-css.ts:1844`](../src/ui-css.ts#L1844-L1856) 用 `background-image: var(--dshml-atlas)` / `background-size: var(--dshml-atlas-size)`。
- **注意**：改了 CSS 触 Artwork/preview 门禁，视觉应像素级不变；若 `pnpm run preview` 刷新出差异，一并提交预览图。
- **风险**：低（CSS 兼容性由 Chromium 保证）。
- **验收**：DOM 门禁里采样格仍按帧显示正确缩略；Performance 中 style 比较成本下降（手工基准）。

#### C3（P1）播放头帧：atlas 图片只解码一次

- **现状**：`drawPausedFrame` / `loopBaked` 每次 playhead / range / encoded 变化都 `new Image()` + `src = atlas data URL`（[`src/motion-studio.ts:1473`](../src/motion-studio.ts#L1473-L1493)、[`src/motion-studio.ts:1495`](../src/motion-studio.ts#L1495-L1530)），scrub 期间反复解码。
- **改法**：组件里用 ref 缓存 `{ atlas, image }`；`encoded.atlas` 变化时只解码一次，`drawBaked` 直接复用；图片未就绪时跳到首帧/等 `load`。
- **风险**：低。
- **验收**：拖动期间 `HTMLImageElement` 的 atlas 解码次数从"每次 playhead 变化一次"降到"每次 encode 一次"（可在 DOM 门禁里 patch `Image` 计数）。

#### C4（P1）采样进度节流

- **现状**：`onProgress` 每帧 `setProgress`（[`src/motion-studio.ts:1406`](../src/motion-studio.ts#L1406-L1408)），24 帧 = 整套 studio 重渲染 24 次。
- **改法**：用 ref 记录上次更新时间，只在"首帧 / 每 100ms / 末帧"时 `setProgress`；文本仍连续可读。
- **风险**：低。
- **验收**：同一次 24 帧采样中 studio render 次数从 ~24 降到 ≤4（手工 Profiler 计数）。

### D. 微优化

#### D1（P1）去重扫描 2(N−1) → N 次 read

- **现状**：`dshmlDistinctFrames` 对每对相邻帧调两次 `dshmlFramesDiffer` 内部 `getImageData`（[`src/sprite.ts:388`](../src/sprite.ts#L388-L413)），24 帧 = 46 次读取、46 份 64KB 数组分配。
- **改法**：顺序遍历：先读第 0 帧，之后每帧只读一次、与上一份缓存比较。24 帧降到 24 次读取，分配减半。
- **风险**：低；比较逻辑不变（采样步长仍是每 7 像素）。
- **验收**：fake canvas 的 `getImageData` 计数断言 `N`（而不是 `2N−2`）；`distinctFrames` 结果与旧实现逐用例一致。

#### D2（P2）给 128px 帧画布加 `willReadFrequently`

- 在 `dshmlRenderFrames` 创建 128px 帧时 `getContext('2d', { willReadFrequently: true })`，让这批"只被读"的小画布走 CPU backing store，消掉 GPU 回读。
- atlas 画布是否也加要实测（compose 是 24 次 drawImage，CPU backing 可能让绘制变慢、但让 `toBlob` 回读变快）；本计划默认只给 128px 帧与去重读取加。
- **验收**：Windows/Edge 真机上 46/24 次 read 的总耗时下降；本机不受影响。

#### D3（P2，按真机数据决定）视频 seek 批量化

- A1 之后每次拖动只剩一轮采样，但视频仍要 24 次串行 seek（本机 2s / 640×640 MP4 ≈0.5s 墙钟，async 不挡主线程）。
- 可选：把 `frameKeyAt` 的 10ms 桶改成更粗/更贴近帧率的桶；或采样时先批量 seek；或对同一 range 复用首批 seek 结果。语义变化需要单独评审（Q6）。

---

## 4. 验收与测量

### 4.1 基线（本次调研数据，摘自第 1.2 节）

- 1024×1024 / 24 帧 GIF，拖入点：松手后 ≥50ms 长任务 2 条（63ms、53ms）；`toDataURL` 3 次（still 59.6ms / atlas 23.5ms / poster 0.9ms）；`getImageData` 46 次。
- 按住停顿 420ms：两轮完整编码，6 次 `toDataURL`，92 次 read。
- 439×390 docs GIF：无长任务；still 12.2ms / atlas 28.7ms。
- 环境：WSL2 + 本地 Chromium 154 headless（`--disable-gpu`，软件光栅）、React 18 dev UMD、960×940 视口、`scripts/verify-dom.ts` 的 motion harness；探针为 CDP 注入（patch `toDataURL` / `getImageData`、`PerformanceObserver('longtask')`、rAF 间隔、CPU profile）。真机（Windows/Edge）数字预期更高，但**结构性结论**（哪段同步代码在松手后跑）相同。

### 4.2 目标数字（本机 harness）

| 指标                                         | 基线               | 目标      |
| -------------------------------------------- | ------------------ | --------- |
| 拖动窗口内采样编码（atlas / poster）         | 采样各若干         | **0**     |
| 拖动窗口内成品视图的整帧 still 编码          | 每次 playhead 变化 | **0**     |
| 一次拖拽触发的采样 run                       | 1（停顿则 2）      | **≤1**    |
| 松手后 ≥50ms 长任务（1024×1024 / 24 帧 GIF） | 2 条（63 / 53ms）  | **0 条**  |
| 松手后 ≥50ms 长任务（439×390 示例 GIF）      | 0 条               | 0 条      |
| 拖动期间 rAF 最大间隔                        | 50ms（单次掉帧）   | **≤33ms** |
| 成品视图整帧 still 编码                      | 每次 playhead 变化 | **0**     |

### 4.3 门禁与新增断言

- 每个提交：`pnpm run verify`（typecheck、lint、fmt:check、unit/bundle、logo:check、rank:check、build、artifact freshness）。
- 改 `src/**`、`test/**`、`scripts/**` 或 bundle 的提交：额外 `pnpm run verify:dom`。
- 改 CSS 的提交（仅 C2）：额外 `pnpm run preview`，检查视觉是否像素级不变。
- 建议在 `scripts/verify-dom.ts` 的 motion 流程里新增**结构性断言**（不写死毫秒数）：
  1. 合成 `pointerdown → 多次 pointermove → 按住等待 300ms`：期间**采样编码**（atlas / poster 尺寸的画布）计数为 0；成品视图下整帧 still 编码也为 0；原片视图允许 still 的 `toBlob`，但不得出现 atlas 编码；
  2. `pointerup` 后 500ms 内：采样编码出现且只出现一轮（`toBlob`/`toDataURL` 计数按编码类型断言）；
  3. 成品视图拖动：整帧 still 编码计数为 0；切到"原片"后 playhead 变化：`toBlob` 出现且画布尺寸等于工作画布；
  4. 播放中按下时间轴（若采纳 A3）：播放按钮状态与 rAF 循环不再重启。
- `test/sprite.test.ts` 需要随 B1/D1 更新：
  - fake canvas 增加 `toBlob`（或注入可替换的编码器）与 `FileReader` 替身；
  - 断言 encode 次数契约不变（crop/edge/quality 各层仍只做该做的编码）；
  - 新增 `getImageData` 次数断言：24 帧为 24 次。

### 4.4 手工复测方法

- DevTools → Performance：录一次"按下-拖动-松开"，检查 `pointerup` 之后 0–400ms 是否还有长任务；展开调用栈看是否仍有 Canvas 2D WebP encode。
- 或在 Console 临时 patch `HTMLCanvasElement.prototype.toDataURL` / `toBlob` 打尺寸与耗时（与本次调研探针一致），确认拖动窗口内无调用。
- 真机（Windows/Edge）复测时记录：素材尺寸/帧数、拖动方式（range / in / out / playhead）、松手后是否还有可感卡顿；若仍有，按 A1 → A2 → B1 → C → B2/D3 的顺序继续定位。

---

## 5. 实施拆分与提交序列

每一步一个自包含提交，各自跑对应门禁；提交信息按 Conventional Commits，正文写 why / 用户可见效果 / 影响的文件，并以 `Verified:` 段列出实际跑过的门禁。

1. `fix: defer the motion-studio sample until the drag ends` — A1 + DOM 门禁断言（`src/motion-studio.ts`、`scripts/verify-dom.ts`）。
2. `perf: encode the motion-studio still off the main thread` — A2（view 门控 + `toBlob` + object URL 生命周期）+ DOM 门禁断言。
3. `perf: encode motion atlases asynchronously` — B1（`src/sprite.ts` async 化 + `test/sprite.test.ts` 替身与断言）。
4. `perf: cut motion-studio re-render work` — C1 / C3 / C4（C2 若一起做，额外跑 preview 门禁）。
5. `perf: halve the duplicate-frame reads` — D1（+ 若采纳 D2，在同一提交或紧随其后）。
6. （可选，需 Q2 拍板）`fix: pause playback when a timeline drag starts` — A3 + README/架构说明。
7. `docs: document the motion-studio performance contract` — 更新 [`docs/architecture.md`](../docs/architecture.md) 的 motion studio 段与 [`docs/engineering.md`](../docs/engineering.md) 的 motion 测试段（"时间轴拖动不启动采样；still 仅原片视图且异步；atlas 编码异步"），README 仅在 A3 落地时补一句播放行为。

提交前注意：

- 本环境里 `pnpm` 可能重写 `pnpm-lock.yaml`；每次跑门禁后检查 `git status`，无关的 lockfile 改动要还原，别带进提交。
- 提交后在最终树重跑受影响门禁（pre-commit hook 若重写文件，需 amend 后再跑）。
- 不提交 `client.js` / `index.js`（生成物、已 git-ignore）。

---

## 6. 风险与回滚

| 风险                                   | 影响                | 缓解 / 回滚                                                       |
| -------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| `canvas.toBlob` 不可用或返回非 WebP    | 编码路径退化        | 能力探测 + 回退 `toDataURL` / PNG；单点封装，便于整体回滚         |
| object URL 生命周期（泄漏、竞态）      | 内存增长 / 显示旧帧 | generation guard + 替换/卸载时 revoke；DOM 门禁加一条断言         |
| async 编码期间 atlas canvas 被复用     | 编码结果错乱        | 现有缓存中的 atlas/poster canvas 生成后不再重绘；代码注释写明契约 |
| 拖动中不再更新采样/体积（A1）          | 交互变化            | 评审确认（Q3）；当前本来也是防抖后更新，差异只在"按住停顿"场景    |
| 拖动中暂停播放（A3）                   | 用户可见行为变化    | Q2 拍板；不采纳则保持现状                                         |
| 性能断言写死毫秒数导致 CI 机器相关抖动 | 门禁不稳定          | 门禁只断言调用计数/顺序；毫秒数只放在本计划与手工基准             |
| CSS 变量改动导致预览图差 1px           | preview 门禁失败    | 单独提交、先跑 `pnpm run preview` 确认；差异则提交预览图或回退 C2 |
| Windows/Edge 上仍有可感卡顿（B1 不够） | 目标未达成          | 进入 B2（Worker/OffscreenCanvas）/ D3，按真机数据决定             |

---

## 7. 开放问题（请评审）

1. **Q1 版本号**：这批改动算纯内部优化，还是也会包含 A3 的行为变化？决定走 `0.7.1` 还是 `0.8.0`。
2. **Q2 A3**：拖动时间轴时自动暂停播放是否接受？松手后保持暂停，还是恢复播放？
3. **Q3 拖动中的进度反馈**：A1 后拖动期间状态行不再显示"正在采样"、体积条也不更新，松手后一次到位——可以接受吗？
4. **Q4 still 分辨率**：A2 先保持工作画布分辨率（只换异步编码，零几何风险）；是否后续再降到舞台/裁剪器显示尺寸（省带宽与编码，但要改 crop 像素换算，风险中）？
5. **Q5 B2 Worker**：是否本版就做 Worker + OffscreenCanvas，还是等你在 Windows/Edge 真机按 4.4 复测后再决定？
6. **Q6 D3 视频 seek**：视频素材的 24 次串行 seek 本版是否要处理，还是接受"松手后跑一轮、async 不挡主线程"？
7. **Q7 顺带修复**：调研中发现 ≤2s 片段拖 range 条时 `updateRange` 收到相同值仍会 `setChanges([])` + `setUserSettings(null)`（清掉自动瘦身的"恢复我的设置"），见 [`src/motion-studio.ts:1672`](../src/motion-studio.ts#L1672-L1679) 与 `'range'` 分支 [`src/motion-studio.ts:1546`](../src/motion-studio.ts#L1546-L1555)。是否作为一个独立小修复一起排队？
8. **Q8 测量探针**：本次调研用的 CDP 探针是临时脚本（未入库）。要不要固化成 `scripts/verify-motion-perf.ts`（增加维护面），还是只把手工方法写进 `docs/engineering.md`？

---

## 8. 附录：调研方法与原始时序（摘要）

- 方法：保留 `scripts/verify-dom.ts --open motion --motion-gif …` 生成的 harness（`--harness` 到临时路径），用 CDP 注入探针：
  - patch `HTMLCanvasElement.prototype.toDataURL` / `CanvasRenderingContext2D.prototype.getImageData`，记录画布尺寸、耗时、字符数；
  - `PerformanceObserver('longtask')` 记录 ≥50ms 任务；
  - rAF 间隔记录掉帧；
  - `Input.dispatchMouseEvent` 合成按下/移动/松开（拖 in 点、out 点、range 条、播放头；可插入中途停顿）；
  - `Profiler.start/stop` 取 CPU profile（self time 排序）。
- 素材：`docs/preview-motion-sample.gif`（439×390）、合成 1024×1024 / 24 帧 GIF、合成 6s / 1024×1024 GIF（144 帧）、合成 2s / 640×640 MP4；探针脚本与 harness 只存在于临时目录，仓库零改动。
- 典型时序（1024×1024、24 帧、拖入点、成品视图）：
  - 松手 `t≈462ms` → `t≈507ms` 长任务 63ms（still `toDataURL` 59.6ms）→ `t≈758ms` atlas `toDataURL` 23.5ms + 46 次 read + poster → `t≈782ms` 重渲染完成。
  - 按住停顿 420ms 的变体：`t≈309ms` 长任务 61ms + `t≈525ms` 采样收尾 → 松手 `t≈875ms` 后 `t≈921ms` 长任务 62ms + `t≈1137ms` 再次采样收尾，共 6 次 `toDataURL`。
