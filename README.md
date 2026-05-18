# 视听语音整合训练系统 v3

基于 Web 的心理实验平台，用于训练和评估视听语音感知能力。系统包含四个训练模块，采用阶梯法自适应算法动态调整难度，并通过心理物理曲线拟合量化训练效果。

## 目录结构

```
视听语音整合训练系统_v3/
├── 启动.py                    # Python 一键启动脚本
├── server.js                  # Node.js Express 后端服务器
├── upload_server.py            # Flask 文件上传服务器
├── package.json                # Node.js 项目依赖配置
├── package-lock.json           # 依赖版本锁定文件
├── LICENSE                     # 开源许可证
├── README.md                   # 项目说明文档
│
├── index.html                  # 主实验界面（被试端）
├── admin.html                  # 管理员设置界面
├── history.html                # 历史记录查看界面
├── result.html                 # 结果分析界面
│
├── config/                     # 配置目录
│   ├── constants.js            # 全局参数常量（Single Source of Truth）
│   └── settings/               # 按被试存储的配置文件
│       └── *.json              # 各被试的实验配置（如 P001.json）
│
├── js/                         # JavaScript 核心模块
│   ├── app.js                  # 主应用逻辑（状态管理、实验流程控制）
│   ├── audioProcessor.js       # 音频处理模块（噪声混合、SNR 控制）
│   ├── psychometric.js         # 心理物理曲线拟合（Logistic 函数）
│   ├── dataManager.js          # 数据管理模块（CRUD、导入导出）
│   ├── charts.js               # 纯 Canvas 图表库
│   ├── uiHelper.js             # UI 辅助工具（通知、加载、确认框）
│   ├── adminSettings.js        # 管理员设置管理（配置存取）
│   ├── preloader.js            # 实验素材预加载器（Cache API）
│   └── core/                   # 核心算法模块
│       ├── Staircase.js        # 阶梯法自适应算法（1-up/N-down）
│       └── EventLogger.js      # 原始事件记录器
│
├── modules/                    # 四大训练功能模块
│   ├── module1.js              # 功能一：抗干扰训练
│   ├── module2.js              # 功能二：视觉整合训练
│   ├── module3.js              # 功能三：异步校准训练
│   └── module4.js              # 功能四：注意定位训练
│
├── css/                        # 样式文件
│   ├── style.css               # 自定义样式（动画、布局、响应式）
│   └── tailwind.min.css        # Tailwind CSS 框架
│
├── assets/                     # 实验素材
│   ├── *.mp4                   # 视频素材（音节 ba/da/ga 的口型视频）
│   └── *.wav                   # 音频素材（音节音频 + 白噪声）
│
├── data/                       # 数据存储目录
│   ├── experiment_history.json # 服务器端实验历史数据
│   ├── uploads/                # 上传文件存储
│   └── *.md                    # 数据说明文件
│
└── node_modules/               # Node.js 依赖包（自动生成）
```

## 文件详细说明

### 顶层文件

| 文件 | 说明 |
|------|------|
| `启动.py` | Python 一键启动脚本（393行）。自动检查 Node.js 和 ngrok 环境，杀死占用端口（3000、4040），安装 npm 依赖，启动 Node.js 服务器和 ngrok 隧道，并显示本地和公网访问地址 |
| `server.js` | Node.js Express 后端服务器（283行），监听端口 3000。提供 REST API：数据上传 (`/upload`)、文件上传 (`/upload/file`)、实验数据 CRUD (`/api/data`)、文件列表 (`/api/files`)、配置存取 (`/api/save-config`, `/api/load-config`, `/api/list-configs`, `/api/delete-config`)；同时提供静态文件服务 |
| `upload_server.py` | 独立的 Flask 文件上传服务器（61行），监听端口 8001。用于将上传文件保存到外部数据接收目录 |
| `package.json` | Node.js 项目配置，项目名 `audio-visual-training-system` v3.0.0，依赖 express ^4.18.2 和 cors ^2.8.5，作者：西格（Sig） |
| `package-lock.json` | npm 依赖版本锁定文件，确保团队安装一致 |
| `LICENSE` | 开源许可证文件 |

### HTML 页面

