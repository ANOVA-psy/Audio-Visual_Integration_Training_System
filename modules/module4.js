/**
 * 功能模块4：注意训练与目标说话人定位（注意定位能力提升训练）
 * 操控：单说话人噪音 vs 双说话人竞争（cocktail party 简化版）+ SNR
 * 输出：目标选择准确率、干扰抑制成本（干扰条件下降幅度）
 */

const Module4 = (function() {
  'use strict';
  
  // 模块状态
  let currentTrial = null;
  let trialQueue = [];
  let currentTrialIndex = 0;
  let results = [];
  let isWaitingForResponse = false;
  let responseStartTime = null;
  
  // 视频文件
  const TARGET_VIDEO = AudioProcessor.VIDEO_FILES[0];
  const DISTRACTOR_VIDEO = AudioProcessor.VIDEO_FILES[1];
  
  // 词语库
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
  
  // 注意条件
  const ATTENTION_CONDITIONS = ['single', 'dual'];
  
  /**
   * 初始化模块
   */
  function init() {
    console.log('模块4：注意定位训练 - 初始化');
  }
  
  /**
   * 生成试次队列（SNR × 注意条件 正交组合）
   * @param {Object} config - 配置对象
   * @returns {Array} - 试次队列
   */
  function generateTrialQueue(config) {
    const snrLevels = config.snrLevels || SNR_LEVELS;
    const repetitions = config.repetitions || 3;
    const order = config.order || 'random';
    
    let trials = [];
    
    // 生成所有组合
    snrLevels.forEach(snr => {
      ATTENTION_CONDITIONS.forEach(attention => {
        for (let i = 0; i < repetitions; i++) {
          const wordItem = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
          trials.push({
            snr: snr,
            attention: attention,
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
        if (a.attention !== b.attention) {
          return a.attention === 'single' ? -1 : 1;
        }
        return 0;
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
   * 播放刺激（目标说话人 + 干扰说话人 + 音频混合）
   * @param {Object} trial - 试次对象
   */
  async function playStimulus(trial) {
    try {
      // 播放目标说话人视频
      const targetVideo = document.getElementById('expVideoTarget');
      if (targetVideo) {
        targetVideo.currentTime = 0;
        await targetVideo.play();
      }
      
      // 如果是双说话人条件，播放干扰说话人视频
      if (trial.attention === 'dual') {
        const distractorVideo = document.getElementById('expVideoDist');
        if (distractorVideo) {
          distractorVideo.currentTime = 0;
          await distractorVideo.play();
        }
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
      attention: currentTrial.attention,
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
    const targetVideo = document.getElementById('expVideoTarget');
    const distractorVideo = document.getElementById('expVideoDist');
    if (targetVideo) targetVideo.pause();
    if (distractorVideo) distractorVideo.pause();
    
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
   * 计算干扰抑制成本（心理物理曲线拟合法）
   * 分别拟合单说话人和双说话人条件下的 SNR-正确率 曲线
   * 干扰抑制成本 = 双说话人阈值 - 单说话人阈值（dB）
   * @param {Array} results - 试次结果数组（可选）
   * @returns {Object|null} - {cost, fitSingle, fitDual} 或 null
   */
  function calculateInterferenceSuppressionCost(results) {
    const data = results || Module4.getResults();
    if (!data || data.length < 10) return null;

    const singleData = data.filter(r => r.attention === 'single');
    const dualData = data.filter(r => r.attention === 'dual');

    if (singleData.length < 5 || dualData.length < 5) return null;

    const fitSingle = Psychometric.fit(singleData, 'snr', { gamma: 0.25, lambda: 0.02, criterion: 0.80 });
    const fitDual = Psychometric.fit(dualData, 'snr', { gamma: 0.25, lambda: 0.02, criterion: 0.80 });

    if (!fitSingle || !fitDual) return null;

    // 干扰抑制成本：双说话人需要的SNR更高（更难），差值为正
    const cost = fitSingle.threshold !== null && fitDual.threshold !== null
      ? fitDual.threshold - fitSingle.threshold
      : null;

    return {
      cost: cost,
      fitSingle: fitSingle,
      fitDual: fitDual
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
    calculateInterferenceSuppressionCost,
    TARGET_VIDEO,
    DISTRACTOR_VIDEO,
    WORD_BANK,
    SNR_LEVELS,
    ATTENTION_CONDITIONS
  };
})();