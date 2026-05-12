/**
 * @fileoverview 实验参数配置 — 全局唯一常量来源（Single Source of Truth）
 *
 * 所有 SNR 档位、模糊度、SOA、注意力条件等数字参数都在这里定义。
 * 模块和 UI 只通过 Config.xxx 引用，禁止自行硬编码。
 *
 * 修改参数时只需改这一个文件，所有模块自动生效。
 */

const Config = (function () {
  'use strict';

  // ==================== 资源路径 ====================

  /** @type {Object<string, string>} */
  const NOISE = {
    white: 'assets/audio/[白噪声] 纯白噪音：轻松的学习音乐，脑力，集中注意力音乐_音频.mp4'
  };

  /** @type {string[]} */
  const AUDIO_FILES = [
    'assets/audio/10万黑猪治沙？假！派科学家去养鸡治沙？这是真的！【主播说三农】_音频.mp4',
    'assets/audio/少吃水果可以少生很多病？？啊？这又是整哪出？！【主播说三农】_音频.mp4'
  ];

  /** @type {string[]} */
  const VIDEO_FILES = [
    'assets/video/10万黑猪治沙？假！派科学家去养鸡治沙？这是真的！【主播说三农】_视频.mp4',
    'assets/video/少吃水果可以少生很多病？？啊？这又是整哪出？！【主播说三农】_视频.mp4'
  ];

  // ==================== 功能一：SNR 档位 ====================
  // 7 档，覆盖 -18 dB ~ +9 dB（原始方案），当前简化版使用 [-12, +6]
  // 如需扩展到 7 档，取消注释即可

  /** @type {number[]} 全部可选 SNR 级别（dB） */
  const SNR_ALL = [-18, -12, -9, -6, -3, 0, 3, 6, 9];

  /** @type {number[]} 默认启用的 SNR 级别（dB） */
  const SNR_DEFAULT = [-12, -9, -6, -3, 0, 3, 6];

  /** @type {number} SNR 步进值（自适应算法用） */
  const SNR_STEP = 3;

  /** @type {number} SNR 最小值 */
  const SNR_MIN = -18;

  /** @type {number} SNR 最大值 */
  const SNR_MAX = 9;

  // ==================== 功能二：口型模糊度 ====================

  /** @type {number[]} 模糊度级别（%），0=清晰 */
  const BLUR_ALL = [0, 10, 20, 30, 40, 50, 60];

  /** @type {number[]} 默认启用 */
  const BLUR_DEFAULT = [0, 10, 20, 30, 40, 50, 60];

  /** @type {number} 模糊度→CSS blur px 转换系数 */
  const BLUR_CSS_FACTOR = 0.5;

  // ==================== 功能三：视听 SOA ====================
  // 11 档，步长 100ms，覆盖 -300 ~ +300ms

  /** @type {number[]} SOA 级别（ms），负值=声音提前，正值=画面提前 */
  const SOA_ALL = [-300, -200, -100, 0, 100, 200, 300];

  /** @type {number[]} 默认启用 */
  const SOA_DEFAULT = [-300, -200, -100, 0, 100, 200, 300];

  /** @type {number} SOA 步长 */
  const SOA_STEP = 100;

  /** @type {number} SOA 最小值 */
  const SOA_MIN = -300;

  /** @type {number} SOA 最大值 */
  const SOA_MAX = 300;

  // ==================== 功能四：注意条件 ====================

  /** @type {string[]} */
  const ATTENTION_CONDITIONS = ['single', 'dual'];

  // ==================== 词语库 ====================
  // 统一词语库，4 个模块共享（避免每个模块重复定义）

  /** @type {Array<{word: string, choices: string[]}>} */
  const WORD_BANK = [
    { word: '黑猪', choices: ['黑猪', '白猪', '黄猪', '灰猪'] },
    { word: '治沙', choices: ['治沙', '种树', '挖沙', '运沙'] },
    { word: '科学家', choices: ['科学家', '农民', '老师', '医生'] },
    { word: '养鸡', choices: ['养鸡', '养猪', '养牛', '养羊'] },
    { word: '水果', choices: ['水果', '蔬菜', '肉类', '粮食'] },
    { word: '生病', choices: ['生病', '健康', '长寿', '年轻'] },
    { word: '少吃', choices: ['少吃', '多吃', '不吃', '只吃'] },
    { word: '真的', choices: ['真的', '假的', '也许', '可能'] }
  ];

  // ==================== 心理物理拟合参数 ====================

  /** @type {number} 猜测率（4 选 1） */
  const PSY_GAMMA = 0.25;

  /** @type {number} 失误率（走神导致的随机错误） */
  const PSY_LAMBDA = 0.02;

  /** @type {number} 阈值标准（80% 正确率） */
  const PSY_CRITERION = 0.80;

  // ==================== 自适应算法参数 ====================

  /** @type {number} 阶梯法：连续答错次数触发升级（变易） */
  const ADAPTIVE_UP = 1;

  /** @type {number} 阶梯法：连续答对次数触发降级（变难） */
  const ADAPTIVE_DOWN = 3;

  /** @type {number} 反转次数停止阈值 */
  const ADAPTIVE_MAX_REVERSALS = 8;

  /** @type {number} 初始 SNR（自适应起点） */
  const ADAPTIVE_START_SNR = 0;

  // ==================== 实验流程参数 ====================

  /** @type {number} 每个条件默认重复次数 */
  const DEFAULT_REPETITIONS = 3;

  /** @type {number} 反应超时时间（ms） */
  const RESPONSE_TIMEOUT = 10000;

  /** @type {number} 试次间间隔（ms） */
  const ITI = 1500;

  /** @type {number} 有效反应时上限（ms），超出视为异常值 */
  const RT_CEIL = 10000;

  // ==================== 音频参数 ====================

  /** @type {number} 语音信号增益 */
  const SIGNAL_GAIN = 0.5;

  /** @type {number} 噪音增益上限倍率（防止噪音过大） */
  const NOISE_GAIN_CLAMP = 3.0;

  /** @type {number} 噪音淡出时间常数（秒） */
  const NOISE_FADE_TIME = 0.08;

  /** @type {number} 噪音停止延迟（ms） */
  const NOISE_STOP_DELAY = 500;

  // ==================== 公共 API ====================
  return {
    // 资源
    NOISE,
    AUDIO_FILES,
    VIDEO_FILES,

    // SNR
    SNR_ALL,
    SNR_DEFAULT,
    SNR_STEP,
    SNR_MIN,
    SNR_MAX,

    // 模糊度
    BLUR_ALL,
    BLUR_DEFAULT,
    BLUR_CSS_FACTOR,

    // SOA
    SOA_ALL,
    SOA_DEFAULT,
    SOA_STEP,
    SOA_MIN,
    SOA_MAX,

    // 注意条件
    ATTENTION_CONDITIONS,

    // 词语库
    WORD_BANK,

    // 心理物理
    PSY_GAMMA,
    PSY_LAMBDA,
    PSY_CRITERION,

    // 自适应
    ADAPTIVE_UP,
    ADAPTIVE_DOWN,
    ADAPTIVE_MAX_REVERSALS,
    ADAPTIVE_START_SNR,

    // 流程
    DEFAULT_REPETITIONS,
    RESPONSE_TIMEOUT,
    ITI,
    RT_CEIL,

    // 音频
    SIGNAL_GAIN,
    NOISE_GAIN_CLAMP,
    NOISE_FADE_TIME,
    NOISE_STOP_DELAY
  };
})();
