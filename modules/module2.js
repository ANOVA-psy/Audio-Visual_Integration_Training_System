/**
 * 功能模块2：视觉口型提升噪音干扰中语音的识别（视觉整合训练）
 * 操控：有口型 vs 无口型（或清晰口型 vs 模糊口型）+ SNR
 * 输出：口型带来的识别提升量（visual gain）
 *
 * 重构要点：
 * 1. 所有词语/选项/视频/音频路径从 Config.MATERIALS / Config.WORD_BANK 读取
 * 2. 不再自行定义 WORD_BANK，避免与全局配置不一致
 * 3. playStimulus 已移除，播放统一由 app.js 的 expPlay() 控制
 * 4. 本模块只负责：生成试次队列 + 提交答案 + 计算 Visual Gain
 */

const Module2 = (function() {
  'use strict';

  // ==================== 模块私有状态 ====================
  let trialQueue   = [];
  let currentIndex  = 0;
  let results      = [];
  let isWaiting    = false;
  let responseStart = null;

  // ==================== 常量（从 Config 读取，本地缓存）====================
  const SNR_LEVELS  = Config.SNR_DEFAULT.slice();
  const BLUR_LEVELS = Config.BLUR_DEFAULT.slice();

  // ==================== 初始化 ====================
  function init() {
    console.log('[Module2] 视觉整合训练 - 初始化');
  }

  // ==================== 试次生成 ====================
  /**
   * 生成试次队列
   * @param {Object} config - { snrLevels, blurLevels, repetitions, order }
   * @returns {Array}
   */
  function generateTrialQueue(config) {
    const snrLevels = config.snrLevels || SNR_LEVELS;
    const blurLevels = config.blurLevels || BLUR_LEVELS;
    const reps       = config.repetitions || Config.DEFAULT_REPETITIONS;
    const order      = config.order || 'random';

    console.log(`[Module2] 生成试次：SNR(${snrLevels.length}) × 模糊度(${blurLevels.length}) × ${reps}次`);

    const trials = [];
    snrLevels.forEach(snr => {
      blurLevels.forEach(blur => {
        for (let i = 0; i < reps; i++) {
          // ★ 修复：使用 Config.WORD_BANK（ba/da/ga），而非本地中文词
          const item = Config.WORD_BANK[Math.floor(Math.random() * Config.WORD_BANK.length)];
          trials.push({
            snr:          snr,
            blur:          blur,
            word:          item.word,
            choices:        item.choices.slice(),
            correctAnswer:  item.word,
          });
        }
      });
    });

    if (order === 'random') {
      trials.sort(() => Math.random() - 0.5);
    } else {
      trials.sort((a, b) => {
        if (a.snr !== b.snr) return a.snr - b.snr;
        return a.blur - b.blur;
      });
    }

    trialQueue  = trials;
    currentIndex = 0;
    return trials;
  }

  // ==================== 试次控制（由 app.js 驱动）====================
  /**
   * 提交答案（由 app.js 的 submitAnswer() 调用，或本模块自行记录）
   * @param {number} selectedIndex
   * @returns {Object|null}
   */
  function submitAnswer(selectedIndex) {
    if (!isWaiting) return null;
    isWaiting = false;

    const trial = trialQueue[currentIndex - 1];
    if (!trial) return null;

    const rt        = responseStart ? Date.now() - responseStart : 0;
    const isCorrect = selectedIndex === trial.correctIndex;

    const result = {
      trial:         currentIndex,
      snr:           trial.snr,
      blur:          trial.blur,
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

    // 洗牌选项
    if (!trial.shuffledChoices) {
      const correct = trial.correctAnswer;
      const others  = trial.choices.filter(c => c !== correct);
      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [others[i], others[j]] = [others[j], others[i]];
      }
      const idx        = Math.floor(Math.random() * 4);
      const shuffled   = others.slice(0, 3);
      shuffled.splice(idx, 0, correct);
      trial.shuffledChoices = shuffled;
      trial.correctIndex    = idx;
    }

    isWaiting    = true;
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

  // ==================== Visual Gain 计算 ====================
  /**
   * 计算 Visual Gain（心理物理曲线拟合法）
   * 分别拟合清晰口型(0%)和模糊口型(最大模糊度)条件下的SNR-正确率曲线，
   * Visual Gain = 模糊条件阈值 - 清晰条件阈值（dB）
   * @param {Array} [data] - 外部传入的结果（可选）
   * @returns {Object|null} { gain, fitClear, fitBlur, clearBlur, maxBlur }
   */
  function calculateVisualGain(data) {
    const input = data || results;
    if (!input || input.length < 10) return null;

    const blurValues = [...new Set(input.map(r => r.blur))].sort((a, b) => a - b);
    if (blurValues.length < 2) return null;

    const clearBlur = blurValues[0];
    const maxBlur   = blurValues[blurValues.length - 1];

    const clearData = input.filter(r => r.blur === clearBlur);
    const blurData  = input.filter(r => r.blur === maxBlur);

    const fitClear = Psychometric.fit(clearData, 'snr', {
      gamma:    Config.PSY_GAMMA,
      lambda:    Config.PSY_LAMBDA,
      criterion: Config.PSY_CRITERION
    });
    const fitBlur = Psychometric.fit(blurData, 'snr', {
      gamma:    Config.PSY_GAMMA,
      lambda:    Config.PSY_LAMBDA,
      criterion: Config.PSY_CRITERION
    });

    if (!fitClear || !fitBlur) return null;

    const gain = (fitBlur.threshold !== null && fitClear.threshold !== null)
      ? fitBlur.threshold - fitClear.threshold
      : null;

    return {
      gain:       gain,
      fitClear:   fitClear,
      fitBlur:    fitBlur,
      clearBlur:   clearBlur,
      maxBlur:     maxBlur
    };
  }

  // ==================== 公共 API ====================
  return {
    init,
    generateTrialQueue,
    nextTrial,
    submitAnswer,
    reset,
    getResults,
    calculateVisualGain,
    // 供参考（实际播放由 app.js 控制）
    SNR_LEVELS,
    BLUR_LEVELS
  };
})();
