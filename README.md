# 视听语音整合训练系统 v3

基于 Web 的心理实验平台，用于训练和评估视听语音感知能力。系统包含四个训练模块，**前/后测使用心理物理曲线拟合量化阈值**，**训练阶段使用 AI 自适应引擎 + StaircaseController 阶梯引擎动态调整难度**，并通过 AVIS（Audio-Visual Integration Score）综合认知指数对训练效果进行 0–100 量化评分与可视化对比。

## 目录结构

```
视听语音整合训练系统_v3/
├── 启动.py                    # Python 一键启动脚本
├── server.js                  # Node.js Express 后端服务器
├── upload_server.py           # Flask 文件上传服务器
├── package.json               # Node.js 项目依赖配置
├── package-lock.json          # 依赖版本锁定文件
├── LICENSE                    # 开源许可证
├── README.md                  # 项目说明文档
│
├── index.html                 # 主实验界面（被试端）
├── admin.html                 # 管理员设置界面
├── history.html               # 历史记录查看界面
├── result.html                # 结果分析界面
├── soa_test.html              # SOA 毫秒级精度独立测试页
│
├── config/                    # 配置目录
│   ├── constants.js           # 全局参数常量（Single Source of Truth）
│   └── settings/              # 按被试存储的配置文件
│       └── *.json             # 各被试的实验配置（如 P001.json）
│
├── js/                        # JavaScript 核心模块
│   ├── app.js                 # 主应用逻辑（状态管理、实验流程、阶梯接入）
│   ├── audioProcessor.js      # 音频处理（Web Audio + AudioBuffer 硬件级调度）
│   ├── psychometric.js        # 心理物理曲线拟合（Logistic + Nelder-Mead）
│   ├── dataManager.js         # 数据管理（CRUD、导入导出、含 AVIS 映射）
│   ├── adaptiveEngine.js      # AI 自适应引擎（生成训练起点 + AVIS 评分）
│   ├── resultCharts.js        # 结果分析 ECharts 图表（4 张图）
│   ├── charts.js              # 纯 Canvas 图表库（趋势/热力/面积）
│   ├── uiHelper.js            # UI 辅助工具（通知、加载、确认框）
│   ├── adminSettings.js       # 管理员设置管理
│   ├── preloader.js           # 实验素材预加载器（Cache API）
│   └── core/                  # 核心算法模块
│       ├── Staircase.js            # 通用阶梯法基础类
│       ├── StaircaseController.js  # 训练阶段 4 功能阶梯引擎（核心）
│       └── EventLogger.js          # 原始事件记录器
│
├── modules/                   # 四大训练功能模块
│   ├── module1.js             # 功能一：抗干扰训练
│   ├── module2.js             # 功能二：视觉整合训练
│   ├── module3.js             # 功能三：异步校准训练
│   └── module4.js             # 功能四：注意定位训练
│
├── css/                       # 样式文件
├── assets/                    # 实验素材（视频 + 音频）
└── data/                      # 数据存储目录（含 experiment_history.json）
```

## 文件详细说明

### 顶层文件

| 文件 | 说明 |
|------|------|
| `启动.py` | Python 一键启动脚本。自动检查 Node.js 与 ngrok 环境，杀死占用端口（3000、4040），安装 npm 依赖，启动 Node.js 服务器和 ngrok 隧道；交互式选择打开页面（被试端 / 管理端 / 历史 / SOA 测试） |
| `server.js` | Node.js Express 后端，端口 3000。提供 REST API：数据上传、文件上传、实验数据 CRUD、配置存取（`/api/save-config` 等）；同时提供静态文件服务 |
| `upload_server.py` | 独立的 Flask 文件上传服务器，端口 8001 |

### HTML 页面