| 文件 | 说明 |
|------|------|
| `index.html` | **主实验界面**（475行），面向被试。包含三个屏幕：快速启动屏（输入被试信息、选择实验阶段）、导引屏（选择训练模块）、实验屏（4种功能视图切换）。按特定顺序加载所有 JS 模块：constants → preloader → uiHelper → Staircase → EventLogger → audioProcessor → psychometric → dataManager → charts → adminSettings → module1-4 → app |
| `admin.html` | **管理员设置界面**（544行），面向研究者。包含菜单屏（选择被试/阶段/功能）和配置屏（SNR/模糊度/SOA/注意条件复选框、重复次数、顺序模式），以及素材预览功能（可调节 SNR、模糊度、SOA 滑块实时预览效果） |
| `history.html` | **历史记录界面**（145行）。展示所有实验记录，支持全选、批量删除、上传至服务器、导出选中记录（JSON）、导出被试信息（CSV），显示 localStorage 使用率进度条 |
| `result.html` | **结果分析界面**（495行），通过 `?id=记录ID` 访问。展示：被试摘要、正确率、平均反应时间、试次数量、阈值估计、心理物理曲线、趋势图、热力图、面积图。使用 ResizeObserver 实现图表自适应渲染 |

### 配置目录 `config/`

| 文件 | 说明 |
|------|------|
| `constants.js` | **全局参数常量**（276行），是所有实验参数的 Single Source of Truth。定义：噪声路径 (`NOISE`)、材料列表 (`MATERIALS`：3个音节 ba/da/ga 的视频/音频/选项)、SNR等级（-9到+9 dB）、模糊等级（0-20%）、SOA等级（-300到+300ms）、注意条件、心理物理参数、自适应算法参数、各功能/阶段的预设配置 (`PRESET_CONFIGS`) |
| `settings/*.json` | 按被试 ID 存储的个性化配置文件（如 `P001.json`、`lhm.json`），包含该被试在各功能模块的 SNR/模糊度/SOA/注意条件选中项、重复次数、顺序模式等设置 |

### JavaScript 核心模块 `js/`

| 文件 | 说明 |
|------|------|
| `app.js` | **主应用逻辑**（2709行），系统最大的核心文件 v3.1。管理全局 `STATE`（subjectId、性别、年龄、实验阶段、功能、试次队列、结果、自适应状态）；处理快速启动流程、模块选择、试次生成、实验播放（`expPlay` 支持 SOA）、答案提交、结果展示、键盘快捷键、数据导出；将 STATE 暴露为全局变量供 admin.html 访问 |
| `audioProcessor.js` | **音频处理模块** v3.4（525行）。使用 Web Audio API 生成/播放噪声（白噪声，支持文件或合成），HTML `<audio>` 元素播放信号音频；核心函数：`playMixedAudioFile`（混合播放）、`playDualMixedAudioFile`（双说话人模式）、`setNoiseLevel`（SNR 计算）、`fadeOutAndStopNoise`（淡出停止）；支持通过 `setSinkId` 选择音频输出设备 |
| `psychometric.js` | **心理物理曲线拟合模块**（600行）。采用 Logistic 函数：P(x) = γ + (1-γ-λ) / (1+exp(-β(x-α)))；实现 Nelder-Mead 单纯形优化（2D：α, β）；多点启动拟合（5个初始点）确保鲁棒性；Canvas 绘制：数据点、误差棒、阈值线、判断标准线 |
| `dataManager.js` | **数据管理模块**（869行）。CRUD 操作、JSON/CSV 导出、历史记录 HTML 生成；使用 localStorage（键名 `audioVisualTrainingData`）存储；支持被试分组、复选框批量操作、上传至服务器、恢复被覆盖记录；导出被试信息 CSV 包含各阶段/功能阈值 |
| `charts.js` | **纯 Canvas 图表库**（901行），支持 HiDPI。图表类型：趋势折线图 (`drawTrendLine`)、热力图 (`drawHeatmap`)、面积图 (`drawAreaChart`)、心理物理曲线图 (`drawPsychometric`)、双曲线图 (`drawDualPsychometric`)、整合窗口图 (`drawIntegrationWindow`)、干扰代价图 (`drawInterferenceCost`)；使用 Catmull-Rom 转 Bezier 曲线平滑 |
| `uiHelper.js` | **UI 辅助工具**（145行）。屏幕切换、通知提示、加载遮罩、确认对话框、元素启用/禁用、日期时间格式化 |
| `adminSettings.js` | **管理员设置管理**（427行）。按被试 ID 保存/加载配置（合并为单一 JSON）；同时存储到 localStorage 和服务器 `config/settings/` 目录；`applyDefaultSettings` 从 `PRESET_CONFIGS` 读取并应用到 UI；`applySettingsToUI` 恢复复选框状态、重复次数、顺序模式 |
| `preloader.js` | **实验素材预加载器**（601行）。使用 Cache API 持久缓存 3 个视频文件和 4 个音频文件；显示进度横幅 UI，页面加载时自动开始；提供 `waitForReady()` 方法作为实验开始的前置门控 |

