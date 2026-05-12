/**
 * @fileoverview 功能模块1：听觉语音在噪音中的可感知程度（抗干扰训练）
 *
 * 操控变量：SNR（信噪比）
 * 输出：噪音阈值（达到 criterion 正确率所需的 SNR）
 *
 * 重构要点：
 * - 所有常量从 Config 读取
 * - 支持 Staircase 自适应模式
 * - 使用 EventLogger 记录原始事件
 * - 阈值计算委托给 Psychometric.fit()
 */

const Module1 = (function () {
  'use strict';

  // ==================== 模块状态 ====================
  let currentTrial = null;
  let trialQueue = [];
  let currentTrialIndex = 0;
  let results = [];
  let isWaitingForResponse = false;
  let responseStartTime = null;

  /** @type {Staircase|null} 自适应算法实例 */
  let staircase = null;

  // ==================== 初始化 ====================

  function init() {
    console.log('[Module1] 抗干扰训练 - 初始化');
  }

  // ==================== 试次生成 ====================

  /**
   * 生成试次队列（组合遍历模式）
   * @param {Object} config
   * @param {number[]} config.snrLevels - SNR 级别
   * @param {number} [config.repetitions=3] - 每级重复次数
   * @param {string} [config.order='random'] - 'random' | 'sequential'
   * @returns {Array<Object>} 试次数组
   */
  function generateTrialQueue(config) {
    var snrLevels = config.snrLevels || Config.SNR_DEFAULT;
    var repetitions = config.repetitions || Config.DEFAULT_REPETITIONS;
    var order = config.order || 'random';

    var trials = [];
    snrLevels.forEach(function (snr) {
      for (var i = 0; i < repetitions; i++) {
        var wordItem = Config.WORD_BANK[Math.floor(Math.random() * Config.WORD_BANK.length)];
        trials.push({
          snr: snr,
          word: wordItem.word,
          choices: wordItem.choices.slice(),
          correctAnswer: wordItem.word
        });
      }
    });

    if (order === 'random') {
      trials = shuffleArray(trials);
    } else {
      trials.sort(function (a, b) { return a.snr - b.snr; });
    }

    trialQueue = trials;
    currentTrialIndex = 0;

    return trials;
  }

  /**
   * 初始化自适应阶梯法
   * @param {Object} [opts] - 阶梯法参数（可选，默认从 Config 读取）
   */
  function initStaircase(opts) {
    staircase = new Staircase(Object.assign({
      startValue: Config.ADAPTIVE_START_SNR,
      stepSize: Config.SNR_STEP,
      min: Config.SNR_MIN,
      max: Config.SNR_MAX,
      downRule: Config.ADAPTIVE_DOWN,
      upRule: Config.ADAPTIVE_UP,
      maxReversals: Config.ADAPTIVE_MAX_REVERSALS
    }, opts || {}));
  }

  /**
   * 获取自适应模式的下一个试次（动态生成）
   * @returns {Object|null}
   */
  function nextAdaptiveTrial() {
    if (!staircase || staircase.isFinished()) return null;

    var snr = staircase.nextTrial();
    var wordItem = Config.WORD_BANK[Math.floor(Math.random() * Config.WORD_BANK.length)];

    return {
      snr: snr,
      word: wordItem.word,
      choices: wordItem.choices.slice(),
      correctAnswer: wordItem.word,
      adaptive: true
    };
  }

  // ==================== 试次控制 ====================

  function nextTrial() {
    if (currentTrialIndex >= trialQueue.length) {
      return null;
    }

    currentTrial = trialQueue[currentTrialIndex];
    shuffleChoices(currentTrial);

    if (typeof EventLogger !== 'undefined') {
      EventLogger.stimulus('trial_start', {
        trial: currentTrialIndex + 1,
        snr: currentTrial.snr,
        word: currentTrial.word
      });
    }

    isWaitingForResponse = true;
    responseStartTime = Date.now();
    currentTrialIndex++;

    return currentTrial;
  }

  /**
   * 记录自适应试次结果
   * @param {boolean} isCorrect
   * @returns {Object|null}
   */
  function recordAdaptiveResult(isCorrect) {
    if (!staircase) return null;

    var snr = staircase.nextTrial();
    var result = staircase.record(isCorrect);

    var wordItem = Config.WORD_BANK[Math.floor(Math.random() * Config.WORD_BANK.length)];
    var trial = {
      snr: snr,
      word: wordItem.word,
      choices: wordItem.choices.slice(),
      correctAnswer: wordItem.word,
      adaptive: true
    };

    shuffleChoices(trial);
    return { trial: trial, staircaseResult: result };
  }

  function submitAnswer(selectedIndex) {
    if (!isWaitingForResponse) return null;

    isWaitingForResponse = false;
    var rt = Date.now() - responseStartTime;
    var isCorrect = selectedIndex === currentTrial.correctIndex;

    var result = {
      trial: currentTrialIndex,
      snr: currentTrial.snr,
      word: currentTrial.word,
      selectedIndex: selectedIndex,
      correctIndex: currentTrial.correctIndex,
      correct: isCorrect,
      rt: rt > Config.RT_CEIL ? Config.RT_CEIL : rt,
      timestamp: Date.now()
    };

    results.push(result);

    if (typeof EventLogger !== 'undefined') {
      EventLogger.user('click_choice', {
        trial: currentTrialIndex,
        selectedIndex: selectedIndex,
        correct: isCorrect,
        rt: result.rt
      });
    }

    AudioProcessor.stopAllAudio();
    return result;
  }

  function reset() {
    currentTrial = null;
    trialQueue = [];
    currentTrialIndex = 0;
    results = [];
    isWaitingForResponse = false;
    responseStartTime = null;
    staircase = null;
  }

  function getResults() {
    return results;
  }

  // ==================== 阈值计算 ====================

  /**
   * 心理物理曲线拟合法计算噪音阈值
   * @param {Array} [data] - 试次结果（可选）
   * @returns {Object|null} {alpha, beta, threshold, r2, data}
   */
  function calculateThreshold(data) {
    var results = data || Module1.getResults();
    if (!results || results.length < 5) return null;
    return Psychometric.fit(results, 'snr', {
      gamma: Config.PSY_GAMMA,
      lambda: Config.PSY_LAMBDA,
      criterion: Config.PSY_CRITERION
    });
  }

  // ==================== 辅助函数 ====================

  function shuffleChoices(trial) {
    var correctAnswer = trial.correctAnswer;
    var otherChoices = trial.choices.filter(function (c) { return c !== correctAnswer; });
    var shuffledOthers = shuffleArray(otherChoices);

    trial.shuffledChoices = [
      shuffledOthers[0] || correctAnswer,
      shuffledOthers[1] || correctAnswer,
      correctAnswer,
      shuffledOthers[2] || correctAnswer
    ];
    trial.correctIndex = 2;
  }

  function shuffleArray(array) {
    var arr = array.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  // ==================== 公共 API ====================
  return {
    init: init,
    generateTrialQueue: generateTrialQueue,
    initStaircase: initStaircase,
    nextAdaptiveTrial: nextAdaptiveTrial,
    nextTrial: nextTrial,
    submitAnswer: submitAnswer,
    reset: reset,
    getResults: getResults,
    calculateThreshold: calculateThreshold,
    getStaircase: function () { return staircase; }
  };
})();
