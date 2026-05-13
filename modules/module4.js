/**
 * 功能模块4：注意训练与目标说话人定位（注意定位能力提升训练）
 * 操控：单说话人噪音 vs 双说话人竞争（cocktail party 简化版）+ SNR
 * 输出：目标选择准确率、干扰抑制成本（干扰条件下降幅度）
 *
 * 重构要点：
 * 1. 所有词语/选项/视频/音频路径从 Config.MATERIALS / Config.WORD_BANK 读取
 * 2. 不再自行定义 WORD_BANK，避免与全局配置不一致
 * 3. playStimulus 已移除，播放统一由 app.js 的 expPlay() 控制
 * 4. 本模块只负责：生成试次队列 + 提交答案 + 计算干扰抑制成本
 */

const Module4 = (function() {
  'use strict';

  // ==================== 模块私有状态 ====================
  let trialQueue   = [];
  let currentIndex  = 0;
  let results      = [];
  let isWaiting    = false;
  let responseStart = null;

  // ==================== 常量（从 Config 读取，本地缓存）====================
  const SNR_LEVELS = Config.SNR_DEFAULT.slice();
  const ATTENTION   = Config.ATTENTION_CONDITIONS.slice();

  // ==================== 初始化 ====================
  function init() {
    console.log('[Module4] 注意定位训练 - 初始化');
  }

  // ==================== 试次生成 ====================
  /**
   * 生成试次队列
   * @param {Object} config - { snrLevels, attLevels, repetitions, order }
   * @returns {Array}
   */
  function generateTrialQueue(config) {
    const snrLevels = config.snrLevels || SNR_LEVELS;
    const attLevels  = config.attLevels  || ATTENTION;
    const reps       = config.repetitions || Config.DEFAULT_REPETITIONS;
    const order      = config.order || 'random';

    console.log(`[Module4] 生成试次：SNR(${snrLevels.length}) × 注意(${attLevels.length}) × ${reps}次`);

    const trials = [];
    snrLevels.forEach(snr => {
      attLevels.forEach(att => {
        for (let i = 0; i < reps; i++) {
          // ★ 修复：使用 Config.WORD_BANK（ba/da/ga），而非本地中文词
          const item = Config.WORD_BANK[Math.floor(Math.random() * Config.WORD_BANK.length)];
          // ★ 新增：随机分配目标说话人位置（左或右）
          const targetSide = Math.random() < 0.5 ? 'left' : 'right';
          trials.push({
            snr:       snr,
            attention:  att,
            targetSide: targetSide,  // 'left' 或 'right'
            word:       item.word,
            choices:     item.choices.slice(),
            correctAnswer: item.word,
          });
        }
      });
    });

    if (order === 'random') {
      trials.sort(() => Math.random() - 0.5);
    } else {
      trials.sort((a, b) => {
        if (a.snr !== b.snr) return a.snr - b.snr;
        if (a.attention !== b.attention) {
          return a.attention === 'single' ? -1 : 1;
        }
        return 0;
      });
    }

    trialQueue  = trials;
    currentIndex = 0;
    return trials;
  }

  // ==================== 试次控制（由 app.js 驱动）====================
  /**
   * 提交答案
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
      attention:      trial.attention,
      word:           trial.word,
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
      const idx     = Math.floor(Math.random() * 4);
      const shuffled = others.slice(0, 3);
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

  // ==================== 干扰抑制成本计算 ====================
  /**
   * 计算干扰抑制成本
   * 分别计算 single 和 dual 的阈值，成本 = dual.threshold - single.threshold
   * @param {Array} [data] - 外部传入的结果（可选）
   * @returns {Object|null} { cost, singleThreshold, dualThreshold, fitSingle, fitDual }
   */
  function calculateInterferenceCost(data) {
    const input = data || results;
    if (!input || input.length < 5) return null;

    const singleData = input.filter(r => r.attention === 'single');
    const dualData   = input.filter(r => r.attention === 'dual');

    if (singleData.length < 3 || dualData.length < 3) return null;

    const fitSingle = Psychometric.fit(singleData, 'snr', {
      gamma:    Config.PSY_GAMMA,
      lambda:    Config.PSY_LAMBDA,
      criterion: Config.PSY_CRITERION
    });
    const fitDual = Psychometric.fit(dualData, 'snr', {
      gamma:    Config.PSY_GAMMA,
      lambda:    Config.PSY_LAMBDA,
      criterion: Config.PSY_CRITERION
    });

    if (!fitSingle || !fitDual) return null;

    const cost = fitDual.threshold - fitSingle.threshold;

    return {
      cost:            cost,
      singleThreshold: fitSingle.threshold,
      dualThreshold:   fitDual.threshold,
      fitSingle:       fitSingle,
      fitDual:         fitDual
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
    calculateInterferenceCost,
    // 供参考（实际播放由 app.js 控制）
    SNR_LEVELS,
    ATTENTION
  };
})();