| 文件 | 说明 |
|------|------|
| `index.html` | **主实验界面**，面向被试。包含快速启动 → 导引 → 实验三个屏幕，左上角抽屉式 FAQ；按依赖顺序加载所有 JS（含 StaircaseController、adaptiveEngine） |
| `admin.html` | **管理员设置界面**，面向研究者。**材料准备页采用左右等高双栏布局**：左栏 = 实验变量（SNR / 模糊度 / SOA / 注意条件复选框）+ **当前模式徽章**（📦 系统默认 / ✏️ 手动自定义 / 🧠 AI 推荐 三态实时切换）+ 仅训练阶段显示的 **AI 自适应推荐卡片**（紫色色块，含策略文字 + 起点参数 + 总试次/反转上限输入 + 「应用到变量框」按钮）；右栏 = 保存按钮 + 材料预览 +（仅训练阶段）试次统计；**训练前/后阶段会把试次统计 DOM 自动迁移到左栏底部**（因为这两个阶段不需要 AI 卡片，左栏空间更适合放试次统计） |
| `history.html` | **历史记录界面**。展示所有记录、批量删除、上传服务器、导出选中 JSON/CSV、**导出被试信息 CSV（含每阶段 × 每功能指标 + AVIS 映射分数）**；包含按被试切换的多功能折线图（百分制 0–100） |
| `result.html` | **结果分析界面**，通过 `?id=记录ID` 访问。展示心理物理曲线、阈值估计、4 张 ECharts 结果图（依功能切换）、AVIS 雷达 |
| `soa_test.html` | **SOA 毫秒级精度独立测试页**。带 🔥 预热按钮、详细日志，验证 ±1s/±2s SOA 视听同步精度 |

### JavaScript 核心模块 `js/`

| 文件 | 说明 |
|------|------|
| `app.js` | 主应用逻辑。管理全局 `STATE`（subjectId、性别/年龄、phase、func、试次队列、自适应状态）；实现 `playSOAPrecise`（毫秒级精确）、`updatePlayButton` 三态机（cue / playing / finished）、`applyFunc4Labels`、`initStaircaseControllerIfTraining`、`applyStaircaseStep` 等关键流程；将 STATE 暴露为全局变量供 admin.html 访问 |
| `audioProcessor.js` | 音频处理 v3.4。新增 `loadAudioBuffer / preloadAudioBuffers / playAudioBufferScheduled / isAudioBufferCached`，使用 Web Audio `AudioBufferSourceNode.start(t)` 实现硬件级精确调度，配合预解码暖身将首响延迟从 ~200 ms 降到 50 ms 内 |
| `psychometric.js` | 心理物理曲线拟合：Logistic 函数 P(x) = γ + (1−γ−λ)/(1+exp(−β(x−α)))；Nelder-Mead 单纯形优化（5 个初始点多点启动确保鲁棒性）；输出 α（阈值）、β（斜率）、误差棒 |
| `dataManager.js` | 数据管理。CRUD、JSON/CSV 导出、历史记录 HTML；localStorage（键名 `audioVisualTrainingData`）+ 服务器双重存储；**`exportSubjectInfoCSV` 一行一个 (被试, 阶段) 组合，横向展开 4 个功能各自的物理量指标 + AVIS 4 维分 + 总分** |
| `adaptiveEngine.js` | **AI 自适应引擎（核心）**。`generateNextConfig(evalResults)` 基于上一轮评估生成 4 个功能的训练起点；`saveNextSessionSettings` 写回 settings；`calculateCognitiveScore` 计算 AVIS 4 维加权分；`scoreRecord(record)` 单条记录映射成 0–100 |
| `resultCharts.js` | 结果分析 ECharts 图表。4 个功能各自一张：F1 心理物理曲线、F2 双曲线（清晰 vs 模糊）、F3 整合窗口、F4 干扰成本柱状图 |
| `uiHelper.js` | UI 辅助：屏幕切换、通知、加载遮罩、确认对话框 |
| `adminSettings.js` | 按被试 ID 保存/加载配置（合并为单一 JSON）；`applyDefaultSettings` 从 `PRESET_CONFIGS` 读取并应用到 UI |
| `preloader.js` | 使用 Cache API 持久缓存 3 个视频 + 4 个音频；显示进度横幅 |

### 核心算法模块 `js/core/`

| 文件 | 说明 |
|------|------|
| `Staircase.js` | 通用阶梯法基类（1-up/N-down） |
| `StaircaseController.js` | **训练阶段 4 功能各自的阶梯引擎**（详见下方"训练阶段自动推荐"章节）。公共 API：`new StaircaseController(func, initialDifficulty, opts)` → `getNextTrial()` / `updateDifficulty(isCorrect)` / `isCompleted` / `getSummary()` |
| `EventLogger.js` | 原始事件记录器，使用 `performance.now()` 精确时间戳 |

### 训练功能模块 `modules/`

