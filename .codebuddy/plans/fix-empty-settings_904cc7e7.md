---
name: fix-empty-settings
overview: 修复新建被试settings文件参数为空的问题：让创建settings时直接使用系统预设配置（Config.PRESET_CONFIGS），而非依赖UI checkbox状态
todos:
  - id: add-preset-settings
    content: 在 adminSettings.js 新增 getPresetSettings(func, phase) 方法，从 Config.PRESET_CONFIGS 构造完整设置对象
    status: completed
  - id: refactor-default-settings
    content: 重构 getDefaultSettings() 使其内部调用 getPresetSettings()，消除硬编码不一致
    status: completed
    dependencies:
      - add-preset-settings
  - id: fix-quickstart-path
    content: 修改 proceedQuickSelectModule()，无保存配置时使用 getPresetSettings() 替代 UI 中转路径
    status: completed
    dependencies:
      - add-preset-settings
  - id: fix-collect-settings
    content: 补充 collectSettingsFromUI() 缺失的 snrMode 和 orderState 字段
    status: completed
  - id: fix-trial-generators
    content: 补充 generateTrialsForFunc() 和 generateTrials() 缺失的 snrMode 和 orderState 字段
    status: completed
---

## 用户需求

当前 AdminSettings 创建的被试 settings 文件（如 6666.json）中，所有 phases 的参数（snrLevels/blurLevels/soaLevels/attLevels）全为空数组，导致无法直接开始测试。需要让新建的 settings 文件直接使用系统预设配置（Config.PRESET_CONFIGS），被试在 admin 界面手动更改时再更新覆盖。

## 根因

1. `proceedQuickSelectModule()` 在快速开始路径中，先调用 `AdminSettings.applyDefaultSettings()` 更新 UI checkbox，再调用 `collectSettingsFromUI()` 从 DOM 收集——但 index.html 的快速开始路径中，screen_prep 的 checkbox 未被渲染/可见，导致 `getSelectedValues()` 返回空数组
2. `collectSettingsFromUI()` 缺少 `snrMode` 和 `orderState` 字段
3. `getDefaultSettings()` 是硬编码的通用默认值，未利用 `Config.PRESET_CONFIGS` 中按功能区分的精细化预设

## 核心功能

- 新增 `getPresetSettings(func, phase)` 方法，直接从 Config.PRESET_CONFIGS 构造完整设置对象，不依赖 UI DOM
- 修改快速开始路径，使用数据驱动的预设配置而非依赖 UI 收集
- 补齐 `collectSettingsFromUI()` 缺失的 `snrMode` 和 `orderState` 字段
- 统一所有配置收集路径的字段完整性

## Tech Stack

- 前端：原生 JavaScript（ES6 IIFE 模块模式），与现有项目架构一致
- 配置来源：Config.PRESET_CONFIGS（config/constants.js 中已定义）

## 实现方案

### 核心策略：数据驱动替代 UI 依赖

当前问题本质是"从 UI 收集"模式在 DOM 不可用时失败。解决方案是新增纯数据方法 `getPresetSettings(func, phase)`，在无保存配置时直接返回完整的预设对象，无需经过 UI checkbox 中转。

### 修改点详解

#### 1. adminSettings.js — 新增 `getPresetSettings(func, phase)`

从 `Config.PRESET_CONFIGS[func][phase]` 构造完整 settings 对象，包含：

- `snrLevels`：从 PRESET_CONFIGS 读取，回退到 Config.SNR_DEFAULT
- `blurLevels`：从 PRESET_CONFIGS 读取（功能2），其余为 [0]
- `soaLevels`：从 PRESET_CONFIGS 读取（功能3），其余为 [0]
- `attLevels`：从 PRESET_CONFIGS 读取（功能4），其余为 ['single', 'dual']
- `snrMode`：从 PRESET_CONFIGS 读取，回退到 'adaptive'
- `repetitions`：从 PRESET_CONFIGS 读取，train=5 / pre/post=3
- `orderState`：{ snr: 'random', blur: 'random', soa: 'random', att: 'random' }
- `order`：'random'

#### 2. app.js — 修改 `proceedQuickSelectModule()` (L207-243)

当无保存配置时，用 `AdminSettings.getPresetSettings()` 直接获取完整预设，不再调用 `applyDefaultSettings()` + `collectSettingsFromUI()` 的 UI 中转路径。仅在 admin 界面（有完整 DOM）时才走 UI 收集路径。

#### 3. app.js — 修改 `collectSettingsFromUI()` (L248-257)

补充 `snrMode` 和 `orderState` 字段，使其与 `saveAdminSettings()` 中的 config 结构一致。

#### 4. app.js — 修改 `generateTrialsForFunc()` (L360-368) 和 `generateTrials()` (L921-928)

同样补充 `snrMode` 和 `orderState` 字段。

#### 5. adminSettings.js — 重构 `getDefaultSettings()`

使其内部调用 `getPresetSettings()`，消除硬编码与 PRESET_CONFIGS 的不一致。

## 实现注意事项

- `getPresetSettings` 必须处理 Config 未加载的边界情况（返回硬编码回退值）
- 功能2的 blurLevels 在非功能2场景应设为 [0] 而非全部等级，避免 generateTrialQueue 产生多余试次
- 同理功能3的 soaLevels、功能4的 attLevels
- 修改后需要验证：快速开始路径、管理员手动配置路径、已有保存配置的加载路径，三条路径均正常

## 目录结构

```
project-root/
├── js/
│   ├── adminSettings.js  # [MODIFY] 新增 getPresetSettings()，重构 getDefaultSettings()
│   └── app.js            # [MODIFY] 修改 proceedQuickSelectModule/collectSettingsFromUI/generateTrialsForFunc/generateTrials
├── config/
│   └── constants.js      # [NO CHANGE] PRESET_CONFIGS 已完备，无需修改
└── admin.html            # [NO CHANGE] 无需修改
```