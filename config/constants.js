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
    // 使用 WAV 格式的白噪音（如果存在），否则使用合成噪音
    white: 'assets/audio/white_noise.wav',
    // 备用：使用 MP4 格式（如果存在）
    whiteMp4: 'assets/audio/[白噪声] 纯白噪音：轻松的学习音乐，脑力，集中注意力音乐_音频.mp4'
  };

  /**
   * 每个材料对象包含：
   *   video   - 视频文件路径
   *   audio   - 对应音频文件路径（文件名 = 视频名 + _A）
   *   label   - 显示标签（音节）
   *   choices - 四选一选项
   * @type {Array<{video:string, audio:string, label:string, choices:string[]}>}
   */
  const MATERIALS = [
    {
      video:   'assets/video/M8_ba.mp4',
      audio:   'assets/audio/M8_ba_A.mp4',
      label:   'ba',
      choices: ['ba', 'da', 'ga', 'ma']
    },
    {
      video:   'assets/video/M8_da.mp4',
      audio:   'assets/audio/M8_da_A.mp4',
      label:   'da',
      choices: ['ba', 'da', 'ga', 'na']
    },
    {
      video:   'assets/video/M8_ga.mp4',
      audio:   'assets/audio/M8_ga_A.mp4',
      label:   'ga',
      choices: ['ba', 'da', 'ga', 'ka']
    }
  ];

  /** 向后兼容：VIDEO_FILES / AUDIO_FILES 保留（模块内部可能还在用） */
  const VIDEO_FILES = MATERIALS.map(m => m.video);
  const AUDIO_FILES = MATERIALS.map(m => m.audio);

  /** 词语库：从 MATERIALS 自动生成，供模块使用 */
  const WORD_BANK = MATERIALS.map(m => ({
    word:    m.label,
    choices: m.choices,
    video:   m.video,
    audio:   m.audio
  }));

  // ==================== 功能一：SNR 档位 ====================
  /** @type {number[]} 全部可选 SNR 级别（dB）- 从容易到难（从大到小） */
  const SNR_ALL = [9, 6, 3, 0, -3, -6, -9];

  /** @type {number[]} 默认启用的 SNR 级别（dB）- 从容易到难 */
  const SNR_DEFAULT = [9, 6, 3, 0, -3, -6, -9];

  /** @type {number} SNR 步进值（自适应算法用） */
  const SNR_STEP = 3;

  /** @type {number} SNR 最小值 */
  const SNR_MIN = -9;

  /** @type {number} SNR 最大值 */
  const SNR_MAX = 9;

  // ==================== 功能二：口型模糊度 ====================
  /** @type {number[]} 模糊度级别（%），0=清晰，上限20%步长4% */
  const BLUR_ALL = [0, 4, 8, 12, 16, 20];

  /** @type {number[]} 默认启用 */
  const BLUR_DEFAULT = [0, 4, 8, 12, 16, 20];

  /** @type {number} 模糊度→CSS blur px 转换系数 */
  const BLUR_CSS_FACTOR = 0.5;

  // ==================== 功能三：视听 SOA ====================
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
  const ADAPTIVE_START_SNR = 6;  // 从容易开始（6 dB）

  // ==================== 实验流程参数 ====================
  /** @type {number} 每个条件默认重复次数 */
  const DEFAULT_REPETITIONS = 3;

  /** @type {number} 反应超时时间（ms）- 从音频播放完成后开始计时 */
  const RESPONSE_TIMEOUT = 15000;

  /**
   * 试次间间隔（ms）
   * 反馈显示后延迟此时间再开始下一个试次
   * 设为 800ms 使病人能看清反馈但不会等待太久
   */
  const ITI = 800;

  /** @type {number} 有效反应时上限（ms），超出视为异常值 */
  const RT_CEIL = 10000;

  // ==================== 音频参数 ====================
  /** @type {number} 语音信号增益 - 提高至 1.0 确保信号可听 */
  const SIGNAL_GAIN = 1.0;

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
    MATERIALS,
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
