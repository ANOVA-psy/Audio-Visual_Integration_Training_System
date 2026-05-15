# 数据存储目录

## 目录结构

```
视听语音整合训练系统_v3/
├── 启动.py                 # Python 启动脚本（启动服务器+ngrok）
├── server.js               # Node.js 后端服务器
├── package.json            # Node.js 依赖配置
├── index.html              # 主界面（病人/被试界面）
├── admin.html              # 管理员设置界面
├── history.html            # 历史记录查看界面
│
├── config/                 # 配置目录
│   └── constants.js        # 全局参数配置（SNR、模糊度、SOA等）
│
├── modules/                # 功能模块目录
│   ├── module1.js          # 功能一：抗干扰训练
│   ├── module2.js          # 功能二：视觉整合训练
│   ├── module3.js          # 功能三：异步校准训练
│   └── module4.js          # 功能四：注意定位训练
│
├── js/                     # JavaScript 核心库
│   ├── app.js              # 主应用逻辑
│   ├── audioProcessor*.js  # 音频处理模块
│   ├── psychometric.js     # 心理物理曲线拟合
│   ├── dataManager.js      # 数据管理与导出
│   ├── uiHelper.js         # UI 辅助函数
│   ├── adminSettings.js    # 管理员设置管理
│   └── core/               # 核心算法模块
│       ├── Staircase.js    # 阶梯法自适应算法
│       └── EventLogger.js  # 原始事件记录器
│
├── css/                    # 样式文件
│   ├── style.css           # 自定义样式
│   └── tailwind.min.css    # Tailwind CSS 框架
│
├── assets/                 # 实验素材
│   ├── video/              # 视频素材（M8_ba/da/ga.mp4）
│   └── audio/              # 音频素材（含白噪声）
│
└── data/                   # 数据存储目录
    ├── experiment_history.json  # 实验历史数据
    ├── uploads/                 # 上传文件
    ├── subjects/                # 被试数据
    ├── exports/                 # 导出文件
    └── backups/                 # 数据备份
```

## 数据文件说明

### 1. experiment_history.json（核心文件）

**位置**：`data/experiment_history.json`

**用途**：存储所有实验历史记录的主文件，与代码完全隔离

**数据格式**：
```json
[
  {
    "id": "kf8a2m3n4x5",
    "timestamp": "2026-05-13T10:30:00.000Z",
    "metadata": {
      "subjectId": "S001",
      "date": "2026-05-13",
      "phase": "train",
      "func": 1,
      "snrMode": "adaptive",
      "threshold": -6.5,
      "totalTrials": 30,
      "accuracy": 85,
      "avgRT": 1234
    },
    "psychometricFit": null,
    "rawEventLog": null,
    "results": [
      {
        "trial": 1,
        "snr": -6,
        "correct": true,
        "rt": 1156,
        "choice": "ba",
        "timestamp": "2026-05-13T10:30:05.000Z"
      }
    ]
  }
]
```

### 2. subjects/ 目录（按被试分类）

**用途**：为每个被试单独存储实验数据，方便查找和管理

**命名规则**：`{phase}_{func}{num}_YYYY-MM-DD.json`
- `phase`: pre（训练前）/ train（训练阶段）/ post（训练后）
- `func`: 1-4（功能编号）
- `num`: 功能编号
- `YYYY-MM-DD`: 实验日期

### 3. exports/ 目录（导出文件）

**用途**：存放用户手动导出的数据文件

**子目录**：
- `json/`: JSON格式导出文件
- `csv/`: CSV格式导出文件

### 4. backups/ 目录（自动备份）

**用途**：自动备份历史记录，防止数据丢失

**命名规则**：`experiment_history_backup_YYYYMMDD_HHMMSS.json`

## 数据隔离优势

1. **与代码分离**：数据文件独立于JavaScript代码，便于版本管理
2. **易于备份**：只需备份 `data/` 目录即可保存所有实验数据
3. **版本控制友好**：JSON文件可以被Git跟踪（如果不需要跟踪，可添加到 `.gitignore`）
4. **便于迁移**：可以轻松将数据迁移到其他系统或服务器
5. **多浏览器共享**：如果使用服务器端API，可以实现跨浏览器数据同步

## 使用方式

### 方式1：纯前端方案（当前实现）

- 使用 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- 用户首次使用时选择 `data/` 目录
- 系统自动读写该目录下的文件

**优点**：无需服务器，数据保存在本地
**缺点**：需要现代浏览器支持，每次可能需要重新选择目录

### 方式2：服务器端方案（推荐用于生产环境）

- 添加简单的后端API（Node.js/Python/PHP）
- 提供以下接口：
  - `GET /api/data` - 获取所有数据
  - `POST /api/data` - 保存数据
  - `GET /api/data/:subjectId` - 获取指定被试数据
  - `DELETE /api/data/:id` - 删除指定记录

**优点**：数据集中管理，支持多用户，支持跨设备访问
**缺点**：需要服务器部署

### 方式3：混合方案（推荐）

- 优先使用 localStorage 作为缓存（快速访问）
- 定期自动同步到 `data/experiment_history.json`
- 提供"导出到文件"和"从文件导入"功能

**优点**：兼顾速度和持久化存储

## 下一步操作

1. **创建数据结构**：系统会自动创建 `data/` 目录和初始文件
2. **修改 dataManager.js**：添加文件读写功能
3. **添加导入/导出功能**：在"历史记录"页面添加"导入文件"和"导出到文件"按钮
4. **（可选）添加服务器端API**：如果需要集中管理数据

## 注意事项

1. **隐私保护**：实验数据包含被试信息，注意数据安全和隐私保护
2. **文件大小**：如果数据量很大，考虑分批存储或压缩存储
3. **数据格式版本**：如果数据格式发生变化，需要添加版本号并编写迁移脚本
4. **备份策略**：建议定期手动备份或设置自动备份机制

---

**创建时间**：2026-05-13
**创建者**：西格（Sig）
**项目**：视听语音整合训练系统 v3
