/**
 * 功能模块2：视觉口型提升噪音干扰中语音的识别（视觉整合训练）
 * 操控：有口型 vs 无口型（或清晰口型 vs 模糊口型）+ SNR
 * 输出：口型带来的识别提升量（visual gain）
 */

const Module2 = (function() {
  'use strict';
  
  // 模块状态
  let currentTrial = null;
  let trialQueue = [];
  let currentTrialIndex = 0;
  let results = [];
  let isWaitingForResponse = false;
  let responseStartTime = null;
  
  // 视频文件
  const VIDEO_FILE = AudioProcessor.VIDEO_FILES[0]; // 使用第一个视频
  
  // 词语库（与模块1相同）
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
  
  // SNR级别
  const SNR_LEVELS = [6, 3, 0, -3, -6, -9, -12];
  
  // 模糊度级别（%）
  const BLUR_LEVELS = [0, 10, 20, 30, 40, 50, 60];
  
  /**
   * 初始化模块
   */
  function init() {
    console.log('模块2：视觉整合训练 - 初始化');
  }
  
  /**
   * 生成试次队列（SNR × 模糊度 正交组合）
   * @param {Object} config - 配置对象
   * @param {Array} config.snrLevels - SNR级别数组
   * @param {Array} config.blurLevels - 模糊度数组
   * @param {number} config.repetitions - 每个组合重复次数
   * @param {string} config.order - 'random' 或 'sequential'
   * @returns {Array} - 试次数组
   */
  function generateTrialQueue(config) {
    const snrLevels = config.snrLevels || SNR_LEVELS;
    const blurLevels = config.blurLevels || BLUR_LEVELS;
    const repetitions = config.repetitions || 3;
    const order = config.order || 'random';
    
    let trials = [];
    
    // 生成所有组合
    snrLevels.forEach(snr => {
      blurLevels.forEach(blur => {
        for (let i = 0; i < repetitions; i++) {
          const wordItem = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
          trials.push({
            snr: snr,
            blur: blur,
            word: wordItem.word,
            choices: [...wordItem.choices],
            correctAnswer: wordItem.word
          });
        }
      });
    });
    
    // 排序
    if (order === 'random') {
      trials = shuffleArray(trials);
    } else {
      trials.sort((a, b) => {
        if (a.snr !== b.snr) return a.snr - b.snr;
        return a.blur - b.blur;
      });
    }
    
    trialQueue = trials;
    currentTrialIndex = 0;
    
    return trials;
  }
  
  /**
   * 开始下一个试次
   * @returns {Object|null} - 当前试次或null（如果已完成）
   */
  async function nextTrial() {
    if (currentTrialIndex >= trialQueue.length) {
      return null; // 所有试次完成
    }
    
    currentTrial = trialQueue[currentTrialIndex];
    
    // ✅ 修复：确保正确答案固定在C（索引2）便于测试
    const correctAnswer = currentTrial.correctAnswer;
    const otherChoices = currentTrial.choices.filter(c => c !== correctAnswer);
    const shuffledOthers = shuffleArray(otherChoices);
    
    // 格式：[选项A, 选项B, 正确答案C, 选项D]
    const shuffledChoices = [
      shuffledOthers[0] || otherChoices[0],
      shuffledOthers[1] || otherChoices[1],
      correctAnswer,  // 正确答案始终在C位
      shuffledOthers[2] || otherChoices[2]
    ];
    const correctIndex = 2; // C始终是正确答案
    
    currentTrial.shuffledChoices = shuffledChoices;
    currentTrial.correctIndex = correctIndex;
    
    // 播放刺激
    await playStimulus(currentTrial);
    
    isWaitingForResponse = true;
    responseStartTime = Date.now();
    currentTrialIndex++;
    
    return currentTrial;
  }
  
  /**
   * 播放刺激（视频 + 音频混合）
   * @param {Object} trial - 试次对象
   */
  async function playStimulus(trial) {
    try {
      // 设置视频模糊度
      const videoElement = document.getElementById('expVideo');
      if (videoElement) {
        if (trial.blur > 0) {
          // 应用模糊效果（使用CSS filter或canvas处理）
          videoElement.style.filter = `blur(${trial.blur * 0.5}px)`;
        } else {
          videoElement.style.filter = 'none';
        }
        
        // 播放视频
        videoElement.currentTime = 0;
        await videoElement.play();
      }
      
      // 播放混合音频
      await AudioProcessor.playMixedAudio(trial.word, trial.snr);
      
    } catch (error) {
      console.error('播放刺激失败:', error);
      // 降级方案：仅播放TTS
      await AudioProcessor.playTaskAudio(trial.word);
    }
  }
  
  /**
   * 提交答案
   * @param {number} selectedIndex - 选择的选项索引
   * @returns {Object} - 结果对象
   */
  function submitAnswer(selectedIndex) {
    if (!isWaitingForResponse) {
      return null;
    }
    
    isWaitingForResponse = false;
    const rt = Date.now() - responseStartTime;
    const isCorrect = selectedIndex === currentTrial.correctIndex;
    
    const result = {
      trial: currentTrialIndex,
      snr: currentTrial.snr,
      blur: currentTrial.blur,
      word: currentTrial.word,
      selectedIndex: selectedIndex,
      correctIndex: currentTrial.correctIndex,
      correct: isCorrect,
      rt: rt,
      timestamp: Date.now()
    };
    
    results.push(result);
    
    // 停止音频和视频
    AudioProcessor.stopAllAudio();
    const videoElement = document.getElementById('expVideo');
    if (videoElement) {
      videoElement.pause();
    }
    
    return result;
  }
  
  /**
   * 重置模块状态
   */
  function reset() {
    currentTrial = null;
    trialQueue = [];
    currentTrialIndex = 0;
    results = [];
    isWaitingForResponse = false;
    responseStartTime = null;
  }
  
  /**
   * 获取结果
   * @returns {Array} - 结果数组
   */
  function getResults() {
    return results;
  }
  
  /**
   * 计算 Visual Gain（心理物理曲线拟合法）
   * 分别拟合清晰口型(0%)和模糊口型(最大模糊度)条件下的SNR-正确率曲线，
   * Visual Gain = 清晰条件的阈值 - 模糊条件的阈值（dB）
   * @param {Array} results - 试次结果数组（可选）
   * @returns {Object|null} - {gain, fitClear, fitBlur} 或 null
   */
  function calculateVisualGain(results) {
    const data = results || Module2.getResults();
    if (!data || data.length < 10) return null;

    const blurValues = [...new Set(data.map(r => r.blur))].sort((a, b) => a - b);
    if (blurValues.length < 2) return null;

    // 清晰条件：最小模糊度
    const clearBlur = blurValues[0];
    // 模糊条件：最大模糊度
    const maxBlur = blurValues[blurValues.length - 1];

    const clearData = data.filter(r => r.blur === clearBlur);
    const blurData = data.filter(r => r.blur === maxBlur);

    const fitClear = Psychometric.fit(clearData, 'snr', { gamma: 0.25, lambda: 0.02, criterion: 0.80 });
    const fitBlur = Psychometric.fit(blurData, 'snr', { gamma: 0.25, lambda: 0.02, criterion: 0.80 });

    if (!fitClear || !fitBlur) return null;

    // Visual Gain: 清晰口型需要的SNR更低（更容易），所以阈值差为正
    const gain = fitBlur.threshold !== null && fitClear.threshold !== null
      ? fitBlur.threshold - fitClear.threshold
      : null;

    return {
      gain: gain,
      fitClear: fitClear,
      fitBlur: fitBlur,
      clearBlur: clearBlur,
      maxBlur: maxBlur
    };
  }
  
  /**
   * 洗牌算法
   * @param {Array} array - 输入数组
   * @returns {Array} - 洗牌后的数组
   */
  function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  }
  
  // 公共API
  return {
    init,
    generateTrialQueue,
    nextTrial,
    submitAnswer,
    reset,
    getResults,
    calculateVisualGain,
    VIDEO_FILE,
    WORD_BANK,
    SNR_LEVELS,
    BLUR_LEVELS
  };
})();