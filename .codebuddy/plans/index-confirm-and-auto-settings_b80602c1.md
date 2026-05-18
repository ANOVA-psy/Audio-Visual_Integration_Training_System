---
name: index-confirm-and-auto-settings
overview: 在index.html用户输入编号/性别/年龄后增加确认弹窗，确认后自动生成settings文件；admin.html自动读取最近创建的settings文件来保持编号一致
todos:
  - id: add-confirm-dialog
    content: 修改 quickStart() 添加确认弹窗，确认后执行原流程
    status: completed
  - id: add-generate-settings
    content: 新增 generateSubjectSettings() 函数，确认后为当前阶段4个功能生成预设settings
    status: completed
    dependencies:
      - add-confirm-dialog
  - id: add-get-latest-subject
    content: 在 adminSettings.js 新增 getLatestSubject() 方法
    status: completed
  - id: fix-admin-init
    content: 修改 admin.html 初始化脚本，从 getLatestSubject() 同步被试信息
    status: completed
    dependencies:
      - add-get-latest-subject
---

## 产品概述

将settings文件的生成入口从admin页面迁移到index页面，用户在index输入编号/性别/年龄后必须先确认信息，确认后自动生成该被试的完整settings文件；admin页面启动时自动同步最近被试编号。

## 核心功能

- **index确认弹窗**：用户点击阶段按钮时，弹出自定义确认对话框显示编号/性别/年龄，取消可返回修改，确认后存储并生成settings
- **确认后生成settings**：确认时为当前阶段的所有4个功能模块生成预设配置文件（使用已有的getPresetSettings），保存到localStorage和服务器
- **admin自动同步**：admin页面加载时，自动读取最近更新/创建的settings文件，将被试编号、性别、年龄填入输入框，保持与index页面一致

## 技术栈

- 前端：原生JavaScript（ES6 IIFE模块模式），Tailwind CSS
- 数据存储：localStorage + 服务端 config/settings/ 文件夹
- 已有工具：UIHelper.showConfirm()（自定义确认对话框，非原生alert/confirm）

## 实现方案

### 核心策略：确认前置 + settings生成迁移

将settings生成从"admin手动操作"迁移为"index确认后自动生成"。用户在index页面确认信息后，立即为当前阶段的所有功能生成预设settings并保存，后续进入实验时直接读取已有settings。

### 修改点详解

#### 1. app.js — 修改 `quickStart()` (L61-105)

当前流程：点击阶段 → 直接存localStorage → 进入引导页
修改为：点击阶段 → 弹出确认对话框 → 取消则返回 → 确认则存localStorage + 生成settings + 进入引导页

具体：

- 先读取编号/性别/年龄到STATE
- 调用 `UIHelper.showConfirm()` 展示格式化的确认信息（编号、性别、年龄、所选阶段）
- onConfirm回调中：保存localStorage + 调用 `generateSubjectSettings(subjectId, phase, gender, age)` 生成当前阶段4个功能的settings + 进入引导页
- onCancel回调中：什么都不做，用户可修改输入

#### 2. app.js — 新增 `generateSubjectSettings()` 内部函数

遍历 func 1-4，对当前阶段调用 `AdminSettings.getPresetSettings(func, phase)` 获取预设配置，再调用 `AdminSettings.saveSettings(subjectId, phase, func, preset, gender, age)` 保存。仅保存当前阶段的4个功能配置，不预生成其他阶段。

#### 3. adminSettings.js — 新增 `getLatestSubject()` 方法

从 `getAllSettings()` 返回的所有被试中，按 `updatedAt` 或 `createdAt` 排序，返回最近更新/创建的被试对象（包含subjectId、gender、age）。

#### 4. admin.html — 修改初始化脚本 (L525-538)

当前：仅从localStorage读取lastSubjectId
修改为：优先从 `AdminSettings.getLatestSubject()` 获取最近被试信息，自动填入编号、性别、年龄输入框（admin页面无性别/年龄输入框时只填编号）。若localStorage也有值，以getLatestSubject为准（确保与settings文件一致）。

## 实现注意事项

- `UIHelper.showConfirm()` 的message参数支持HTML，但当前实现用innerHTML插入，需确认XSS安全性（本项目为内部实验系统，可接受）
- 生成settings时仅生成当前阶段的4个功能，而非所有阶段，避免过多无用数据
- admin同步时需处理localStorage为空但服务器有settings文件的边界情况
- 已有被试的settings不应被覆盖——`saveSettings()`中已有合并逻辑，新phase key会追加到phases对象中

## 目录结构

```
project-root/
├── js/
│   ├── adminSettings.js  # [MODIFY] 新增 getLatestSubject() 方法并暴露到公共API
│   └── app.js            # [MODIFY] 修改 quickStart() 增加确认弹窗，新增 generateSubjectSettings()
├── admin.html            # [MODIFY] 初始化脚本改为从 AdminSettings.getLatestSubject() 同步
└── index.html            # [NO CHANGE] 编号/性别/年龄表单已有，无需修改
```