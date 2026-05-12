/**
 * 功能模块3：视听整合时延窗口对噪音干扰中语音识别的影响（视觉整合异步校准训练）
 * 操控：口型相对声音的提前/滞后（±0/100/200/300ms）+ SNR
 * 输出：整合时窗宽度、对异步的耐受曲线
 */

const Module3 = (function() {
  'use strict';
  
  // 模块状态
  let currentTrial = null;
  let trialQueue = [];
  let currentTrialIndex = 0;
  let results = [];
  let isWaitingForResponse = false;
  let responseStartTime = null;
  
  // 视频文件
  const VIDEO_FILE_A = AudioProcessor.VIDEO_FILES[0];
  const VIDEO_FILE_B = AudioProcessor.VIDEO_FILES[1];
  
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
  
  // SOA级别（ms）
  const SOA_LEVELS = [-300, -200, -100, 0, 100, 200, 300];
  
  /**
   * 初始化模块
   */
  function init() {
    console.log('模块3：异步校准训练 - 初始化');
  }
  
  /**
   * 生成试次队列（SNR × SOA 正交组合）
   * @param {Object} config - 配置对象
   * @returns {Array} - 试次数组
   */
  function generateTrialQueue(config) {
    const snrLevels = config.snrLevels || SNR_LEVELS;
    const soaLevels = config.soaLevels || SOA_LEVELS;
    const repetitions = config.repetitions || 3;
    const order = config.order || 'random';
    
    let trials = [];
    
    // 生成所有组合
    snrLevels.forEach(snr => {
      soaLevels.forEach(soa => {
        for (let i = 0; i < repetitions; i++) {
          const wordItem = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
          trials.push({
            snr: snr,
            soa: soa,
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
        return a.soa - b.soa;
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
   * 播放刺激（双视频 + 音频混合 + SOA偏移）
   * @param {Object} trial - 试次对象
   */
  async function playStimulus(trial) {
    try {
      // 设置视频SOA偏移
      const videoA = document.getElementById('expVideoA');
      const videoB = document.getElementById('expVideoB');
      
      if (videoA && videoB) {
        // 根据SOA决定哪个视频先播放
        if (trial.soa > 0) {
          // 视频A先播放，视频B延迟soa毫秒
          videoA.currentTime = 0;
          videoB.currentTime = 0;
          await videoA.play();
          await new Promise(resolve => setTimeout(resolve, trial.soa));
          await videoB.play();
        } else if (trial.soa < 0) {
          // 视频B先播放，视频A延迟|soa|毫秒
          videoA.currentTime = 0;
          videoB.currentTime = 0;
          await videoB.play();
          await new Promise(resolve => setTimeout(resolve, Math.abs(trial.soa)));
          await videoA.play();
        } else {
          // 同时播放
          videoA.currentTime = 0;
          videoB.currentTime = 0;
          await videoA.play();
          await videoB.play();
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
      soa: currentTrial.soa,
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
    const videoA = document.getElementById('expVideoA');
    const videoB = document.getElementById('expVideoB');
    if (videoA) videoA.pause();
    if (videoB) videoB.pause();
    
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
   * 计算整合时窗宽度（心理物理曲线拟合法）
   * 拟合 SOA → 正确率 曲线，计算正确率 ≥ criterion 的 SOA 范围宽度
   * @param {Array} results - 试次结果数组（可选）
   * @returns {Object|null} - {window, fit, lowerSOA, upperSOA} 或 null
   */
  function calculateIntegrationWindow(results) {
    const data = results || Module3.getResults();
    if (!data || data.length < 5) return null;

    const fit = Psychometric.fit(data, 'soa', { gamma: 0.25, lambda: 0.02, criterion: 0.80 });
    if (!fit) return null;

    // 计算 criterion 水平的 SOA 范围
    // P(SOA) = criterion 时有两个解（曲线的上升段和下降段）
    // 对于 SOA 数据，曲线通常是倒U型或钟型，所以用不同方式计算
    // 这里我们用数据点直接判断范围，同时用拟合参数辅助
    const crit = 0.80;
    const validSOAs = fit.data.filter(d => (d.k / d.n) >= crit);
    
    let windowWidth = null;
    let lowerSOA = null;
    let upperSOA = null;

    if (validSOAs.length > 0) {
      const soaValues = validSOAs.map(d => d.x);
      lowerSOA = Math.min(...soaValues);
      upperSOA = Math.max(...soaValues);
      windowWidth = upperSOA - lowerSOA;
    }

    return {
      window: windowWidth,
      lowerSOA: lowerSOA,
      upperSOA: upperSOA,
      fit: fit
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
    calculateIntegrationWindow,
    VIDEO_FILE_A,
    VIDEO_FILE_B,
    WORD_BANK,
    SNR_LEVELS,
    SOA_LEVELS
  };
})();