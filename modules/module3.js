/**
 * 功能模块3：视听整合时延窗口对噪音干扰中语音识别的影响（视觉整合异步校准训练）
 * 操控：口型相对声音的提前/滞后（±0/100/200/300ms）+ SNR
 * 输出：整合时窗宽度、对异步的耐受曲线
 *
 * 重构要点：
 * 1. 所有词语/选项/视频/音频路径从 Config.MATERIALS / Config.WORD_BANK 读取
 * 2. 不再自行定义 WORD_BANK，避免与全局配置不一致
 * 3. playStimulus 已移除，播放统一由 app.js 的 expPlay() → playWithSOA() 控制
 * 4. 本模块只负责：生成试次队列 + 提交答案 + 计算整合时窗
 */

const Module3 = (function() {
  'use strict';

  // ==================== 模块私有状态 ====================
  let trialQueue    = [];
  let currentIndex   = 0;
  let results       = [];
  let isWaiting     = false;
  let responseStart = null;

  // ==================== 常量（从 Config 读取，本地缓存）====================
  const SNR_LEVELS  = Config.SNR_DEFAULT.slice();
  const SOA_LEVELS = Config.SOA_DEFAULT.slice();

  // ==================== 初始化 ====================
  function init() {
    console.log('[Module3] 异步校准训练 - 初始化');
  }

  // ==================== 试次生成 ====================
  /**
   * 生成试次队列
   * @param {Object} config - { snrLevels, soaLevels, repetitions, order }
   * @returns {Array}
   */
  function generateTrialQueue(config) {
    const snrLevels = config.snrLevels || SNR_LEVELS;
    const soaLevels = config.soaLevels || SOA_LEVELS;
    const reps      = config.repetitions || Config.DEFAULT_REPETITIONS;
    const order     = config.order || 'random';

    console.log(`[Module3] 生成试次：SNR(${snrLevels.length}) × SOA(${soaLevels.length}) × ${reps}次`);

    const trials = [];
    snrLevels.forEach(snr => {
      soaLevels.forEach(soa => {
        for (let i = 0; i < reps; i++) {
          // ★ 修复：使用 Config.WORD_BANK（ba/da/ga），而非本地中文词
          const item = Config.WORD_BANK[Math.floor(Math.random() * Config.WORD_BANK.length)];
          trials.push({
            snr:          snr,
            soa:          soa,
            word:         item.word,
            choices:       item.choices.slice(),
            correctAnswer: item.word,
            // 视频/音频路径由 app.js 的 getMaterialForWord() 动态查找
          });
        }
      });
    });

    if (order === 'random') {
      trials.sort(() => Math.random() - 0.5);
    } else {
      trials.sort((a, b) => {
        if (a.snr !== b.snr) return a.snr - b.snr;
        return a.soa - b.soa;
      });
    }

    trialQueue  = trials;
    currentIndex = 0;
    return trials;
  }

  // ==================== 试次控制（由 app.js 驱动，此处仅保留答案提交接口）====================
  /**
   * 提交答案（由 app.js 的 submitAnswer() 调用，或本模块自行记录）
   * @param {number} selectedIndex
   * @returns {Object|null}
   */
  function submitAnswer(selectedIndex) {
    if (!isWaiting) return null;
    isWaiting = false;

    const trial = trialQueue[currentIndex - 1];  // 当前已完成的试次
    if (!trial) return null;

    const rt       = responseStart ? Date.now() - responseStart : 0;
    const isCorrect = selectedIndex === trial.correctIndex;

    const result = {
      trial:         currentIndex,
      snr:           trial.snr,
      soa:           trial.soa,
      word:          trial.word,
      selectedIndex:  selectedIndex,
      correctIndex:   trial.correctIndex,
      correct:        isCorrect,
      rt:             rt > Config.RT_CEIL ? Config.RT_CEIL : rt,
      timestamp:      Date.now()
    };
    results.push(result);
    return result;
  }

  /**
   * 供 app.js 的 startNextTrial() 调用，准备下一个试次
   * @returns {Object|null}
   */
  function nextTrial() {
    if (currentIndex >= trialQueue.length) return null;
    const trial = trialQueue[currentIndex];

    // 洗牌选项（确保每次都重新洗）
    if (!trial.shuffledChoices) {
      const correct = trial.correctAnswer;
      const others  = trial.choices.filter(c => c !== correct);
      // Fisher-Yates 洗牌
      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [others[i], others[j]] = [others[j], others[i]];
      }
      const idx = Math.floor(Math.random() * 4);
      const shuffled = others.slice(0, 3);
      shuffled.splice(idx, 0, correct);
      trial.shuffledChoices = shuffled;
      trial.correctIndex    = idx;
    }

    isWaiting     = true;
    responseStart = Date.now();
    currentIndex++;
    return trial;
  }

  // ==================== 状态管理 ====================
  function reset() {
    trialQueue   = [];
    currentIndex  = 0;
    results      = [];
    isWaiting    = false;
    responseStart = null;
  }

  function getResults() {
    return results;
  }

  // ==================== 整合时窗计算 ====================
  /**
   * 计算整合时窗宽度（心理物理曲线拟合法）
   * 拟合 SOA → 正确率 曲线，计算正确率 ≥ criterion 的 SOA 范围
   * @param {Array} [data] - 外部传入的结果（可选）
   * @returns {Object|null} { window, lowerSOA, upperSOA, fit }
   */
  function calculateIntegrationWindow(data) {
    const input = data || results;
    if (!input || input.length < 5) return null;

    const fit = Psychometric.fit(input, 'soa', {
      gamma:    Config.PSY_GAMMA,
      lambda:    Config.PSY_LAMBDA,
      criterion: Config.PSY_CRITERION
    });
    if (!fit) return null;

    // 计算 criterion 水平的 SOA 范围
    const crit     = Config.PSY_CRITERION;
    const validSOAs = fit.data.filter(d => (d.k / d.n) >= crit);

    let windowWidth = null;
    let lowerSOA   = null;
    let upperSOA   = null;

    if (validSOAs.length > 0) {
      const vals = validSOAs.map(d => d.x);
      lowerSOA   = Math.min(...vals);
      upperSOA   = Math.max(...vals);
      windowWidth = upperSOA - lowerSOA;
    }

    return { window: windowWidth, lowerSOA, upperSOA, fit };
  }

  // ==================== 公共 API ====================
  return {
    init,
    generateTrialQueue,
    nextTrial,
    submitAnswer,
    reset,
    getResults,
    calculateIntegrationWindow,
    // 供参考（实际播放由 app.js 控制）
    SNR_LEVELS,
    SOA_LEVELS
  };
})();