| 文件 | 核心变量 | 阈值含义 | 训练目标 |
|------|----------|----------|----------|
| `module1.js`（功能一·抗干扰） | SNR | 噪音阈值（SNR @ 75% 正确率） | 在嘈杂环境提取语音 |
| `module2.js`（功能二·视觉整合） | SNR × 模糊度 | 视觉增益（清晰阈值 − 模糊阈值） | 利用视觉补偿听觉不足 |
| `module3.js`（功能三·异步校准） | SNR × SOA | 整合窗口（lowerSOA ~ upperSOA） | 校准视听时间同步 |
| `module4.js`（功能四·注意定位） | SNR × 注意条件 | 干扰抑制成本（双任务阈值 − 单任务阈值） | 选择性注意目标语音 |

---

## 实验流程（三阶段）

```
┌──────────┐       ┌──────────┐       ┌──────────┐
│ 前测 pre │  →   │ 训练 train│  →   │ 后测 post│
└──────────┘       └──────────┘       └──────────┘
   ▼                  ▼                   ▼
心理物理曲线        AI推荐起点 +      心理物理曲线
拟合得到阈值        阶梯引擎自适应       拟合得到阈值
                    动态难度
```

1. **前测（pre-test）**：所有 SNR/模糊度/SOA 档位按预设顺序遍历，**心理物理曲线拟合得到基线阈值**（α 参数）
2. **训练（train）**：
   - 进入材料准备页时，**AI 自适应推荐卡片**自动读取该被试 `pre` 阶段的 4 个功能阈值
   - 给出每个功能的"起始难度"（如 SNR / 模糊度 / SOA 起点）+ 详细策略说明
   - 训练运行时由 **StaircaseController** 根据被试每次反应动态调整难度
   - 终止条件：达到 `totalTrials`（默认 40）或 `maxReversals`（默认 6，反转次数）
3. **后测（post-test）**：与前测同样的设计，**与前测对比量化训练效果**

---

## 🧠 训练阶段自动推荐机制（重点）

训练阶段难度调节由两层机制配合：

### Layer 1：AdaptiveEngine — 生成"起点"（`js/adaptiveEngine.js`）

读取被试上一轮（通常是前测）评估的 `psychometricFit` 结果，按以下规则推导每个功能的起始难度：

| 功能 | 输入指标 | 起点推导规则 |
|------|----------|-------------|
| 功能一 | `func1.threshold` | `initialSNR = threshold + 2 dB`（首批正确率 ≈ 90%，热身后由阶梯加难） |
| 功能二 | `func2.fitClear.threshold`、`func2.gain` | `initialSNR = clearThreshold + 1 dB`（冻结听觉、单独训视觉）；起始模糊度按视觉增益分档：gain > 3 → 4%；1.5 ≤ gain ≤ 3 → 8%；gain < 1.5 → 0% |
| 功能三 | `func1.threshold`、`func3.lowerSOA/upperSOA` | `initialSNR = func1.threshold + 1 dB`；视觉领先起点 = `lowerSOA + 30 ms`；听觉领先起点 = `upperSOA − 20 ms`（从窗内向窗外推） |
| 功能四 | `func4.dualThreshold`、`func4.cost` | `initialSNR = dualThreshold + 1.5 dB`；干扰衰减：cost > 3 → −3 dB（辅助）；cost ≤ 3 → 0 dB（不衰减） |

研究者可在材料准备页 AI 推荐卡片右上角切换 **"手动覆盖"** 滑块，直接编辑这些起点参数；卡片正文动态显示"本次依据 / 策略推导"两段说明。

#### AI 推荐起点 / 边界的合理范围（与 admin UI 档位严格对齐）

为防止历史评估异常或手动覆盖输入越界导致训练参数失控，`AdaptiveEngine` 暴露 `RANGES` 常量并对每一个推导值都做 `clamp`：

| 字段 | 含义 | 合理范围 | 越界行为 |
|------|------|----------|----------|
| `func1.initialSNR` | 功能一起始 SNR | **−9 ~ +9 dB** | clamp 到边界 + console.warn |
| `func2.initialSNR` | 功能二固定 SNR | **−9 ~ +9 dB** | 同上 |
| `func2.initialBlur` | 功能二起始模糊度 | **0 ~ 20 %** | 同上（实际档位 [0,4,8,12,16,20]） |
| `func3.initialSNR` | 功能三固定 SNR | **−9 ~ +9 dB** | 同上 |
| `func3.visualLeadStart` | 功能三视觉领先起点 | **−300 ~ 0 ms** | 视觉领先须 ≤ 0 |
| `func3.audioLeadStart` | 功能三听觉领先起点 | **0 ~ +300 ms** | 听觉领先须 ≥ 0 |
| `func4.initialSNR` | 功能四起始 SNR | **−9 ~ +9 dB** | 同上 |
| `func4.distractorAttenuation` | 功能四干扰源衰减 | **−12 ~ 0 dB** | 衰减必为非正值 |
| `aiTotalTrials` | 总试次上限 | **5 ~ 200 次** | 输入框 `min/max` + clamp + amber 闪烁高亮 |
| `aiMaxReversals` | 反转上限 | **2 ~ 20 次** | 同上 |