### 核心算法模块 `js/core/`

| 文件 | 说明 |
|------|------|
| `Staircase.js` | **阶梯法自适应算法**（1-up/N-down）。4个功能模块共用的自适应阈值测量算法，根据被试反应动态调整 SNR 难度：连续 N 次正确则降低 SNR（增加难度），1次错误则升高 SNR（降低难度） |
| `EventLogger.js` | **原始事件记录器**。记录每一次用户操作及 `performance.now()` 精确时间戳，包括：按钮点击、键盘按键、屏幕切换、系统事件 |

### 训练功能模块 `modules/`

| 文件 | 说明 |
|------|------|
| `module1.js` | **功能一：抗干扰训练**。核心变量：SNR。在噪声背景中识别语音，通过阶梯法测量噪声阈值（信噪比阈值），训练被试在嘈杂环境中提取语音信息的能力 |
| `module2.js` | **功能二：视觉整合训练**。核心变量：SNR × 模糊度。结合视觉模糊和听觉噪声，测量视觉增益（Visual Gain），训练被试利用视觉信息补偿听觉不足的能力 |
| `module3.js` | **功能三：异步校准训练**。核心变量：SNR × SOA。操控视听时间异步（SOA），测量整合窗口（Integration Window），训练被试校准视听时间同步感知的能力 |
| `module4.js` | **功能四：注意定位训练**。核心变量：SNR × 注意条件（单人/双人）。在双说话人场景中，测量干扰抑制代价（Interference Suppression Cost），训练被试选择性注意目标语音的能力 |

### 样式文件 `css/`

| 文件 | 说明 |
|------|------|
| `style.css` | 自定义样式（183行）。屏幕过渡动画、选择按钮动画、视频容器样式、阶梯法指示器、模态遮罩、响应式调整，适配大字体患者友好设计 |
| `tailwind.min.css` | Tailwind CSS 框架压缩版，提供原子化 CSS 类 |

### 实验素材 `assets/`

| 文件 | 说明 |
|------|------|
| `*.mp4` | 6个视频文件：3个音节（ba/da/ga）的口型视频，用于视听整合实验的视觉刺激 |
| `*.wav` | 2个音频文件：音节音频和白噪声，用于听觉刺激和噪声背景 |

### 数据目录 `data/`

| 文件/目录 | 说明 |
|------|------|
| `experiment_history.json` | 服务器端实验历史数据，存储所有上传的实验记录 |
| `uploads/` | 文件上传存储目录 |
| `*.md` | 数据相关说明文档 |

## 系统架构

```
被试端 (index.html)                    管理端 (admin.html)
    │                                      │
    ├── preloader.js (素材预加载)           ├── adminSettings.js (配置管理)
    ├── app.js (实验流程控制)               └── constants.js (参数读取)
    ├── module1-4.js (训练逻辑)
    ├── Staircase.js (自适应算法)
    ├── audioProcessor.js (音频混合)
    ├── psychometric.js (曲线拟合)
    └── dataManager.js (数据存取)
         │                              │
         ▼                              ▼
    localStorage ◄──────────────────► server.js (Express API)
                                         │
                                    data/ (持久化存储)
                                    config/settings/ (配置文件)
```

## 实验流程

1. **前测（pre-test）**：测量基线阈值
2. **训练（train）**：根据自适应算法动态调整难度进行训练
3. **后测（post-test）**：测量训练后阈值，评估训练效果

## 数据存储策略

采用 **localStorage + 服务器端** 双重存储：
- **localStorage**：快速本地缓存，键名 `audioVisualTrainingData`
- **服务器端**：通过 Express API 持久化到 `data/experiment_history.json`
- 支持导出为 JSON/CSV 文件

## 快速启动

```bash
# 方式一：Python 一键启动（推荐）
python 启动.py

# 方式二：手动启动
npm install
node server.js
# 访问 http://localhost:3000
```

## 技术栈

- **前端**：原生 JavaScript + Tailwind CSS + Canvas API
- **后端**：Node.js Express
- **音频**：Web Audio API
- **缓存**：Cache API（素材预加载）
- **存储**：localStorage + REST API
- **算法**：阶梯法（1-up/3-down）、Nelder-Mead 优化、Logistic 函数拟合

---

**版本**：v3.0.0  
**作者**：西格（Sig）  
**创建时间**：2026-05-13
