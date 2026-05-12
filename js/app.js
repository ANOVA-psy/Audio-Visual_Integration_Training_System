/**
 * 主应用逻辑
 * 负责：屏幕切换、状态管理、整合所有模块、修复原代码bug
 */

(function() {
  'use strict';
  
  // ==================== 全局状态 ====================
  const STATE = {
    subjectId: 'S001',
    phase: 'train', // pre/train/post
    func: 1, // 1-4
    snrMode: 'adaptive', // adaptive/fixed/combinatorial
    
    // 试次相关
    trialQueue: [],
    currentTrialIndex: 0,
    results: [],
    isPlaying: false,
    isWaitingForResponse: false,
    responseStartTime: null,
    
    // 自适应算法
    adaptive: {
      streak: 0,
      currentSNR: 0,
      reversals: [],
      reversalSNRs: [],
      trialCount: 0,
      maxReversals: 8,
      isRunning: false
    },
    
    // 音频
    audioContext: null,
    noiseBuffer: null,
    
    // 历史记录
    history: []
  };
  
  // ==================== 初始化 ====================
  document.addEventListener('DOMContentLoaded', () => {
    console.log('视听语音整合训练系统 v3.0 - 初始化');
    
    // 初始化所有模块
    Module1.init();
    Module2.init();
    Module3.init();
    Module4.init();
    
    // 设置日期
    const dateInput = document.getElementById('expDate');
    if (dateInput) {
      dateInput.value = UIHelper.formatDate();
    }
    
    // 绑定事件
    bindEvents();
    
    // 显示主菜单
    UIHelper.showScreen('menu');
    
    console.log('初始化完成 (Config ✓, Staircase ✓, EventLogger ✓)');
  });
  
  // ==================== 事件绑定 ====================
  function bindEvents() {
    // 主菜单
    const subjectIdInput = document.getElementById('subjectId');
    if (subjectIdInput) {
      subjectIdInput.addEventListener('input', updateConfigSummary);
    }
    
    // 键盘快捷键
    document.addEventListener('keydown', handleKeyPress);

    // ★ 实验材料设置变化时立即刷新试次统计
    bindSettingChangeListeners();
  }

  function bindSettingChangeListeners() {
    // SNR复选框变化
    document.addEventListener('change', function(e) {
      if (e.target.matches('.snr-lvl, .blur-lvl, .soa-lvl, .att-lvl')) {
        updateTrialSummary();
      }
      // 重复次数输入变化
      if (e.target.matches('#snrReps, #blurReps, #soaReps')) {
        updateTrialSummary();
      }
    });
    // 重复次数输入（input事件，实时响应）
    document.addEventListener('input', function(e) {
      if (e.target.matches('#snrReps, #blurReps, #soaReps')) {
        updateTrialSummary();
      }
    });
  }
  
  // ==================== 主菜单 ====================
  window.selectPhase = function(phase) {
    STATE.phase = phase;
    
    // 更新UI
    ['pre', 'train', 'post'].forEach(p => {
      const el = document.getElementById(`phase_${p}`);
      if (el) {
        el.className = `phase-btn px-4 py-3 rounded-xl border-2 ${
          p === phase ? 'border-primary bg-blue-50 active' : 'border-gray-200 hover:border-primary'
        } text-center`;
      }
    });
    
    updateConfigSummary();
  };
  
  window.selectFunc = function(func) {
    STATE.func = func;
    
    // 更新UI
    [1, 2, 3, 4].forEach(f => {
      const el = document.getElementById(`func${f}`);
      if (el) {
        el.className = `func-btn p-4 rounded-xl border-2 ${
          f === func ? 'border-primary bg-blue-50' : 'border-gray-200 hover:border-primary'
        } text-center`;
      }
    });
    
    updateConfigSummary();
  };
  
  function updateConfigSummary() {
    const phaseNames = { pre: '训练前测试', train: '训练中', post: '训练后测试' };
    const funcNames = { 1: '功能一（抗干扰）', 2: '功能二（视觉整合）', 3: '功能三（异步校准）', 4: '功能四（注意定位）' };
    
    const cfgText = document.getElementById('cfgText');
    if (cfgText) {
      const subjectId = document.getElementById('subjectId')?.value || 'S001';
      cfgText.textContent = `${funcNames[STATE.func]} | ${phaseNames[STATE.phase]} | 被试 ${subjectId}`;
    }
  }
  
  // ==================== 材料准备 ====================
  window.goToPreparation = function() {
    STATE.subjectId = document.getElementById('subjectId')?.value || 'S001';
    
    UIHelper.showScreen('prep');
    updatePreparationUI();
  };
  
  function updatePreparationUI() {
    const funcNames = ['', '功能一：抗干扰训练', '功能二：视觉整合训练', '功能三：异步校准训练', '功能四：注意定位训练'];
    const phaseNames = { pre: '训练前测试', train: '训练中', post: '训练后测试' };
    
    // 更新标题
    const prepTitle = document.getElementById('prepTitle');
    if (prepTitle) {
      prepTitle.textContent = `材料准备 · ${funcNames[STATE.func]}`;
    }
    
    const prepSubtitle = document.getElementById('prepSubtitle');
    if (prepSubtitle) {
      prepSubtitle.textContent = `${phaseNames[STATE.phase]}阶段`;
    }
    
    const phaseIndicator = document.getElementById('phaseIndicator');
    if (phaseIndicator) {
      phaseIndicator.textContent = phaseNames[STATE.phase];
    }
    
    // 显示/隐藏变量控制区域
    const varSNR = document.getElementById('varSNR');
    const varBlur = document.getElementById('varBlur');
    const varSOA = document.getElementById('varSOA');
    const varAtt = document.getElementById('varAtt');
    
    if (varSNR) varSNR.classList.remove('hidden');
    if (varBlur) varBlur.classList.toggle('hidden', STATE.func !== 2 && STATE.func !== 3);
    if (varSOA) varSOA.classList.toggle('hidden', STATE.func !== 3);
    if (varAtt) varAtt.classList.toggle('hidden', STATE.func !== 4);
    
    // 更新预览
    updatePreview();
    updateTrialSummary();
  }
  
  // ==================== 预览功能 ====================
  let previewPlaying = false;
  
  function updatePreview() {
    const preview1 = document.getElementById('preview1');
    const preview2 = document.getElementById('preview2');
    const preview3 = document.getElementById('preview3');
    const preview4 = document.getElementById('preview4');
    
    // 隐藏所有预览
    if (preview1) preview1.classList.add('hidden');
    if (preview2) preview2.classList.add('hidden');
    if (preview3) preview3.classList.add('hidden');
    if (preview4) preview4.classList.add('hidden');
    
    // 设置视频源
    setupPreviewVideoSources();
    
    // 显示当前功能的预览
    if (STATE.func === 1 && preview1) {
      preview1.classList.remove('hidden');
    } else if (STATE.func === 2 && preview2) {
      preview2.classList.remove('hidden');
      updateModule2Preview();
    } else if (STATE.func === 3 && preview3) {
      preview3.classList.remove('hidden');
      updateModule3Preview();
    } else if (STATE.func === 4 && preview4) {
      preview4.classList.remove('hidden');
      updateModule4Preview();
    }
  }
  
   function setupPreviewVideoSources() {
    // ★★★ 关键修复：设置 source.src 后必须调用 videoElement.load()

    // 功能2预览视频
    const previewVideo2 = document.getElementById('previewVideo');
    const src2 = document.getElementById('previewSrc');
    if (src2) src2.src = AudioProcessor.VIDEO_FILES[0];
    if (previewVideo2) previewVideo2.load(); // ← 加这行

    // 功能3预览视频
    const previewVideoA = document.getElementById('previewVideoA');
    const previewVideoB = document.getElementById('previewVideoB');
    const src3A = document.getElementById('previewSrcA');
    const src3B = document.getElementById('previewSrcB');
    if (src3A) src3A.src = AudioProcessor.VIDEO_FILES[0];
    if (src3B) src3B.src = AudioProcessor.VIDEO_FILES[1];
    if (previewVideoA) previewVideoA.load(); // ← 加这行
    if (previewVideoB) previewVideoB.load(); // ← 加这行

    // 功能4预览视频
    const previewMain = document.getElementById('previewMain');
    const previewDist = document.getElementById('previewDist');
    const src4Main = document.getElementById('previewMainSrc');
    const src4Dist = document.getElementById('previewDistSrc');
    if (src4Main) src4Main.src = AudioProcessor.VIDEO_FILES[0];
    if (src4Dist) src4Dist.src = AudioProcessor.VIDEO_FILES[1];
    if (previewMain) previewMain.load(); // ← 加这行
    if (previewDist) previewDist.load(); // ← 加这行
  }

  
  function updateModule2Preview() {
    // 功能2预览：视频 + 模糊度
    const video = document.getElementById('previewVideo');
    const blurSlider = document.getElementById('previewBlurSlider');
    
    if (video && video.readyState >= 2) {
      const blurValue = blurSlider ? blurSlider.value : 0;
      video.style.filter = blurValue > 0 ? `blur(${blurValue * 0.5}px)` : 'none';
    }
  }
  
  function updateModule3Preview() {
    // 功能3预览：双视频 + SOA偏移
    const soaSlider = document.getElementById('previewSOASlider');
    
    if (soaSlider) {
      const soaValue = parseInt(soaSlider.value);
      const soaText = document.getElementById('prev3SOAText');
      if (soaText) {
        soaText.textContent = `SOA: ${soaValue > 0 ? '+' : ''}${soaValue} ms`;
      }
    }
  }
  
  function updateModule4Preview() {
    // 功能4预览：目标说话人 + 干扰说话人
    console.log('更新功能4预览');
  }
  
  window.playPreview = async function() {
    if (previewPlaying) {
      // 如果正在播放，停止
      AudioProcessor.stopAllAudio();
      stopAllPreviewVideos();
      previewPlaying = false;
      updatePreviewButton(false);
      return;
    }
    
    try {
      previewPlaying = true;
      updatePreviewButton(true);
      
      // 根据当前功能播放预览
      if (STATE.func === 1) {
        const snrSlider = document.getElementById('previewSNRSlider');
        const snr = snrSlider ? parseInt(snrSlider.value) : 0;
        await AudioProcessor.playPreviewMixed(snr);
      } else if (STATE.func === 2) {
        const video = document.getElementById('previewVideo');
        if (video) {
          video.currentTime = 0;
          await video.play();
        }
        const snrSlider = document.getElementById('previewSNRSlider');
        const snr = snrSlider ? parseInt(snrSlider.value) : 0;
        await AudioProcessor.playPreviewMixed(snr);
      } else if (STATE.func === 3) {
        const videoA = document.getElementById('previewVideoA');
        const videoB = document.getElementById('previewVideoB');
        if (videoA) { videoA.currentTime = 0; await videoA.play(); }
        if (videoB) { videoB.currentTime = 0; await videoB.play(); }
        const snrSlider = document.getElementById('previewSNRSlider');
        const snr = snrSlider ? parseInt(snrSlider.value) : 0;
        await AudioProcessor.playPreviewMixed(snr);
      } else if (STATE.func === 4) {
        const videoMain = document.getElementById('previewMain');
        const videoDist = document.getElementById('previewDist');
        if (videoMain) { videoMain.currentTime = 0; await videoMain.play(); }
        if (videoDist) { videoDist.currentTime = 0; await videoDist.play(); }
        const snrSlider = document.getElementById('previewSNRSlider');
        const snr = snrSlider ? parseInt(snrSlider.value) : 0;
        await AudioProcessor.playPreviewMixed(snr);
      }
      
      // 播放完成后恢复按钮状态
      previewPlaying = false;
      updatePreviewButton(false);
      
    } catch (error) {
      console.error('[Preview] 预览播放失败:', error);
      AudioProcessor.stopAllAudio();
      stopAllPreviewVideos();
      previewPlaying = false;
      updatePreviewButton(false);
      UIHelper.showNotification('预览播放失败: ' + error.message, 'error');
    }
  };
  
  function updatePreviewButton(isPlaying) {
    // 更新所有预览按钮文本
    const buttons = document.querySelectorAll('[onclick="playPreview()"]');
    buttons.forEach(btn => {
      if (isPlaying) {
        btn.textContent = '⏹️ 停止预览';
        btn.classList.remove('bg-primary');
        btn.classList.add('bg-red-500');
      } else {
        btn.textContent = '▶️ 播放预览';
        btn.classList.remove('bg-red-500');
        btn.classList.add('bg-primary');
      }
    });
  }
  
  function stopAllPreviewVideos() {
    const videoIds = ['previewVideo', 'previewVideoA', 'previewVideoB', 'previewMain', 'previewDist'];
    videoIds.forEach(id => {
      const v = document.getElementById(id);
      if (v) v.pause();
    });
  }
  
  // ==================== 试次生成 ====================
  function updateTrialSummary() {
    // 计算试次总数
    let totalTrials = 0;
    let detail = '';
    
    const snrLevels = getSelectedValues('.snr-lvl');
    const blurLevels = getSelectedValues('.blur-lvl');
    const soaLevels = getSelectedValues('.soa-lvl');
    const attLevels = getSelectedValues('.att-lvl');
    
    const snrReps = parseInt(document.getElementById('snrReps')?.value) || 3;
    const blurReps = parseInt(document.getElementById('blurReps')?.value) || 3;
    const soaReps = parseInt(document.getElementById('soaReps')?.value) || 3;
    
    if (STATE.func === 1) {
      totalTrials = snrLevels.length * snrReps;
      detail = `SNR: ${snrLevels.length}档 × ${snrReps}次 = ${totalTrials}试次`;
    } else if (STATE.func === 2) {
      const combinations = snrLevels.length * blurLevels.length;
      const reps = Math.max(snrReps, blurReps);
      totalTrials = combinations * reps;
      detail = `SNR(${snrLevels.length}) × 模糊度(${blurLevels.length}) × ${reps}次 = ${totalTrials}试次`;
    } else if (STATE.func === 3) {
      const combinations = snrLevels.length * blurLevels.length * soaLevels.length;
      const reps = Math.max(snrReps, blurReps, soaReps);
      totalTrials = combinations * reps;
      detail = `SNR(${snrLevels.length}) × 模糊度(${blurLevels.length}) × SOA(${soaLevels.length}) × ${reps}次 = ${totalTrials}试次`;
    } else if (STATE.func === 4) {
      const combinations = snrLevels.length * attLevels.length;
      totalTrials = combinations * snrReps;
      detail = `SNR(${snrLevels.length}) × 注意条件(${attLevels.length}) × ${snrReps}次 = ${totalTrials}试次`;
    }
    
    const previewTotal = document.getElementById('previewTotal');
    if (previewTotal) {
      previewTotal.textContent = totalTrials;
    }
    
    const summaryText = document.getElementById('summaryText');
    if (summaryText) {
      summaryText.textContent = detail;
    }
  }
  
  function getSelectedValues(selector) {
    const elements = document.querySelectorAll(selector);
    return Array.from(elements)
      .filter(el => el.checked)
      .map(el => parseInt(el.value));
  }
  
  // ==================== 生成程序 ====================
  window.generateTrials = function() {
    UIHelper.showLoading('正在生成试次...');
    
    try {
      // 获取配置
      const config = {
        snrLevels: getSelectedValues('.snr-lvl'),
        blurLevels: getSelectedValues('.blur-lvl'),
        soaLevels: getSelectedValues('.soa-lvl'),
        attLevels: getSelectedValues('.att-lvl'),
        repetitions: parseInt(document.getElementById('snrReps')?.value) || 3,
        order: 'random' // 默认随机
      };
      
      // 根据功能模块生成试次
      let trials = [];
      
      if (STATE.func === 1) {
        trials = Module1.generateTrialQueue(config);
      } else if (STATE.func === 2) {
        trials = Module2.generateTrialQueue(config);
      } else if (STATE.func === 3) {
        trials = Module3.generateTrialQueue(config);
      } else if (STATE.func === 4) {
        trials = Module4.generateTrialQueue(config);
      }
      
      STATE.trialQueue = trials;
      STATE.currentTrialIndex = 0;
      STATE.results = [];
      
      // 初始化自适应算法（如果需要）
      if (STATE.snrMode === 'adaptive') {
        initAdaptiveAlgorithm();
      }
      
      updateTrialSummary();
      
      UIHelper.hideLoading();
      UIHelper.showNotification(`已生成 ${trials.length} 个试次`, 'success');
      
      // 跳转到生成完成页面
      UIHelper.showScreen('generate');
      updateGenerateUI(trials.length);
      
    } catch (error) {
      console.error('生成试次失败:', error);
      UIHelper.hideLoading();
      UIHelper.showNotification('生成试次失败: ' + error.message, 'error');
    }
  };
  
  function initAdaptiveAlgorithm() {
    const snrLevels = getSelectedValues('.snr-lvl');
    STATE.adaptive = {
      streak: 0,
      currentSNR: snrLevels.includes(0) ? 0 : snrLevels[Math.floor(snrLevels.length / 2)],
      reversals: [],
      reversalSNRs: [],
      trialCount: 0,
      maxReversals: 8,
      isRunning: false
    };
  }
  
  function updateGenerateUI(trialCount) {
    const generateCount = document.getElementById('generateCount');
    if (generateCount) {
      generateCount.textContent = trialCount;
    }
    
    // ✅ 动态生成实验设置摘要
    const funcNames = {
      1: '功能一：抗干扰训练',
      2: '功能二：视觉整合训练',
      3: '功能三：异步校准训练',
      4: '功能四：注意定位训练'
    };
    const phaseNames = { pre: '训练前测试', train: '训练中', post: '训练后测试' };
    
    const snrLevels = getSelectedValues('.snr-lvl');
    const blurLevels = getSelectedValues('.blur-lvl');
    const soaLevels = getSelectedValues('.soa-lvl');
    const attLevels = getSelectedValues('.att-lvl');
    
    // 实验设置列表
    const settingsList = document.getElementById('expSettingsList');
    if (settingsList) {
      const settingsHTML = [];
      
      // 基本信息
      settingsHTML.push(`<li><strong>功能模块：</strong>${funcNames[STATE.func]}</li>`);
      settingsHTML.push(`<li><strong>实验阶段：</strong>${phaseNames[STATE.phase]}</li>`);
      settingsHTML.push(`<li><strong>被试ID：</strong>${STATE.subjectId}</li>`);
      settingsHTML.push(`<li><strong>呈现顺序：</strong>${STATE.snrMode === 'adaptive' ? '自适应' : '随机'}</li>`);
      
      settingsList.innerHTML = settingsHTML.join('');
    }
    
    // 实验参数列表
    const paramsList = document.getElementById('expParamsList');
    if (paramsList) {
      const paramsHTML = [];
      
      // SNR级别
      const snrText = snrLevels.length === 7 ? '全部7档 (-18~+9dB)' : `${snrLevels.length}档 (${snrLevels.sort((a,b)=>b-a).join(', ')} dB)`;
      paramsHTML.push(`<li><strong>SNR级别：</strong>${snrText}</li>`);
      
      // 功能特定参数
      if (STATE.func === 2 && blurLevels.length > 0) {
        const blurText = blurLevels.length === 7 ? '全部7档 (0~60%)' : `${blurLevels.length}档`;
        paramsHTML.push(`<li><strong>模糊度：</strong>${blurText}</li>`);
      }
      
      if (STATE.func === 3 && soaLevels.length > 0) {
        const soaText = soaLevels.length === 11 ? '全部11档 (-300~+300ms)' : `${soaLevels.length}档`;
        paramsHTML.push(`<li><strong>视听SOA：</strong>${soaText}</li>`);
      }
      
      if (STATE.func === 4 && attLevels.length > 0) {
        const attText = attLevels.map(a => a === 'single' ? '单说话人' : '双说话人').join(', ');
        paramsHTML.push(`<li><strong>注意条件：</strong>${attText}</li>`);
      }
      
      // 算法信息
      if (STATE.snrMode === 'adaptive') {
        paramsHTML.push(`<li><strong>算法：</strong>1-up/3-down 自适应</li>`);
        paramsHTML.push(`<li><strong>目标正确率：</strong>≥ 80%</li>`);
        paramsHTML.push(`<li><strong>停止条件：</strong>反转8次后停止</li>`);
      }
      
      paramsList.innerHTML = paramsHTML.join('');
    }
  }
  
  // ==================== 开始实验 ====================
  window.startExperiment = function() {
    // ★ 启动事件记录
    EventLogger.startSession({
      subjectId: STATE.subjectId,
      phase: STATE.phase,
      func: STATE.func
    });

    UIHelper.showScreen('exp');
    updateExperimentUI();
    
    // 设置实验中的视频源
    setupExperimentVideoSources();
    
    // 开始第一个试次
    startNextTrial();
  };
  
    function setupExperimentVideoSources() {
    // ★★★ 关键修复：设置 source.src 后必须调用 videoElement.load()

    // 功能2实验视频
    const expVideo = document.getElementById('expVideo');
    const expSrc = document.getElementById('expVideoSrc');
    if (expSrc) expSrc.src = AudioProcessor.VIDEO_FILES[0];
    if (expVideo) expVideo.load(); // ← 加这行

    // 功能3实验视频
    const expVideoA = document.getElementById('expVideoA');
    const expVideoB = document.getElementById('expVideoB');
    const expSrcA = document.getElementById('expSrcA');
    const expSrcB = document.getElementById('expSrcB');
    if (expSrcA) expSrcA.src = AudioProcessor.VIDEO_FILES[0];
    if (expSrcB) expSrcB.src = AudioProcessor.VIDEO_FILES[1];
    if (expVideoA) expVideoA.load(); // ← 加这行
    if (expVideoB) expVideoB.load(); // ← 加这行

    // 功能4实验视频
    const expVideoTarget = document.getElementById('expVideoTarget');
    const expVideoDist = document.getElementById('expVideoDist');
    const expTargetSrc = document.getElementById('expTargetSrc');
    const expDistSrc = document.getElementById('expDistSrc');
    if (expTargetSrc) expTargetSrc.src = AudioProcessor.VIDEO_FILES[0];
    if (expDistSrc) expDistSrc.src = AudioProcessor.VIDEO_FILES[1];
    if (expVideoTarget) expVideoTarget.load(); // ← 加这行
    if (expVideoDist) expVideoDist.load(); // ← 加这行
  }

  
  function updateExperimentUI() {
    const funcNames = ['', '功能一', '功能二', '功能三', '功能四'];
    const phaseNames = { pre: '训练前测试', train: '训练中', post: '训练后测试' };
    
    const expTitleBar = document.getElementById('expTitleBar');
    if (expTitleBar) {
      expTitleBar.textContent = `${funcNames[STATE.func]} · ${phaseNames[STATE.phase]}`;
    }
    
    // 显示/隐藏实验视图
    [1, 2, 3, 4].forEach(f => {
      const view = document.getElementById(`expView${f}`);
      if (view) {
        view.classList.toggle('hidden', f !== STATE.func);
      }
    });
  }
  
  async function startNextTrial() {
    if (STATE.currentTrialIndex >= STATE.trialQueue.length) {
      // 所有试次完成
      showResults();
      return;
    }
    
    try {
      // 重置反馈显示
      resetFeedback();
      
      let trial = null;
      
      // 从队列中获取试次数据（不调用模块的nextTrial，避免重复打乱）
      trial = STATE.trialQueue[STATE.currentTrialIndex];
      
      // 如果试次还没有shuffledChoices（首次显示），进行打乱
      if (!trial.shuffledChoices) {
        const correctAnswer = trial.correctAnswer;
        const otherChoices = trial.choices.filter(c => c !== correctAnswer);
        // Fisher-Yates洗牌
        for (let i = otherChoices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [otherChoices[i], otherChoices[j]] = [otherChoices[j], otherChoices[i]];
        }
        trial.shuffledChoices = [
          otherChoices[0] || correctAnswer,
          otherChoices[1] || correctAnswer,
          correctAnswer,  // C位始终是正确答案
          otherChoices[2] || correctAnswer
        ];
        trial.correctIndex = 2;
      }
      
      if (!trial) {
        showResults();
        return;
      }
      
      // 更新UI显示试次信息
      updateTrialUI(trial);
      
      // 重置状态：等待用户点击播放
      STATE.isWaitingForResponse = false;
      STATE.isPlaying = false;
      STATE.responseStartTime = null;
      
      // 选项按钮初始禁用（等点击播放按钮后才启用）
      enableChoiceButtons(false);
      
    } catch (error) {
      console.error('开始试次失败:', error);
      UIHelper.showNotification('开始试次失败', 'error');
    }
  }
  
  function resetFeedback() {
    const feedback = document.getElementById('expFeedback');
    const feedbackText = document.getElementById('expFeedbackText');
    if (feedback) {
      feedback.classList.add('hidden');
      feedback.className = 'mt-3 p-3 rounded-xl text-center hidden';
    }
    if (feedbackText) {
      feedbackText.textContent = '';
    }
  }
  
  function updateTrialUI(trial) {
    // 更新进度
    const progressText = document.getElementById('expProgressText');
    if (progressText) {
      progressText.textContent = `试次 ${STATE.currentTrialIndex + 1} / ${STATE.trialQueue.length}`;
    }
    
    const progressBar = document.getElementById('expProgressBar');
    if (progressBar) {
      const percent = ((STATE.currentTrialIndex + 1) / STATE.trialQueue.length) * 100;
      progressBar.style.width = `${percent}%`;
    }
    
    // 更新条件显示
    const conditionText = document.getElementById('expConditionText');
    if (conditionText && trial) {
      let text = '';
      if (STATE.func === 1) {
        text = `SNR: ${trial.snr} dB`;
      } else if (STATE.func === 2) {
        text = `SNR: ${trial.snr} dB | 模糊度: ${trial.blur}%`;
      } else if (STATE.func === 3) {
        text = `SNR: ${trial.snr} dB | SOA: ${trial.soa} ms`;
      } else if (STATE.func === 4) {
        text = `SNR: ${trial.snr} dB | ${trial.attention === 'dual' ? '双说话人' : '单说话人'}`;
      }
      conditionText.textContent = `条件：${text}`;
    }
    
    // 更新选项按钮
    updateChoiceButtons(trial);
  }
  
  // ==================== 修复关键Bug：选项按钮 ====================
  function updateChoiceButtons(trial) {
    if (!trial) return;
    
    const choices = trial.shuffledChoices || trial.choices || [];
    const buttons = document.querySelectorAll('#expChoices button');
    
    buttons.forEach((btn, index) => {
      if (index < choices.length) {
        // ✅ 修复：正确设置按钮文本和事件
        btn.textContent = `${String.fromCharCode(65 + index)}. ${choices[index]}`;
        btn.disabled = true; // 初始禁用，等待播放后启用
        btn.className = 'choice-btn w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-left font-medium';
        
        // ✅ 修复：使用闭包正确捕获index
        btn.onclick = (function(idx) {
          return function() {
            submitAnswer(idx);
          };
        })(index);
      }
    });
    
    // 更新问题文本
    const question = document.getElementById('expQuestion');
    if (question) {
      const questions = {
        1: '请仔细听音频，选择正确词语：',
        2: '请结合口型信息，选择正确词语：',
        3: '请注意两个说话人的同步关系：',
        4: '请定位目标说话人内容：'
      };
      question.textContent = questions[STATE.func] || '请选择正确答案：';
    }
  }
  
  // ==================== 播放刺激 ====================
  window.expPlay = async function() {
    // ★ 强制重置所有播放状态，防止上一个试次的异步操作残留
    STATE.isPlaying = false;
    STATE.isWaitingForResponse = false;
    AudioProcessor.stopAllAudio();
    stopAllVideos();
    
    try {
      STATE.isPlaying = true;
      STATE.responseStartTime = Date.now();
      
      const trial = STATE.trialQueue[STATE.currentTrialIndex] || STATE.trialQueue[0];
      
      if (!trial) {
        throw new Error('没有当前试次');
      }
      
      // 更新播放按钮状态
      updatePlayButton(true);
      
      // ★ 立即启用选项按钮，让被试在播放过程中就可以选择
      STATE.isWaitingForResponse = true;
      enableChoiceButtons(true);

      // ★ 在播放开始时更新SNR等条件显示
      updateExpConditionDisplay(trial);

      // ★ 记录播放事件
      EventLogger.user('click_play', {
        trial: STATE.currentTrialIndex + 1,
        snr: trial.snr,
        blur: trial.blur,
        soa: trial.soa,
        attention: trial.attention
      });

      // 根据功能模块播放刺激
      if (STATE.func === 1) {
        await AudioProcessor.playMixedAudio(trial.word, trial.snr);
      } else if (STATE.func === 2) {
        const video = document.getElementById('expVideo');
        if (video) {
          video.currentTime = 0;
          video.style.filter = trial.blur > 0 ? `blur(${trial.blur * Config.BLUR_CSS_FACTOR}px)` : 'none';
          await video.play();
        }
        await AudioProcessor.playMixedAudio(trial.word, trial.snr);
      } else if (STATE.func === 3) {
        // ★ 功能3：基于 AudioContext.currentTime 的精确 SOA 同步
        await playWithSOA(trial);
      } else if (STATE.func === 4) {
        const targetVideo = document.getElementById('expVideoTarget');
        if (targetVideo) {
          targetVideo.currentTime = 0;
          await targetVideo.play();
        }
        
        if (trial.attention === 'dual') {
          const distractorVideo = document.getElementById('expVideoDist');
          if (distractorVideo) {
            distractorVideo.currentTime = 0;
            await distractorVideo.play();
          }
        }
        
        await AudioProcessor.playMixedAudio(trial.word, trial.snr);
      }
      
      // 音频播放完毕后恢复按钮状态
      STATE.isPlaying = false;
      updatePlayButton(false);
      
      // 如果用户还没选答案，继续等待（不改变isWaitingForResponse）
      // 设置超时
      setTimeout(() => {
        if (STATE.isWaitingForResponse) {
          EventLogger.user('timeout', { trial: STATE.currentTrialIndex + 1 });
          submitAnswer(-1); // 超时
        }
      }, Config.RESPONSE_TIMEOUT);
      
    } catch (error) {
      console.error('播放刺激失败:', error);
      STATE.isPlaying = false;
      STATE.isWaitingForResponse = false;
      updatePlayButton(false);
      EventLogger.system('play_error', { error: error.message });
      UIHelper.showNotification('播放刺激失败', 'error');
    }
  };
  
  /**
   * 功能3专用：基于 AudioContext.currentTime 的毫秒级音画同步
   *
   * 实现方案：
   * 1. 预加载音频为 AudioBuffer（已在 AudioProcessor 中缓存）
   * 2. 视频先播放（HTML5 video，无法精确控制开始时间）
   * 3. 在 video.play() resolve 后，使用 setTimeout 精确偏移音频
   *    （浏览器对 HTML5 video 的 currentTime 精度约 ±20ms）
   * 4. 音频通过 AudioProcessor.playMixedAudioAt() 在精确的延迟后播放
   *
   * @param {Object} trial - 当前试次
   */
  async function playWithSOA(trial) {
    const videoA = document.getElementById('expVideoA');
    const videoB = document.getElementById('expVideoB');
    const soa = trial.soa || 0;

    if (!videoA || !videoB) {
      // 降级：无视频时直接播放音频
      await AudioProcessor.playMixedAudio(trial.word, trial.snr);
      return;
    }

    videoA.currentTime = 0;
    videoB.currentTime = 0;

    EventLogger.stimulus('soa_start', { soa: soa, trial: STATE.currentTrialIndex + 1 });

    if (soa > 0) {
      // 视频 A 先播放，视频 B 延迟 soa 毫秒，音频与视频 B 同步
      await videoA.play();
      await new Promise(resolve => setTimeout(resolve, soa));
      await videoB.play();
      await AudioProcessor.playMixedAudio(trial.word, trial.snr);
    } else if (soa < 0) {
      // 视频 B 先播放，视频 A 延迟 |soa| 毫秒
      await videoB.play();
      await new Promise(resolve => setTimeout(resolve, Math.abs(soa)));
      await videoA.play();
      await AudioProcessor.playMixedAudio(trial.word, trial.snr);
    } else {
      // SOA = 0：同时播放
      await Promise.all([videoA.play(), videoB.play()]);
      await AudioProcessor.playMixedAudio(trial.word, trial.snr);
    }

    EventLogger.stimulus('soa_complete', { soa: soa });
  }

  function updatePlayButton(isPlaying) {
    const btnIds = ['exp1PlayBtn', 'exp2PlayBtn', 'exp3PlayBtn', 'exp4PlayBtn'];
    btnIds.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.disabled = isPlaying;
        btn.classList.toggle('opacity-50', isPlaying);
        if (isPlaying) {
          btn.textContent = '🔊 播放中...';
        } else {
          btn.textContent = STATE.func === 1 ? '▶️ 播放音频（空格）' :
                           STATE.func === 3 ? '▶️ 同步播放（空格）' :
                           '▶️ 播放（空格）';
        }
      }
    });
  }

  function updateExpConditionDisplay(trial) {
    // 功能2：更新SNR和模糊度显示
    if (STATE.func === 2) {
      const exp2SNR = document.getElementById('exp2SNR');
      const exp2Blur = document.getElementById('exp2Blur');
      if (exp2SNR) exp2SNR.textContent = trial.snr + ' dB';
      if (exp2Blur) exp2Blur.textContent = trial.blur + '%';
    }
    // 功能3：更新SOA显示
    if (STATE.func === 3) {
      const exp3SOA = document.getElementById('exp3SOA');
      if (exp3SOA) exp3SOA.textContent = trial.soa + ' ms';
    }
    // 功能4：更新注意条件和SNR显示
    if (STATE.func === 4) {
      const exp4Att = document.getElementById('exp4Att');
      const exp4SNR = document.getElementById('exp4SNR');
      if (exp4Att) exp4Att.textContent = trial.attention === 'single' ? '单说话人' : '双说话人';
      if (exp4SNR) exp4SNR.textContent = trial.snr + ' dB';
    }
    // 功能1：更新SNR显示
    if (STATE.func === 1) {
      const expSNRDisplay = document.getElementById('expSNRDisplay');
      if (expSNRDisplay) expSNRDisplay.textContent = trial.snr + ' dB';
    }
  }
  
  function enableChoiceButtons(enabled) {
    const buttons = document.querySelectorAll('#expChoices button');
    buttons.forEach(btn => {
      btn.disabled = !enabled;
      if (!enabled) {
        btn.className = 'choice-btn w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-left font-medium opacity-50';
      } else {
        btn.className = 'choice-btn w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-left font-medium';
      }
    });
  }
  
  // ==================== 提交答案 ====================
  function submitAnswer(selectedIndex) {
    if (!STATE.isWaitingForResponse) return;
    
    try {
      STATE.isWaitingForResponse = false;
      const rt = Date.now() - STATE.responseStartTime;
      
      const trial = STATE.trialQueue[STATE.currentTrialIndex];
      if (!trial) return;
      
      const isCorrect = selectedIndex === trial.correctIndex;
      
      // 记录结果
      const result = {
        trial: STATE.currentTrialIndex + 1,
        snr: trial.snr,
        blur: trial.blur || 0,
        soa: trial.soa || 0,
        attention: trial.attention || 'single',
        correct: isCorrect,
        selectedIndex: selectedIndex,
        correctIndex: trial.correctIndex,
        rt: rt > Config.RT_CEIL ? Config.RT_CEIL : rt,
        choice: selectedIndex >= 0 ? String.fromCharCode(65 + selectedIndex) : 'TIMEOUT',
        timestamp: Date.now()
      };
      
      STATE.results.push(result);
      
      // ★ 立即更新选项按钮样式（高亮正确/错误）
      const buttons = document.querySelectorAll('#expChoices button');
      buttons.forEach((btn, idx) => {
        btn.disabled = true;
        if (idx === trial.correctIndex) {
          btn.className = 'choice-btn w-full p-3 rounded-xl text-left font-bold correct';
        } else if (idx === selectedIndex && !isCorrect) {
          btn.className = 'choice-btn w-full p-3 rounded-xl text-left font-medium wrong';
        } else {
          btn.className = 'choice-btn w-full p-3 rounded-xl text-left font-medium opacity-50';
        }
      });
      
      // ★ 显示反馈（带反应时）
      const feedback = document.getElementById('expFeedback');
      const feedbackText = document.getElementById('expFeedbackText');
      if (feedback && feedbackText) {
        feedback.classList.remove('hidden');
        if (isCorrect) {
          feedback.className = 'mt-3 p-3 rounded-xl text-center bg-green-100';
          feedbackText.textContent = '✅ 正确！ ' + rt + 'ms';
        } else if (selectedIndex === -1) {
          feedback.className = 'mt-3 p-3 rounded-xl text-center bg-gray-200';
          feedbackText.textContent = '⏰ 超时';
        } else {
          feedback.className = 'mt-3 p-3 rounded-xl text-center bg-red-100';
          feedbackText.textContent = '❌ 错误！正确答案是 ' + String.fromCharCode(65 + trial.correctIndex);
        }
      }
      
      // 停止音频和视频
      AudioProcessor.stopAllAudio();
      stopAllVideos();
      STATE.isPlaying = false; // ★ 同步重置，防止下一次expPlay被守卫拦截
      
      // 更新统计
      updateExperimentStats();
      
      // 更新进度
      STATE.currentTrialIndex++;
      
      // 延迟后开始下一个试次（反馈保持可见直到下一个试次）
      setTimeout(() => {
        startNextTrial();
      }, Config.ITI);
      
    } catch (error) {
      console.error('提交答案失败:', error);
    }
  }
  
  function stopAllVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      video.pause();
    });
  }
  
  function updateExperimentStats() {
    const n = STATE.results.length;
    const correctCount = STATE.results.filter(r => r.correct).length;
    const accuracy = n > 0 ? Math.round(correctCount / n * 100) : 0;
    
    const accElement = document.getElementById('eStatAcc');
    if (accElement) {
      accElement.textContent = `${accuracy}%`;
    }
    
    const trialsElement = document.getElementById('eStatTrials');
    if (trialsElement) {
      trialsElement.textContent = n;
    }
  }
  
  // ==================== 结果分析 ====================
  function showResults() {
    // 立即停止所有音频和视频
    AudioProcessor.stopAllAudio();
    stopAllVideos();
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }

    // ★ 结束事件记录
    EventLogger.endSession();

    // ★ 自动保存实验数据到历史记录（无需手动导出）
    if (STATE.results.length > 0) {
      try {
        const fitResult = calculateThreshold();
        const threshold = extractThresholdValue(fitResult);
        const metadata = {
          subjectId: STATE.subjectId,
          phase: STATE.phase,
          func: STATE.func,
          snrMode: STATE.snrMode,
          threshold: threshold,
          fitResult: fitResult,
          eventLog: EventLogger.toJSON() // ★ 保存全量事件日志
        };
        DataManager.saveExperimentData(metadata, STATE.results);

        // ★ 下载JSON文件到本地（按被试ID/阶段/模块命名）
        DataManager.downloadToLocal(metadata, STATE.results, fitResult);
      } catch (err) {
        console.error('[Save] 自动保存失败:', err);
      }
    }

    UIHelper.showScreen('results');
    updateResultsUI();
  }

  function updateResultsUI() {
    const results = STATE.results;
    const n = results.length;

    if (n === 0) return;

    const correctCount = results.filter(r => r.correct).length;
    const accuracy = Math.round(correctCount / n * 100);

    // 更新结果统计
    const rTotal = document.getElementById('rTotal');
    if (rTotal) rTotal.textContent = n;

    const rAcc = document.getElementById('rAcc');
    if (rAcc) rAcc.textContent = `${accuracy}%`;

    // 计算平均反应时
    const validRTs = results.filter(r => r.rt < 10000).map(r => r.rt);
    const avgRT = validRTs.length > 0 ? Math.round(validRTs.reduce((a, b) => a + b, 0) / validRTs.length) : 0;

    const rRT = document.getElementById('rRT');
    if (rRT) rRT.textContent = `${avgRT}ms`;

    // 计算实验时长
    const startTime = results[0].timestamp;
    const endTime = results[results.length - 1].timestamp;
    const durationMin = Math.round((endTime - startTime) / 60000);
    const rDuration = document.getElementById('rDuration');
    if (rDuration) rDuration.textContent = durationMin > 0 ? `${durationMin}min` : '<1min';

    // 更新结果副标题
    const funcNames = { 1: '功能一', 2: '功能二', 3: '功能三', 4: '功能四' };
    const phaseNames = { pre: '训练前测试', train: '训练中', post: '训练后测试' };
    const resSubtitle = document.getElementById('resSubtitle');
    if (resSubtitle) {
      resSubtitle.textContent = `被试 ${STATE.subjectId} · ${funcNames[STATE.func]} · ${phaseNames[STATE.phase]}`;
    }

    // ★ 填充行为数据详情表格
    renderResultsTable();

    // ★ 计算并显示阈值
    renderThreshold();

    // 渲染图表
    renderResultsCharts();
  }

  function renderResultsTable() {
    const results = STATE.results;
    const tbody = document.getElementById('resTableBody');
    const thead = document.getElementById('resTableHead');
    if (!tbody) return;

    // 根据功能模块显示不同的表头
    const funcNames = { 1: '功能一', 2: '功能二', 3: '功能三', 4: '功能四' };
    if (thead) {
      let headerHTML = '<th class="p-2 text-left">试次</th><th class="p-2 text-left">SNR</th>';
      if (STATE.func === 2 || STATE.func === 3) headerHTML += '<th class="p-2 text-left">模糊度</th>';
      if (STATE.func === 3) headerHTML += '<th class="p-2 text-left">SOA</th>';
      if (STATE.func === 4) headerHTML += '<th class="p-2 text-left">注意条件</th>';
      headerHTML += '<th class="p-2 text-left">正确</th><th class="p-2 text-left">反应时</th><th class="p-2 text-left">选择</th>';
      thead.innerHTML = headerHTML;
    }

    // 渲染每行数据
    let rowsHTML = '';
    results.forEach((r, idx) => {
      const correctBadge = r.correct
        ? '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">正确</span>'
        : (r.choice === 'TIMEOUT'
          ? '<span class="px-2 py-0.5 bg-gray-200 text-gray-500 rounded text-xs">超时</span>'
          : '<span class="px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs">错误</span>');

      let row = `<tr class="border-t hover:bg-gray-50">
        <td class="p-2">${r.trial}</td>
        <td class="p-2">${r.snr} dB</td>`;

      if (STATE.func === 2 || STATE.func === 3) {
        row += `<td class="p-2">${r.blur}%</td>`;
      }
      if (STATE.func === 3) {
        row += `<td class="p-2">${r.soa} ms</td>`;
      }
      if (STATE.func === 4) {
        row += `<td class="p-2">${r.attention === 'single' ? '单说话人' : '双说话人'}</td>`;
      }

      row += `<td class="p-2">${correctBadge}</td>
        <td class="p-2">${r.rt < 10000 ? r.rt + 'ms' : '--'}</td>
        <td class="p-2">${r.choice}</td>
      </tr>`;

      rowsHTML += row;
    });

    tbody.innerHTML = rowsHTML;
  }

  function renderThreshold() {
    const fitResult = calculateThreshold();
    const rThreshold = document.getElementById('rThreshold');
    const rThresholdLabel = document.getElementById('rThresholdLabel');
    const rThresholdDesc = document.getElementById('rThresholdDesc');
    if (!rThreshold) return;

    const funcConfig = {
      1: { label: '噪音阈值 (SNR)', unit: 'dB', desc: 'Logistic拟合 80%正确率对应的SNR值' },
      2: { label: '视觉增益', unit: 'dB', desc: '清晰口型阈值 - 模糊口型阈值的SNR差值' },
      3: { label: '整合时窗', unit: 'ms', desc: '正确率≥80%的SOA范围宽度' },
      4: { label: '干扰抑制成本', unit: 'dB', desc: '双说话人阈值 - 单说话人阈值的SNR差值' }
    };

    const info = funcConfig[STATE.func];
    if (rThresholdLabel) rThresholdLabel.textContent = info.label;
    if (rThresholdDesc) rThresholdDesc.textContent = info.desc;

    // 根据模块提取阈值数值
    let thresholdValue = null;
    let extraInfo = '';

    if (fitResult) {
      if (STATE.func === 1) {
        thresholdValue = fitResult.threshold;
        extraInfo = `α=${fitResult.alpha.toFixed(2)} β=${fitResult.beta.toFixed(3)} R²=${fitResult.r2.toFixed(3)}`;
      } else if (STATE.func === 2) {
        thresholdValue = fitResult.gain;
        extraInfo = fitResult.gain !== null
          ? `清晰α=${fitResult.fitClear?.threshold?.toFixed(1)} 模糊α=${fitResult.fitBlur?.threshold?.toFixed(1)}`
          : '';
      } else if (STATE.func === 3) {
        thresholdValue = fitResult.window;
        extraInfo = fitResult.lowerSOA !== null ? `${fitResult.lowerSOA}~${fitResult.upperSOA}ms` : '';
      } else if (STATE.func === 4) {
        thresholdValue = fitResult.cost;
        extraInfo = fitResult.cost !== null
          ? `单α=${fitResult.fitSingle?.threshold?.toFixed(1)} 双α=${fitResult.fitDual?.threshold?.toFixed(1)}`
          : '';
      }
    }

    if (thresholdValue !== null && thresholdValue !== undefined) {
      rThreshold.textContent = `${thresholdValue.toFixed(2)} ${info.unit}`;
      rThreshold.title = extraInfo || info.desc;
      // 显示拟合参数
      const note = document.getElementById('psychCurveNote');
      if (note && extraInfo) {
        note.textContent = `${extraInfo} · P(x) = γ + (1-γ-λ)/(1+e^(-β(x-α))) · Nelder-Mead MLE`;
      }
    } else {
      rThreshold.textContent = '--';
      rThreshold.title = '数据不足以拟合阈值（需要≥2个不同条件各≥3个试次）';
    }
  }
  
  function renderResultsCharts() {
    // 在psychCurve canvas上绘制心理物理曲线
    const fitResult = calculateThreshold();
    const canvas = document.getElementById('psychCurve');
    if (!canvas || !fitResult) return;

    if (STATE.func === 1) {
      Psychometric.drawCurve(canvas, fitResult, {
        title: '功能一：听觉抗干扰心理物理曲线',
        xLabel: 'SNR (dB)',
        yLabel: '正确率',
        lineColor: '#6366f1'
      });
    } else if (STATE.func === 2 && fitResult.fitClear && fitResult.fitBlur) {
      // 双曲线：清晰 vs 模糊
      drawDualCurves(canvas, fitResult.fitClear, fitResult.fitBlur, {
        title: '功能二：视觉增益心理物理曲线',
        xLabel: 'SNR (dB)',
        yLabel: '正确率',
        label1: `清晰口型 (${fitResult.clearBlur}%)`,
        label2: `模糊口型 (${fitResult.maxBlur}%)`,
        color1: '#6366f1',
        color2: '#f59e0b'
      });
    } else if (STATE.func === 3 && fitResult.fit) {
      Psychometric.drawCurve(canvas, fitResult.fit, {
        title: '功能三：视听整合时窗心理物理曲线',
        xLabel: 'SOA (ms)',
        yLabel: '正确率',
        lineColor: '#6366f1'
      });
    } else if (STATE.func === 4 && fitResult.fitSingle && fitResult.fitDual) {
      drawDualCurves(canvas, fitResult.fitSingle, fitResult.fitDual, {
        title: '功能四：注意干扰心理物理曲线',
        xLabel: 'SNR (dB)',
        yLabel: '正确率',
        label1: '单说话人',
        label2: '双说话人',
        color1: '#6366f1',
        color2: '#ef4444'
      });
    }
  }

  /**
   * 在同一 canvas 上绘制两条对比心理物理曲线
   */
  function drawDualCurves(canvas, fit1, fit2, opts) {
    const canvasEl = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!canvasEl || !fit1 || !fit2) return;

    const ctx = canvasEl.getContext('2d');
    const rect = canvasEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const margin = { top: 50, right: 30, bottom: 50, left: 55 };
    const plotW = W - margin.left - margin.right;
    const plotH = H - margin.top - margin.bottom;

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, H);

    // 合并数据范围
    const allXs = [...fit1.data.map(d => d.x), ...fit2.data.map(d => d.x)];
    const xMin = Math.min(...allXs);
    const xMax = Math.max(...allXs);
    const xPad = (xMax - xMin) * 0.15;

    function toCanvasX(x) { return margin.left + (x - (xMin - xPad)) / (xMax - xMin + 2 * xPad) * plotW; }
    function toCanvasY(y) { return margin.top + plotH - y / 1.05 * plotH; }

    // 网格
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (let y = 0; y <= 1; y += 0.25) {
      const cy = toCanvasY(y);
      ctx.beginPath(); ctx.moveTo(margin.left, cy); ctx.lineTo(W - margin.right, cy); ctx.stroke();
    }

    const xStep = 3;
    for (let x = Math.ceil((xMin - xPad) / xStep) * xStep; x <= xMax + xPad; x += xStep) {
      const cx = toCanvasX(x);
      ctx.beginPath(); ctx.moveTo(cx, margin.top); ctx.lineTo(cx, margin.top + plotH); ctx.stroke();
    }

    // 80% 标准线
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    const critY = toCanvasY(0.80);
    ctx.beginPath(); ctx.moveTo(margin.left, critY); ctx.lineTo(W - margin.right, critY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#10b981';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('80% 标准', W - margin.right - 60, critY - 5);

    // 猜测率线
    const guessY = toCanvasY(0.25);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(margin.left, guessY); ctx.lineTo(W - margin.right, guessY); ctx.stroke();
    ctx.setLineDash([]);

    // 绘制两条曲线
    [fit1, fit2].forEach((fit, idx) => {
      const color = idx === 0 ? opts.color1 : opts.color2;
      const points = Psychometric.generateCurvePoints(fit, 200);
      if (points.length > 0) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        points.forEach((pt, i) => {
          const cx = toCanvasX(pt.x);
          const cy = toCanvasY(pt.y);
          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        });
        ctx.stroke();
      }

      // 数据点
      fit.data.forEach(d => {
        const cx = toCanvasX(d.x);
        const cy = toCanvasY(d.k / d.n);
        const r = Math.max(3, Math.min(7, Math.sqrt(d.n) * 1.3));
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    });

    // 坐标轴
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + plotH);
    ctx.lineTo(W - margin.right, margin.top + plotH);
    ctx.stroke();

    // 标签
    ctx.fillStyle = '#374151';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel, W / 2, H - 8);
    ctx.save();
    ctx.translate(14, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel, 0, 0);
    ctx.restore();

    // 标题
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(opts.title, W / 2, 18);

    // 图例
    const legX = margin.left + 10;
    const legY = margin.top + 12;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(legX, legY - 12, 180, 40);
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.strokeRect(legX, legY - 12, 180, 40);

    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(legX + 8, legY); ctx.lineTo(legX + 30, legY); ctx.strokeStyle = opts.color1; ctx.stroke();
    ctx.fillStyle = '#374151';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    const label1Text = opts.label1 + (fit1.threshold !== null ? ` α=${fit1.threshold.toFixed(1)}` : '');
    ctx.fillText(label1Text, legX + 36, legY + 4);

    ctx.beginPath(); ctx.moveTo(legX + 8, legY + 18); ctx.lineTo(legX + 30, legY + 18); ctx.strokeStyle = opts.color2; ctx.stroke();
    const label2Text = opts.label2 + (fit2.threshold !== null ? ` α=${fit2.threshold.toFixed(1)}` : '');
    ctx.fillText(label2Text, legX + 36, legY + 22);

    // 刻度
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'center';
    for (let x = Math.ceil((xMin - xPad) / xStep) * xStep; x <= xMax + xPad; x += xStep) {
      ctx.fillText(x.toFixed(0), toCanvasX(x), margin.top + plotH + 18);
    }
    ctx.textAlign = 'right';
    for (let y = 0; y <= 1; y += 0.25) {
      ctx.fillText((y * 100).toFixed(0) + '%', margin.left - 8, toCanvasY(y) + 4);
    }
  }
  
  // ==================== 历史记录 ====================
  window.showHistory = function() {
    UIHelper.showScreen('history');
    updateHistoryUI();
  };
  
  function updateHistoryUI() {
    const historyHTML = DataManager.generateHistoryHTML();
    const historyContent = document.getElementById('historyContent');
    if (historyContent) {
      historyContent.innerHTML = historyHTML;
    }
  }
  
  // ==================== 键盘快捷键 ====================
  function handleKeyPress(event) {
    // 忽略在输入框中的按键
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      return;
    }
    
    const key = event.key.toLowerCase();
    
    // 空格键：播放（仅在实验屏幕且未播放且未等待响应时）
    if (key === ' ') {
      event.preventDefault();
      if (!STATE.isPlaying && !STATE.isWaitingForResponse) {
        window.expPlay();
      }
    }
    
    // A/B/C/D：选择答案
    if (['a', 'b', 'c', 'd'].includes(key)) {
      const index = key.charCodeAt(0) - 97; // a=0, b=1, c=2, d=3
      if (STATE.isWaitingForResponse) {
        submitAnswer(index);
      }
    }
    
    // ESC：退出
    if (key === 'escape') {
      if (confirm('确定要退出实验吗？')) {
        showResults();
      }
    }
  }
  
  // ==================== 数据导出 ====================
  window.exportResults = function() {
    try {
      const metadata = {
        subjectId: STATE.subjectId,
        phase: STATE.phase,
        func: STATE.func,
        snrMode: STATE.snrMode,
        threshold: calculateThreshold()
      };
      
      DataManager.saveExperimentData(metadata, STATE.results);
      UIHelper.showNotification('数据已保存并导出', 'success');
    } catch (error) {
      console.error('导出失败:', error);
      UIHelper.showNotification('导出失败', 'error');
    }
  };
  
  function calculateThreshold() {
    // 使用 STATE.results 而非模块内部results（因为实际数据存在STATE中）
    if (STATE.results.length < 5) return null;

    if (STATE.func === 1) {
      return Module1.calculateThreshold(STATE.results);
    } else if (STATE.func === 2) {
      return Module2.calculateVisualGain(STATE.results);
    } else if (STATE.func === 3) {
      return Module3.calculateIntegrationWindow(STATE.results);
    } else if (STATE.func === 4) {
      return Module4.calculateInterferenceSuppressionCost(STATE.results);
    }
    return null;
  }

  /**
   * 从拟合结果中提取纯数值阈值（用于 metadata 存储）
   */
  function extractThresholdValue(fitResult) {
    if (!fitResult) return null;
    if (fitResult.threshold !== undefined) return fitResult.threshold; // func1
    if (fitResult.gain !== undefined) return fitResult.gain; // func2
    if (fitResult.window !== undefined) return fitResult.window; // func3
    if (fitResult.cost !== undefined) return fitResult.cost; // func4
    return null;
  }
  
  // ==================== 实用函数 ====================
  window.goToMenu = function() {
    UIHelper.showScreen('menu');
  };
  
  window.confirmQuit = function() {
    UIHelper.showConfirm('确定要退出实验吗？当前进度将保存。', () => {
      exportResults();
      showResults();
    });
  };
  
  console.log('app.js 加载完成');
})();