前端编辑（"手动覆盖"启用后）：每个 input 自带 `min/max/step`；用户输入超出时自动 clamp 到边界、`UIHelper.showNotification` 提示、输入框 amber ring 闪烁 0.6 s。

### Layer 2：StaircaseController — 训练运行时阶梯（`js/core/StaircaseController.js`）

针对 4 个功能采用差异化阶梯规则：

| 功能 | 阶梯类型 | 难度变量 | 详细规则 |
|------|----------|----------|---------|
| **功能一** | 2-down / 1-up | SNR | 连续答对 2 题 → SNR **−1 dB**（变难）；答错 1 题 → SNR **+1 dB**（变易） |
| **功能二** | 3-down / 1-up | 模糊度档位 | 档位数组 `[0, 4, 8, 12, 16, 20]%`；连续答对 3 题 → 模糊度档位 **+1**；答错 1 题 → 退回前一档 |
| **功能三** | 时窗边界两极拉伸 | lowerSOA / upperSOA | 每次随机出题（视觉领先 or 听觉领先）；做对 → 该侧边界 **±10 ms 外推**（窗变宽，更挑战）；做错 → 该侧边界 **±10 ms 内缩** |
| **功能四** | 双轴联动 | SNR + 干扰衰减 | 主轴 2-down/1-up 调 SNR；当 SNR 已升至安全上限（默认 +9 dB）仍答错 → 启动副轴：干扰源额外 **−1 dB 衰减**（提供更强的辅助） |

终止条件：`totalTrials >= maxTrials` **或** `reversals >= maxReversals`，二者满足其一即结束该功能训练（在 AI 推荐卡片中可调）。

### 公共 API

```javascript
// 1. AdaptiveEngine 给出起点
const evalResults = AdaptiveEngine.collectLatestEval(subjectId);   // 从 DataManager 聚合
const nextConfig  = AdaptiveEngine.generateNextConfig(evalResults);

// 2. 训练时初始化 StaircaseController
const sc = new StaircaseController(func, nextConfig['func' + func], {
  maxTrials: 40,
  maxReversals: 6
});

// 3. 训练循环
while (!sc.isCompleted) {
  const trial = sc.getNextTrial();              // { snr, blur, soa, attention }
  const isCorrect = await runTrial(trial);
  const { isReversal, isCompleted } = sc.updateDifficulty(isCorrect);
}

const summary = sc.getSummary();                 // 含完整轨迹
```

---

## 📊 记分与绘图体系

### AVIS 综合认知指数（0–100）

`AdaptiveEngine.calculateCognitiveScore(evalResults)` 输出 4 个维度分 + 加权总分：

| 维度 | 来源指标 | 映射函数（`scoreXxx`） | 权重 |
|------|----------|----------------------|------|
| **auditory（听觉）** | `func1.threshold`（dB） | t ≤ −6 → 100；t = 0 → 50；t ≥ +6 → 0（线性段拼接） | **30%** |
| **visual（视觉）** | `func2.gain`（dB） | gain ≥ 4 → 100；gain ≤ 0 → 0（线性） | **30%** |
| **integration（整合）** | `func3.window`（ms） | 以 150 ms 为常模，`|window − 150|` 越小越好；偏差 ≥ 150 ms → 0 | **20%** |
| **attention（注意）** | `func4.cost`（dB） | cost ≤ 0 → 100；cost ≥ 4 → 20（保留下限）；线性 | **20%** |

```
AVIS_total = round(0.30·auditory + 0.30·visual + 0.20·integration + 0.20·attention)
```

### 单条记录的 0–100 评分（`scoreRecord`）

每条历史记录都可以通过 `AdaptiveEngine.scoreRecord(record)` 直接映射成 0–100 分，规则与 AVIS 各维度一致——**功能 1 用 scoreThreshold；功能 2 用 scoreGain；功能 3 用 scoreWindow；功能 4 用 scoreCost**。

### 历史折线图（`history.html`）

