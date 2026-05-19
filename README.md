# 视听语音整合训练系统

> 基于 Web 的心理实验平台，用于训练和评估 **视听语音感知能力**。
> 系统包含四个训练模块；前 / 后测使用 **心理物理曲线拟合** 量化阈值，训练阶段使用 **AI 自适应引擎 + 阶梯控制器** 动态调整难度，并通过 **AVIS（Audio-Visual Integration Score）** 综合认知指数 0–100 量化训练效果。

---

## 📑 目录

- [1. 快速开始（一键启动）](#1-快速开始一键启动)
  - [1.1 一键启动脚本会做什么](#11-一键启动脚本会做什么)
  - [1.2 手动启动](#12-手动启动)
  - [1.3 外部依赖一览](#13-外部依赖一览)
- [2. 系统能做什么](#2-系统能做什么)
  - [2.1 四个训练模块概览](#21-四个训练模块概览)
  - [2.2 实验三阶段流程](#22-实验三阶段流程)
- [3. AI 自适应训练机制](#3-ai-自适应训练机制)
  - [3.1 Layer 1：AdaptiveEngine 起点推导](#31-layer-1adaptiveengine-起点推导)
  - [3.2 Layer 2：StaircaseController 阶梯](#32-layer-2staircasecontroller-阶梯)
  - [3.3 起点 / 边界合理范围](#33-起点--边界合理范围)
- [4. 指标计算规则（每个指标怎么算出来的）](#4-指标计算规则每个指标怎么算出来的)
  - [4.1 功能一：噪音阈值 `threshold`](#41-功能一噪音阈值-threshold)
  - [4.2 功能二：视觉增益 `gain`](#42-功能二视觉增益-gain)
  - [4.3 功能三：整合时窗 `window`](#43-功能三整合时窗-window)
  - [4.4 功能四：干扰成本 `cost`](#44-功能四干扰成本-cost)
- [5. 分数映射公式（dB / ms → 0–100 分）](#5-分数映射公式db--ms--0100-分)
  - [5.1 听觉基底分 `scoreThreshold`](#51-听觉基底分-scorethreshold)
  - [5.2 视觉代偿分 `scoreGain`](#52-视觉代偿分-scoregain)
  - [5.3 时空整合分 `scoreWindow`](#53-时空整合分-scorewindow)
  - [5.4 注意抑制分 `scoreCost`](#54-注意抑制分-scorecost)
  - [5.5 AVIS 综合指数加权公式](#55-avis-综合指数加权公式)
- [6. 分数段生活化解释（结果页直接展示）](#6-分数段生活化解释结果页直接展示)
  - [6.1 听觉抗噪能力（功能一）](#61-听觉抗噪能力功能一)
  - [6.2 看口型辅助听觉的能力（功能二）](#62-看口型辅助听觉的能力功能二)
  - [6.3 声音与画面同步感（功能三）](#63-声音与画面同步感功能三)
  - [6.4 抗干扰与多任务处理（功能四）](#64-抗干扰与多任务处理功能四)
- [7. 可视化与结果输出](#7-可视化与结果输出)
  - [7.1 历史折线图（history.html）](#71-历史折线图historyhtml)
  - [7.2 结果分析图（result.html）](#72-结果分析图resulthtml)
  - [7.3 导出被试信息 CSV](#73-导出被试信息-csv)
- [8. 系统架构与数据流](#8-系统架构与数据流)
- [9. 项目文件目录](#9-项目文件目录)
- [10. 技术栈](#10-技术栈)
- [11. 常见问题（FAQ）](#11-常见问题faq)
- [12. 版本与作者](#12-版本与作者)

---

## 1. 快速开始（一键启动）

```bash
python 启动.py
```

支持 Windows / macOS / Linux。脚本会自动完成依赖检测、清端口、启动服务器与 ngrok。

### 1.1 一键启动脚本会做什么

| 步骤 | 行为 |
|------|------|
| ① 检测 **Node.js** | 没装 → 弹出官网链接；**Windows 上若装了 winget，会询问是否一键安装 `OpenJS.NodeJS.LTS`** |
| ② 检测项目 **node_modules** | 没装 → 自动执行 `npm install` |
| ③ 检测 **ngrok** | 没装 → 给链接；**Windows winget 可一键安装 `Ngrok.Ngrok`**（不装也能本地使用） |
| ④ 清理端口 | 杀掉占用 `3000` / `4040` 的旧进程 |
| ⑤ 启动 Node 服务 | `node server.js`，等待端口 3000 就绪 |
| ⑥ 启动 ngrok | 启动后从 `localhost:4040/api/tunnels` 拿公网地址并 GET 测试可达 |
| ⑦ 打印地址 + 询问打开页面 | 默认推荐打开 `admin.html` |

> 安装完 Node.js / ngrok 后，**请关闭并重新打开终端**让 PATH 生效，再次运行脚本即可。

### 1.2 手动启动

```bash
# 1. 安装依赖
npm install
# 2. 启动服务器
node server.js
# 3. 浏览器访问
# http://localhost:3000/index.html    被试端
# http://localhost:3000/admin.html    管理员后台
# http://localhost:3000/history.html  历史记录
```

> ⚠️ 必须通过 `http://localhost:3000` 访问，**不能直接双击 html**（`file://` 协议下后端 API 会失败，配置文件无法写入磁盘）。

### 1.3 外部依赖一览

| 依赖 | 版本要求 | 用途 | 缺失影响 |
|------|---------|------|---------|
| **Node.js** | ≥ 14（推荐 LTS） | 运行 `server.js` 后端 | 必需。不能启动服务 |
| **npm 包** `express`、`cors` | 见 `package.json` | 后端 API | 必需 |
| **Python** | ≥ 3.7 | 仅 `启动.py` 一键启动脚本 | 可选，手动启动可绕过 |
| **ngrok** | 任意 | 提供公网访问，便于远程测试 | 可选，仅本地使用时不需要 |

---

## 2. 系统能做什么

### 2.1 四个训练模块概览

| 模块 | 名称 | 训练目标 | 核心指标 |
|------|------|---------|---------|
| **功能一** | 噪音抗干扰（听觉基底） | 在不同噪声水平下识别语音 | `threshold` (dB) |
| **功能二** | 视觉整合（看口型代偿） | 看口型辅助识别 — 量化"视觉增益" | `gain` (dB) |
| **功能三** | 异步校准（时空整合） | 声音与画面错位下的整合能力 | `window` (ms) |
| **功能四** | 注意定位（抗干扰 + 多任务） | 单 vs 双说话人条件下的注意抑制 | `cost` (dB) |

### 2.2 实验三阶段流程

```
       前测 (pre)              训练 (train)             后测 (post)
   ┌─────────────────┐    ┌────────────────────┐    ┌─────────────────┐
   │ 心理物理曲线拟合  │ →  │ AI 推荐起点 +        │ →  │ 心理物理曲线拟合 │
   │ 得到基线阈值     │    │ 阶梯引擎自适应难度    │    │ 量化训练效果     │
   └─────────────────┘    └────────────────────┘    └─────────────────┘
```

1. **前测**：所有 SNR / 模糊度 / SOA 档位按预设顺序遍历，**心理物理曲线拟合得到基线阈值**
2. **训练**：进入材料准备页时，**AI 推荐卡片** 自动读取该被试 `pre` 阶段的 4 个功能阈值，给出每个功能的起始难度 + 策略说明；训练运行时由 `StaircaseController` 动态调整
3. **后测**：与前测相同设计，**与前测对比量化训练效果**

---

## 3. AI 自适应训练机制

训练阶段难度调节由两层机制配合：

### 3.1 Layer 1：AdaptiveEngine 起点推导

文件：`js/adaptiveEngine.js`

读取被试上一轮（通常是前测）评估的 `psychometricFit` 结果，按以下规则推导每个功能的起始难度：

| 功能 | 输入指标 | 起点推导规则 |
|------|---------|-------------|
| 功能一 | `func1.threshold` | `initialSNR = threshold + 2 dB`（首批正确率 ≈ 90%，热身后阶梯加难） |
| 功能二 | `func2.fitClear.threshold`、`func2.gain` | `initialSNR = clearThreshold + 1 dB`（冻结听觉、单独训视觉）；起始模糊度按视觉增益分档：gain > 3 → 4%；1.5 ≤ gain ≤ 3 → 8%；gain < 1.5 → 0% |
| 功能三 | `func1.threshold`、`func3.lowerSOA / upperSOA` | `initialSNR = func1.threshold + 1 dB`；视觉领先起点 = `lowerSOA + 30 ms`；听觉领先起点 = `upperSOA − 20 ms`（从窗内向窗外推） |
| 功能四 | `func4.dualThreshold`、`func4.cost` | `initialSNR = dualThreshold + 1.5 dB`；干扰衰减：cost > 3 → −3 dB（辅助）；cost ≤ 3 → 0 dB（不衰减） |

研究者可在材料准备页 AI 推荐卡片右上角切换 **"手动覆盖"** 滑块，直接编辑这些起点参数。

### 3.2 Layer 2：StaircaseController 阶梯

文件：`js/core/StaircaseController.js`

| 功能 | 阶梯类型 | 难度变量 | 详细规则 |
|------|---------|---------|---------|
| **功能一** | 2-down / 1-up | SNR | 连续答对 2 题 → SNR **−1 dB**；答错 1 题 → SNR **+1 dB** |
| **功能二** | 3-down / 1-up | 模糊度档位 | 档位数组 `[0, 4, 8, 12, 16, 20]%`；连续答对 3 题 → 档位 **+1**；答错 1 题 → 退回前一档 |
| **功能三** | 时窗边界两极拉伸 | lowerSOA / upperSOA | 每次随机出题（视觉领先 or 听觉领先）；做对 → 该侧边界 **±10 ms 外推**（窗变宽）；做错 → 该侧边界 **±10 ms 内缩** |
| **功能四** | 双轴联动 | SNR + 干扰衰减 | 主轴 2-down/1-up 调 SNR；当 SNR 已升至安全上限（默认 +9 dB）仍答错 → 启动副轴：干扰源额外 **−1 dB 衰减** |

终止条件：`totalTrials >= maxTrials` **或** `reversals >= maxReversals`，二者满足其一即结束（默认 40 试次 / 6 反转）。

### 3.3 起点 / 边界合理范围

`AdaptiveEngine.RANGES` 对每个推导值都做 `clamp`：

| 字段 | 含义 | 合理范围 |
|------|------|---------|
| `func1.initialSNR` | 功能一起始 SNR | −9 ~ +9 dB |
| `func2.initialSNR` | 功能二固定 SNR | −9 ~ +9 dB |
| `func2.initialBlur` | 功能二起始模糊度 | 0 ~ 20 %（档位 `[0,4,8,12,16,20]`） |
| `func3.initialSNR` | 功能三固定 SNR | −9 ~ +9 dB |
| `func3.visualLeadStart` | 功能三视觉领先起点 | −300 ~ 0 ms |
| `func3.audioLeadStart` | 功能三听觉领先起点 | 0 ~ +300 ms |
| `func4.initialSNR` | 功能四起始 SNR | −9 ~ +9 dB |
| `func4.distractorAttenuation` | 功能四干扰源衰减 | −12 ~ 0 dB |
| `aiTotalTrials` | 总试次上限 | 5 ~ 200 |
| `aiMaxReversals` | 反转上限 | 2 ~ 20 |

---

## 4. 指标计算规则（每个指标怎么算出来的）

> 共同前提：所有功能均采用 **Logistic 心理物理函数**做曲线拟合：
> $$
> P(x)=\gamma+\dfrac{1-\gamma-\lambda}{1+e^{-\beta(x-\alpha)}}
> $$
> 其中 $\gamma=0.25$（4 选 1 任务的猜测率）、$\lambda=0.02$（失误率）、$\alpha$ = 阈值、$\beta$ = 斜率。
> 拟合算法：Nelder–Mead 单纯形 + 多起点。详见 `js/psychometric.js`。

### 4.1 功能一：噪音阈值 `threshold`

**含义**：达到 75% 正确率所需的最低 SNR（信噪比），数值 **越低越好**（嘈杂中也能听清）。

**计算步骤**：
1. 收集每个 SNR 档位的 `(n 试次, k 正确)`
2. 拟合 Logistic 曲线 → 得到 $\alpha,\beta$
3. **threshold = $\alpha$**（即 $P(x)=0.75$ 对应的 SNR）

### 4.2 功能二：视觉增益 `gain`

**含义**：同样听觉条件下，**看口型** 比 **不看口型** 能让阈值降低多少 dB。数值 **越高越好**。

**计算步骤**：
1. 分别在 **清晰口型** 与 **模糊口型** 条件下拟合 Logistic → 得到 `thrClear` 与 `thrBlur`
2. **gain = thrBlur − thrClear**
   （模糊条件阈值偏高、清晰条件阈值偏低，差值即视觉带来的额外增益）

### 4.3 功能三：整合时窗 `window`

**含义**：声音与画面错位多大范围内，被试还能整合理解。数值 **越宽 ≠ 越好**——存在 **150 ms 常模**：偏太小（敏感）或偏太大（不挑剔）都不理想。

**计算步骤**（见 `modules/module3.js`）：
1. 在 SOA $\in[-300, +300]$ ms 各档位测试，得到 SOA → 正确率
2. 找出正确率 ≥ 0.75（criterion）的 SOA 区间 `[lowerSOA, upperSOA]`
3. **window = upperSOA − lowerSOA**
4. 同时给出：
   - `visualLeadWindow = |lowerSOA|`（视觉先于听觉时的容忍宽度，若 lowerSOA < 0）
   - `audioLeadWindow  = upperSOA`（听觉先于视觉时的容忍宽度，若 upperSOA > 0）

### 4.4 功能四：干扰成本 `cost`

**含义**：双说话人条件下，目标语音识别阈值比单说话人 **抬高** 多少 dB。数值 **越低越好**（抗干扰能力强）。

**计算步骤**：
1. 在 **单任务（single）** 和 **双任务（dual）** 条件下分别拟合 Logistic → `singleThreshold`、`dualThreshold`
2. **cost = dualThreshold − singleThreshold**

---

## 5. 分数映射公式（dB / ms → 0–100 分）

文件：`js/adaptiveEngine.js`，函数 `scoreThreshold / scoreGain / scoreWindow / scoreCost`。
**任一指标缺失（null）则该维度分数为 null，不参与 AVIS 总分加权**。

### 5.1 听觉基底分 `scoreThreshold`

```
输入：t (dB)
若 t ≤ −6      →  score = 100
若 t ≥ +6      →  score = 0
否则（−6 < t < 6）：
    score = 100 − ((t + 6) / 12) × 100
关键锚点：t = −6 → 100；t = 0 → 50；t = +6 → 0
```

### 5.2 视觉代偿分 `scoreGain`

```
输入：g (dB)
若 g ≥ 4       →  score = 100
若 g ≤ 0       →  score = 0
否则           →  score = (g / 4) × 100
关键锚点：g = 0 → 0；g = 2 → 50；g = 4 → 100
```

### 5.3 时空整合分 `scoreWindow`

```
输入：w (ms)
dev = |w − 150|
若 dev ≥ 150   →  score = 0
否则           →  score = 100 − (dev / 150) × 100
关键锚点：w = 150 ms → 100；w = 75 / 225 ms → 50；w = 0 / 300 ms → 0
（以 150 ms 为常模——既不过敏感也不过迟钝）
```

### 5.4 注意抑制分 `scoreCost`

```
输入：c (dB)
若 c ≤ 0       →  score = 100
若 c ≥ 4       →  score = 20（保留下限避免归零）
否则           →  score = 100 − (c / 4) × 80
关键锚点：c = 0 → 100；c = 2 → 60；c = 4 → 20
```

### 5.5 AVIS 综合指数加权公式

```
AVIS_total = round(
    (0.30·auditory + 0.30·visual + 0.20·integration + 0.20·attention)
    / Σ(有效维度的权重)
)
```

| 维度 | 权重 | 说明 |
|------|------|------|
| auditory（听觉基底） | 30% | 是所有视听任务的基础 |
| visual（视觉代偿）   | 30% | 视觉对听觉的补偿能力 |
| integration（时空整合）| 20% | 多感官信息融合精度 |
| attention（注意抑制） | 20% | 抗干扰、多任务能力 |

> 仅对 **非空** 维度归一化加权：若被试只完成了功能一，AVIS = auditory（即 100% 权重落在该维度上），不会因为其他维度未测试而被拉低。

---

## 6. 分数段生活化解释（结果页直接展示）

每个功能完成后，结果页 `result.html` 会用大字单行强调显示当前维度分数对应的 **生活化解释**。
来源：`result.html` 中的 `SCORE_INTERPRET` 配置（5 个分段：90–100 / 75–89 / 60–74 / 40–59 / 0–39）。

### 6.1 听觉抗噪能力（功能一）

| 分数段 | 👂 生活化解释 |
|-------|-------------|
| **90 – 100** | 在嘈杂环境（餐厅、地铁、聚会）中也能清晰听懂对方说话，几乎不需要别人重复 |
| **75 – 89**  | 日常生活中绝大多数场景沟通顺畅，只在背景非常吵闹时偶尔需要对方再说一遍 |
| **60 – 74**  | 安静环境下交流没问题，但在饭店、街边、人多的房间里听清对方会比较费力 |
| **40 – 59**  | 稍有背景噪音就明显影响理解，常需要靠近对方、读唇或请对方重复 |
| **0 – 39**   | 即便在轻微噪音下也很难听清，长时间聆听容易疲劳，建议尽量在安静环境交流 |

### 6.2 看口型辅助听觉的能力（功能二）

| 分数段 | 👁️ 生活化解释 |
|-------|-------------|
| **90 – 100** | 能熟练借助说话人的口型与表情来"补全"听不清的语音，视觉与听觉协同非常好 |
| **75 – 89**  | 能在多数情况下利用口型读取关键信息，遮挡或侧脸时仍可较好理解 |
| **60 – 74**  | 面对面交流时口型有一定帮助，但戴口罩或低头时听清会变得困难 |
| **40 – 59**  | 基本依赖耳朵听，视觉整合较弱；对方背光、戴口罩时容易漏掉信息 |
| **0 – 39**   | 尚未形成视觉代偿习惯，建议交流时多看着对方说话，以训练"看着听"的能力 |

### 6.3 声音与画面同步感（功能三）

| 分数段 | 🔗 生活化解释 |
|-------|-------------|
| **90 – 100** | 看视频、看电视时即便音画轻微不同步也很容易适应，言语理解几乎不受影响 |
| **75 – 89**  | 日常视频通话或影视观看中音画不同步基本不构成困扰 |
| **60 – 74**  | 音画明显错位时（例如网络卡顿、直播延迟）会感到不自然，但仍能理解内容 |
| **40 – 59**  | 对音画不同步比较敏感，视频通话稍有延迟就影响理解，容易疲劳 |
| **0 – 39**   | 声音与画面只要不严格对齐就难以整合理解，建议优先选择面对面或低延迟通话 |

### 6.4 抗干扰与多任务处理（功能四）

| 分数段 | 🎯 生活化解释 |
|-------|-------------|
| **90 – 100** | 一边听讲一边记笔记、多人同时说话时也能锁定目标声音，注意力分配能力很强 |
| **75 – 89**  | 在课堂、会议等需要分配注意力的场景表现良好，偶尔会被突发声音短暂分心 |
| **60 – 74**  | 安静的单任务下听得清，但同时听讲与做事时容易遗漏关键信息 |
| **40 – 59**  | 只要有干扰声或同时处理多件事，听清对方就明显吃力，需要专心一件事 |
| **0 – 39**   | 抗干扰较弱，建议交流时关闭背景噪声、一次只聚焦一项任务 |

---

## 7. 可视化与结果输出

### 7.1 历史折线图（history.html）

按被试切换显示：
- 同一张图绘制 **4 个功能** 的训练进展（不同颜色 + 不同形状 symbol：圆 / 方 / 三角 / 菱形）
- **百分制 0–100**（已通过 `scoreRecord` 映射，便于跨功能对比）
- **X 轴序列**：`[前测, 训练#1, 训练#2, ..., 训练#K, 后测]`
- **训练前 / 后**：只显示最新一次 active 记录；**训练阶段**：保留所有 active 记录按序排列
- 删除时自动重新编号（`训练#1, #2, ...` 不出现空缺）

### 7.2 结果分析图（result.html）

每个功能一张专用 ECharts 图：

| 功能 | 图表 | 重点信息 |
|------|------|---------|
| 功能一 | 单条心理物理曲线（Logistic） | α 阈值线 + 75% 判断标准线 + 散点 |
| 功能二 | 双心理物理曲线（清晰 vs 模糊） | 两条曲线之间水平距离 = 视觉增益 gain |
| 功能三 | 倒 U 整合窗口面积图 | lowerSOA ~ upperSOA 区间高亮 + 窗宽数值 |
| 功能四 | 干扰成本双 Grid（曲线 + 柱状） | 单任务 vs 双任务阈值并列，cost = 差值 |

### 7.3 导出被试信息 CSV

`history.html` → "导出被试信息" 按钮。
每行 = 一个 `(subjectId, phase)` 组合（每被试最多 3 行：pre / train / post）。列：

```
基本信息：subjectId, gender, age, phase
功能一：  f1_threshold(dB), f1_score
功能二：  f2_threshold_clear(dB), f2_threshold_blur(dB), f2_gain(dB), f2_score
功能三：  f3_lowerSOA(ms), f3_upperSOA(ms), f3_window(ms), f3_score
功能四：  f4_singleThreshold(dB), f4_dualThreshold(dB), f4_cost(dB), f4_score
AVIS：   avis_auditory, avis_visual, avis_integration, avis_attention, avis_total
```

便于在 SPSS / R / Python 中做训练效果检验（如 `post − pre` 的配对样本 t 检验）。

---

## 8. 系统架构与数据流

```
被试端 (index.html)                    管理端 (admin.html)
    │                                      │
    ├── preloader.js (素材预加载)          ├── adminSettings.js (配置管理)
    ├── app.js (实验流程控制)              ├── adaptiveEngine.js (AI 推荐)
    ├── modules/module1-4.js (训练逻辑)    └── constants.js (参数读取)
    ├── core/Staircase.js (基础阶梯)
    ├── core/StaircaseController.js (训练阶梯) ★
    ├── audioProcessor.js (硬件级音频调度)
    ├── psychometric.js (曲线拟合)
    └── dataManager.js (数据存取 + AVIS 导出)
         │                                  │
         ▼                                  ▼
    localStorage ◄──────────────────► server.js (Express API)
                                         │
                                    data/ (持久化存储)
                                    config/settings/ (按被试配置)
```

**数据存储策略**：localStorage（前端缓存，键 `audioVisualTrainingData`）+ Express API 持久化到 `data/experiment_history.json` + 按被试配置 `config/settings/{subjectId}.json`。

---

## 9. 项目文件目录

```
视听语音整合训练系统_v3/
├── 启动.py                        # ⭐ Python 一键启动脚本（含依赖自动检测）
├── server.js                      # Node.js Express 后端服务器
├── upload_server.py               # Flask 文件上传服务器（备用）
├── package.json                   # Node.js 项目依赖配置
├── package-lock.json              # 依赖版本锁定文件
├── LICENSE                        # 开源许可证
├── README.md                      # 本文件
│
├── index.html                     # 被试端主实验界面
├── admin.html                     # 管理员设置界面
├── history.html                   # 历史记录 + 折线图
├── result.html                    # 单次结果分析（4 张专用图）
├── soa_test.html                  # SOA 毫秒级精度独立测试页
│
├── config/                        # 配置目录
│   ├── constants.js               # 全局参数常量（Single Source of Truth）
│   └── settings/                  # 按被试存储的配置
│       └── {subjectId}.json       # 各被试的实验配置（如 P001.json）
│
├── js/                            # JavaScript 核心模块
│   ├── app.js                     # 主应用逻辑（状态管理、流程、阶梯接入）
│   ├── audioProcessor.js          # 音频处理（Web Audio + AudioBuffer 硬件级调度）
│   ├── adminSettings.js           # 管理员配置管理
│   ├── adaptiveEngine.js          # AI 自适应推荐 + AVIS 计分 ★
│   ├── dataManager.js             # 数据存取 + 导出 CSV/JSON
│   ├── psychometric.js            # 心理物理 Logistic 曲线拟合
│   ├── preloader.js               # 素材预加载（Cache API）
│   ├── resultCharts.js            # 结果分析 ECharts 渲染
│   ├── charts.js                  # 通用图表辅助
│   ├── uiHelper.js                # 通知 / Toast
│   └── core/
│       ├── Staircase.js           # 基础阶梯算法
│       └── StaircaseController.js # 训练阶段差异化阶梯控制 ★
│
├── modules/                       # 4 个功能的训练逻辑
│   ├── module1.js                 # 噪音抗干扰
│   ├── module2.js                 # 视觉整合
│   ├── module3.js                 # 异步校准（含 calculateIntegrationWindow）
│   └── module4.js                 # 注意定位
│
├── css/                           # 样式
├── assets/                        # 实验素材（音视频）
├── data/                          # 实验历史记录持久化
│   └── experiment_history.json
├── scripts/                       # 工具脚本
│   └── generate_test_data_8888.js # 模拟数据生成（开发调试用）
└── node_modules/                  # npm 依赖（npm install 自动生成）
```

---

## 10. 技术栈

- **前端**：原生 JavaScript + Tailwind CSS + ECharts + Canvas API
- **后端**：Node.js Express
- **音频**：Web Audio API（AudioBuffer 硬件级精确调度，毫秒级 SOA 控制）
- **缓存**：Cache API（素材预加载）+ AudioBuffer 预解码
- **存储**：localStorage + REST API
- **算法**：
  - 心理物理曲线：Logistic + Nelder-Mead 单纯形（多起点）
  - 训练自适应：AdaptiveEngine（起点推导）+ StaircaseController（差异化阶梯）
  - 综合评分：AVIS 加权 30 / 30 / 20 / 20 → 0–100

---

## 11. 常见问题（FAQ）

**Q1：被试信息确认后没生成 `config/settings/{编号}.json`？**
A：必须通过 `http://localhost:3000` 访问而不是直接双击 html 文件。`file://` 协议下后端 API 不可达。`启动.py` 已自动启动服务器并打开正确地址。

**Q2：result.html 显示"无足够数据生成 XX 图"？**
A：该 `psychometricFit` 结构不完整。每个功能所需字段：
- 功能一：`fit.data`、`fit.alpha`、`fit.beta`、`fit.threshold`
- 功能二：`fit.fitClear.{data,alpha,beta}` + `fit.fitBlur.{data,alpha,beta}`
- 功能三：`fit.fit.data` + `fit.window/lowerSOA/upperSOA`
- 功能四：`fit.fitSingle.{data,alpha,beta}` + `fit.fitDual.{data,alpha,beta}` + `fit.cost`

**Q3：在 index.html 填好信息打开 admin.html 后，编号没有自动切换？**
A：已修复——admin 优先从 localStorage 读取（index 写入的最新值），并监听跨页面 `storage` 事件实时同步。

**Q4：训练前/后/训练阶段记录在历史折线图上怎么展示？**
A：X 轴序列固定为 `[前测, 训练#1, ..., 训练#K, 后测]`；前/后测取最新 active 记录，训练阶段保留所有 active 记录按序排列。

**Q5：未测试某个功能会影响 AVIS 总分吗？**
A：不会。AVIS 只对 **有数据的维度** 做权重归一化加权（详见 §5.5），未测维度返回 null 跳过。

---

## 12. 版本与作者

- **版本**：v3.2.0
- **作者**：刘慧敏
- **创建时间**：2026-05-13
- **最后更新**：2026-05-19
  - 新增：`启动.py` 自动检测并安装外部依赖（Node.js / ngrok via winget）
  - 新增：README 目录导航、指标计算规则、分数映射公式、分数段生活化解释一站整理
  - 历史折线图 4 条线使用不同 symbol（圆/方/三角/菱形）+ 低饱和（原色 alpha=0.55）配色
  - 结果分析图全中文化（Criterion / Threshold / Visual Gain / Interference Cost）