按被试切换显示：
- **同一张图绘制 4 个功能**（不同颜色）的训练进展
- **百分制 0–100**（已通过 `scoreRecord` 映射，便于跨功能对比）
- **X 轴序列**：`[前测, 训练#1, 训练#2, ..., 训练#K, 后测]`
- **训练前/后**：只显示最新一次评估的 active 记录
- **训练阶段**：保留所有 active 记录按训练序号排列
- **删除时**：自动重新编号（`训练#1, #2, ...` 不出现空缺）

### 结果分析图（`result.html` + `js/resultCharts.js`）

每个功能一张专用 ECharts 图：

| 功能 | 图表 | 重点信息 |
|------|------|---------|
| 功能一 | 单条心理物理曲线（Logistic） | α 阈值线 + 75% 判断标准线 + 误差棒 |
| 功能二 | 双心理物理曲线（清晰 vs 模糊） | 两条曲线之间水平距离 = 视觉增益 gain |
| 功能三 | 整合窗口面积图 | lowerSOA ~ upperSOA 区间高亮 + 窗宽数值 |
| 功能四 | 干扰成本柱状图 | 单任务 vs 双任务阈值并列，cost = 差值 |

### 导出被试信息 CSV（`history.html` → 导出被试信息）

每行 = 一个 `(subjectId, phase)` 组合（每被试最多 3 行：pre / train / post）。列：

```
基本信息：subjectId, gender, age, phase
功能一：  f1_threshold(dB), f1_score
功能二：  f2_threshold_clear(dB), f2_threshold_blur(dB), f2_gain(dB), f2_score
功能三：  f3_lowerSOA(ms), f3_upperSOA(ms), f3_window(ms), f3_score
功能四：  f4_singleThreshold(dB), f4_dualThreshold(dB), f4_cost(dB), f4_score
AVIS：   avis_auditory, avis_visual, avis_integration, avis_attention, avis_total
```

每个功能的 `_score` 列由 `AdaptiveEngine.scoreRecord` 计算，AVIS 五列由 `calculateCognitiveScore` 给出，便于在外部统计软件（SPSS / R / Python）做训练效果检验（`post − pre` 的配对样本 t 检验等）。

---

## 系统架构

```
被试端 (index.html)                    管理端 (admin.html)
    │                                      │
    ├── preloader.js (素材预加载)           ├── adminSettings.js (配置管理)
    ├── app.js (实验流程控制)               ├── adaptiveEngine.js (AI 推荐)
    ├── module1-4.js (训练逻辑)             └── constants.js (参数读取)
    ├── core/Staircase.js (基础阶梯)
    ├── core/StaircaseController.js (训练阶梯) ★
    ├── audioProcessor.js (硬件级音频调度)
    ├── psychometric.js (曲线拟合)
    └── dataManager.js (数据存取 + AVIS 导出)
         │                              │
         ▼                              ▼
    localStorage ◄──────────────────► server.js (Express API)
                                         │
                                    data/ (持久化存储)
                                    config/settings/ (按被试配置)
```

## 数据存储策略

采用 **localStorage + 服务器端** 双重存储：
- **localStorage**：快速本地缓存，键名 `audioVisualTrainingData`
- **服务器端**：通过 Express API 持久化到 `data/experiment_history.json`
- 支持导出为 JSON / CSV / 被试信息 CSV（含 AVIS 映射）

## 快速启动

```bash
# 方式一：Python 一键启动（推荐）
python 启动.py
# 启动后可选打开：被试端 / 管理端 / 历史记录 / SOA 测试页

# 方式二：手动启动
npm install
node server.js
# 访问 http://localhost:3000
```

## 技术栈

- **前端**：原生 JavaScript + Tailwind CSS + ECharts + Canvas API
- **后端**：Node.js Express
- **音频**：Web Audio API（AudioBuffer 硬件级精确调度）
- **缓存**：Cache API（素材预加载）+ AudioBuffer 预解码
- **存储**：localStorage + REST API
- **算法**：
  - 心理物理曲线：Logistic 函数 + Nelder-Mead 单纯形优化（多点启动）
  - 训练自适应：AdaptiveEngine（起点推导）+ StaircaseController（4 功能差异化阶梯）
  - 综合评分：AVIS 加权 30/30/20/20 → 0–100 分

---

**版本**：v3.1.0
**作者**：刘慧敏
**创建时间**：2026-05-13
**最后更新**：2026-05-19（新增 StaircaseController + AVIS 评分体系 + 被试信息 CSV 多指标导出）
