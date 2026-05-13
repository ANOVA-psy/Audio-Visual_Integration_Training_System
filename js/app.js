/**
 * 主应用逻辑 v3.1
 * - 修复：选项按钮点击播放后立即可用（无延迟）
 * - 修复：提交答案后 UI 立即刷新（ITI 缩短 + 即时反馈渲染）
 * - 新增：快速启动流程（病人界面）
 * - 新增：视频/音频源与 MATERIALS 对应（每个试次使用对应材料的视频+音频）
 */

(function() {
  'use strict';

  // ==================== 全局状态 ====================
  const STATE = {
    subjectId: 'P001',
    phase: 'train',
    func: 1,
    snrMode: 'adaptive',

    trialQueue: [],
    currentTrialIndex: 0,
    results: [],
    isPlaying: false,
    isWaitingForResponse: false,
    isReadyForPlay: false,
    responseStartTime: null,

    adaptive: {
      streak: 0,
      currentSNR: 0,
      reversals: [],
      reversalSNRs: [],
      trialCount: 0,
      maxReversals: 8,
      isRunning: false
    },

    audioContext: null,
    noiseBuffer: null,
    history: []
  };

  // ==================== 顺序/随机状态 ====================
  const orderState = { snr: 'random', blur: 'random', soa: 'random', att: 'random' };

  /**
   * 获取当前功能的主要 order 状态
   */
  function getCurrentOrder() {
    return orderState.snr; // 统一取 SNR 的 order 作为主要排序方式
  }

  // ==================== 快速启动（病人界面） ====================

  /**
   * 快速启动：病人从快速界面选择阶段后进入引导页
   * @param {'pre'|'train'|'post'} phase
   */
  window.quickStart = function(phase) {
    STATE.phase = phase;
    STATE.subjectId = document.getElementById('quickSubjectId')?.value || 'P001';

    // 同步到管理员页被试ID
    const adminSubjectId = document.getElementById('subjectId');
    if (adminSubjectId) adminSubjectId.value = STATE.subjectId;

    // 更新引导页内容
    updateGuideScreen(phase);
    UIHelper.showScreen('guide');
  };

  function updateGuideScreen(phase) {
    const phaseInfo = {
      pre:   { emoji:'📊', title:'训练前测试', desc:'了解您目前的听觉基础能力，没有对错之分，尽力作答即可', color:'indigo' },
      train: { emoji:'🏋️', title:'训练阶段',   desc:'反复练习，逐步提升您的视听整合能力',                    color:'blue'   },
      post:  { emoji:'📈', title:'训练后测试', desc:'检验训练效果，与训练前的结果进行对比',                    color:'green'  }
    };
    const info = phaseInfo[phase];

    const guideEmoji  = document.getElementById('guideEmoji');
    const guideTitle  = document.getElementById('guideTitle');
    const guideDesc   = document.getElementById('guideDesc');
    if (guideEmoji) guideEmoji.textContent = info.emoji;
    if (guideTitle) guideTitle.textContent = info.title;
    if (guideDesc)  guideDesc.textContent  = info.desc;

    // 动态生成训练模块选择
    renderModuleGuide(phase);
  }

  function renderModuleGuide(phase) {
    const area = document.getElementById('moduleGuideArea');
    if (!area) return;

    // 根据阶段决定默认模块
    // - pre / post 阶段：全部 4 个模块
    // - train：全部模块
    const modules = [
      { id:1, emoji:'🎯', name:'听音识别',   desc:'在噪音中听辨音节',        color:'blue'   },
      { id:2, emoji:'👁️', name:'口型辅助',   desc:'结合口型动作理解语音',    color:'purple' },
      { id:3, emoji:'⏱️', name:'同步校准',   desc:'感知声音与口型的同步性',  color:'orange' },
      { id:4, emoji:'🧠', name:'注意定位',   desc:'从多个说话人中定位目标',  color:'green'  }
    ];

    // 训练阶段默认推荐功能1
    const recommendId = 1;

    area.innerHTML = modules.map(m => `
      <button onclick="quickSelectModule(${m.id})"
        class="w-full p-4 rounded-2xl border-2 ${m.id === recommendId ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300'} text-left flex items-center gap-3 transition-all patient-btn">
        <div class="text-3xl">${m.emoji}</div>
        <div class="flex-1">
          <div class="font-bold text-gray-800">${m.name}</div>
          <div class="text-sm text-gray-500 font-normal">${m.desc}</div>
        </div>
        ${m.id === recommendId ? '<span class="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full">推荐</span>' : ''}
        <div class="text-2xl text-gray-400">›</div>
      </button>
    `).join('');
  }

  /**
   * 病人选择模块后 → 使用默认配置生成试次 → 直接进入实验
   */
  window.quickSelectModule = function(funcId) {
    STATE.func = funcId;

    // 同步管理员界面状态
    selectFunc(funcId);
    selectPhase(STATE.phase);

    // ★ 修复：先尝试加载已保存的配置
    const savedSettings = AdminSettings.getSettings(STATE.subjectId, STATE.phase, funcId);
    if (savedSettings && savedSettings.settings) {
      console.log('[QuickStart] 加载已保存的设置', savedSettings);
      AdminSettings.applySettingsToUI(savedSettings.settings);
      UIHelper.showNotification('已加载保存的设置', 'info');
    } else {
      // 没有保存的配置，使用默认配置
      console.log('[QuickStart] 没有保存的设置，使用默认配置');
      applyQuickConfig(funcId, STATE.phase);
    }

    // 生成试次
    try {
      UIHelper.showLoading('正在准备题目...');
      const trials = generateTrialsForFunc(funcId);
      if (trials.length === 0) {
        UIHelper.hideLoading();
        UIHelper.showNotification('生成试次失败，请联系工作人员', 'error');
        return;
      }

      STATE.trialQueue = trials;
      STATE.currentTrialIndex = 0;
      STATE.results = [];

      UIHelper.hideLoading();

      // 直接跳到开始实验（跳过"生成完成"页）
      startExperimentDirect();
    } catch(e) {
      console.error('[QuickStart] 生成失败:', e);
      UIHelper.hideLoading();
      UIHelper.showNotification('准备失败: ' + e.message, 'error');
    }
  };

  /**
   * 快速配置：根据功能和阶段应用合理默认值
   */
  function applyQuickConfig(funcId, phase) {
    // 根据阶段调整试次规模
    const reps = phase === 'train' ? 5 : 3;

    // 勾选默认 SNR
    document.querySelectorAll('.snr-lvl').forEach(cb => {
      cb.checked = ['-6','-3','0','3'].includes(cb.value);
    });

    const snrRepsEl = document.getElementById('snrReps');
    const blurRepsEl = document.getElementById('blurReps');
    const soaRepsEl  = document.getElementById('soaReps');
    if (snrRepsEl) snrRepsEl.value = reps;
    if (blurRepsEl) blurRepsEl.value = reps;
    if (soaRepsEl)  soaRepsEl.value = reps;

    // 功能二默认模糊度
    document.querySelectorAll('.blur-lvl').forEach(cb => {
      cb.checked = ['0','4','8','12','16','20'].includes(cb.value);
    });

    // 功能三默认 SOA
    document.querySelectorAll('.soa-lvl').forEach(cb => {
      cb.checked = ['-100','0','100'].includes(cb.value);
    });

    // 功能四默认注意条件
    document.querySelectorAll('.att-lvl').forEach(cb => {
      cb.checked = true;
    });
  }

  /**
   * 从当前 checkbox 配置生成试次（内部辅助，不跳转）
   */
  function generateTrialsForFunc(funcId) {
    const config = {
      snrLevels:  getSelectedValues('.snr-lvl'),
      blurLevels: getSelectedValues('.blur-lvl'),
      soaLevels:  getSelectedValues('.soa-lvl'),
      attLevels:  getSelectedValues('.att-lvl'),
      repetitions: parseInt(document.getElementById('snrReps')?.value) || 3,
      order: getCurrentOrder()
    };

    if (funcId === 1) return Module1.generateTrialQueue(config);
    if (funcId === 2) return Module2.generateTrialQueue(config);
    if (funcId === 3) return Module3.generateTrialQueue(config);
    if (funcId === 4) return Module4.generateTrialQueue(config);
    return [];
  }

  /**
   * 快速启动直接进入实验（绕过 generate 屏幕）
   */
  function startExperimentDirect() {
    EventLogger.startSession({
      subjectId: STATE.subjectId,
      phase:     STATE.phase,
      func:      STATE.func
    });

    UIHelper.showScreen('exp');
    updateExperimentUI();
    setupExperimentVideoSources();
    startNextTrial();
  }

  // ==================== 初始化 ====================
  document.addEventListener('DOMContentLoaded', () => {
    console.log('视听语音整合训练系统 v3.1 - 初始化');

    Module1.init();
    Module2.init();
    Module3.init();
    Module4.init();

    const dateInput = document.getElementById('expDate');
    if (dateInput) dateInput.value = UIHelper.formatDate();

    bindEvents();

    // 默认显示屏幕（支持 hash 导航 + 管理员页面覆盖）
    const hash = window.location.hash.slice(1);
    if (hash && ['quick','guide','menu','prep','generate','exp','results','history'].includes(hash)) {
      UIHelper.showScreen(hash);
    } else {
      const defaultScreen = window.DEFAULT_SCREEN || 'quick';
      UIHelper.showScreen(defaultScreen);
    }

    console.log('初始化完成');
  });

  // ==================== 事件绑定 ====================
  function bindEvents() {
    const subjectIdInput = document.getElementById('subjectId');
    if (subjectIdInput) subjectIdInput.addEventListener('input', updateConfigSummary);

    document.addEventListener('keydown', handleKeyPress);
    bindSettingChangeListeners();

    // Hash 导航支持（浏览器前进/后退）
    window.addEventListener('hashchange', handleHashChange);

    // ★ 新增：预览界面滑块实时数值显示
    bindPreviewSliderListeners();
  }

  /**
   * 为预览界面的所有滑块添加 input 事件监听器
   * 实现拖动滑块时实时更新显示的数值
   */
  function bindPreviewSliderListeners() {
    // 功能1：SNR滑块
    const snrSlider1 = document.getElementById('previewSNRSlider');
    const snrText1 = document.getElementById('previewSNRText');
    if (snrSlider1 && snrText1) {
      snrSlider1.addEventListener('input', function() {
        snrText1.textContent = `SNR: ${snrSlider1.value} dB`;
      });
    }

    // 功能2：SNR滑块 + 模糊度滑块
    const snrSlider2 = document.getElementById('previewSNRSlider2');
    const snrText2 = document.getElementById('previewSNRText2');
    if (snrSlider2 && snrText2) {
      snrSlider2.addEventListener('input', function() {
        snrText2.textContent = `SNR: ${snrSlider2.value} dB`;
      });
    }

    const blurSlider2 = document.getElementById('previewBlurSlider');
    const blurText2 = document.getElementById('previewBlurText');
    if (blurSlider2 && blurText2) {
      blurSlider2.addEventListener('input', function() {
        blurText2.textContent = `模糊度: ${blurSlider2.value}%`;
        updateModule2Preview();
      });
    } else if (blurSlider2) {
      blurSlider2.addEventListener('input', function() {
        updateModule2Preview();
      });
    }

    // 功能3：SNR滑块 + 模糊度滑块 + SOA滑块
    const snrSlider3 = document.getElementById('previewSNRSlider3');
    const snrText3 = document.getElementById('previewSNRText3');
    if (snrSlider3 && snrText3) {
      snrSlider3.addEventListener('input', function() {
        snrText3.textContent = `SNR: ${snrSlider3.value} dB`;
      });
    }

    const blurSlider3 = document.getElementById('previewBlurSlider3');
    const blurText3 = document.getElementById('previewBlurText3');
    if (blurSlider3 && blurText3) {
      blurSlider3.addEventListener('input', function() {
        blurText3.textContent = `模糊度: ${blurSlider3.value}%`;
      });
    }

    const soaSlider3 = document.getElementById('previewSOASlider');
    const soaText3 = document.getElementById('prev3SOAText');
    if (soaSlider3 && soaText3) {
      soaSlider3.addEventListener('input', function() {
        const v = parseInt(soaSlider3.value);
        soaText3.textContent = `SOA: ${v > 0 ? '+' : ''}${v} ms`;
      });
    }

    // 功能4：SNR滑块
    const snrSlider4 = document.getElementById('previewSNRSlider4');
    const snrText4 = document.getElementById('previewSNRText4');
    if (snrSlider4 && snrText4) {
      snrSlider4.addEventListener('input', function() {
        snrText4.textContent = `SNR: ${snrSlider4.value} dB`;
      });
    }

    console.log('[bindEvents] 预览界面滑块监听器已绑定');
  }

  function bindSettingChangeListeners() {
    document.addEventListener('change', function(e) {
      if (e.target.matches('.snr-lvl, .blur-lvl, .soa-lvl, .att-lvl')) updateTrialSummary();
      if (e.target.matches('#snrReps, #blurReps, #soaReps')) updateTrialSummary();
    });
    document.addEventListener('input', function(e) {
      if (e.target.matches('#snrReps, #blurReps, #soaReps')) updateTrialSummary();
    });
  }

  // ==================== 主菜单 ====================
  window.selectPhase = function(phase) {
    STATE.phase = phase;
    ['pre','train','post'].forEach(p => {
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
    [1,2,3,4].forEach(f => {
      const el = document.getElementById(`func${f}`);
      if (el) {
        el.className = `func-btn p-4 rounded-xl border-2 ${
          f === func ? 'border-primary bg-blue-50' : 'border-gray-200 hover:border-primary'
        } text-center`;
      }
    });
    updateConfigSummary();
    updatePreview();  // ★ 切换功能时更新预览界面
  };

  function updateConfigSummary() {
    const phaseNames = { pre:'训练前测试', train:'训练中', post:'训练后测试' };
    const funcNames  = { 1:'功能一（抗干扰）', 2:'功能二（视觉整合）', 3:'功能三（异步校准）', 4:'功能四（注意定位）' };
    const cfgText = document.getElementById('cfgText');
    if (cfgText) {
      const subjectId = document.getElementById('subjectId')?.value || 'P001';
      cfgText.textContent = `${funcNames[STATE.func]} | ${phaseNames[STATE.phase]} | 被试 ${subjectId}`;
    }
  }

  // ==================== 材料准备（管理员） ====================
  window.goToPreparation = function() {
    STATE.subjectId = document.getElementById('subjectId')?.value || 'P001';
    UIHelper.showScreen('prep');
    updatePreparationUI();
  };

  function updatePreparationUI() {
    const funcNames = ['','功能一：抗干扰训练','功能二：视觉整合训练','功能三：异步校准训练','功能四：注意定位训练'];
    const phaseNames = { pre:'训练前测试', train:'训练中', post:'训练后测试' };
    
    const prepTitle = document.getElementById('prepTitle');
    if (prepTitle) prepTitle.textContent = `材料准备 · ${funcNames[STATE.func]}`;
    const prepSubtitle = document.getElementById('prepSubtitle');
    if (prepSubtitle) prepSubtitle.textContent = `${phaseNames[STATE.phase]}阶段`;
    const phaseIndicator = document.getElementById('phaseIndicator');
    if (phaseIndicator) phaseIndicator.textContent = phaseNames[STATE.phase];
    
    const varSNR  = document.getElementById('varSNR');
    const varBlur = document.getElementById('varBlur');
    const varSOA  = document.getElementById('varSOA');
    const varAtt  = document.getElementById('varAtt');
    if (varSNR)  varSNR.classList.remove('hidden');
    if (varBlur) varBlur.classList.toggle('hidden', STATE.func !== 2 && STATE.func !== 3);
    if (varSOA)  varSOA.classList.toggle('hidden', STATE.func !== 3);
    if (varAtt)  varAtt.classList.toggle('hidden', STATE.func !== 4);
    
    // ★ 加载已保存的设置（如果存在）
    const savedSettings = AdminSettings.getSettings(STATE.subjectId, STATE.phase, STATE.func);
    if (savedSettings && savedSettings.settings) {
      console.log('[UI] 加载已保存的设置', savedSettings);
      AdminSettings.applySettingsToUI(savedSettings.settings);
      UIHelper.showNotification('已加载该被试、阶段、功能的保存设置', 'info');
    } else {
      // 使用默认设置
      const defaultSettings = AdminSettings.getDefaultSettings(STATE.func, STATE.phase);
      AdminSettings.applySettingsToUI(defaultSettings);
      console.log('[UI] 使用默认设置', defaultSettings);
    }
    
    updatePreview();
    updateTrialSummary();
  }

  // ==================== 预览功能 ====================
  let previewPlaying = false;

  function updatePreview() {
    ['preview1','preview2','preview3','preview4'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    setupPreviewVideoSources();

    const pid = `preview${STATE.func}`;
    const pel = document.getElementById(pid);
    if (pel) pel.classList.remove('hidden');

    if (STATE.func === 2) updateModule2Preview();
    if (STATE.func === 3) updateModule3Preview();
  }

  function setupPreviewVideoSources() {
    // 功能2 - 使用 previewVideo
    const previewVideo2 = document.getElementById('previewVideo');
    const src2 = document.getElementById('previewSrc');
    if (src2) src2.src = Config.VIDEO_FILES[0];
    if (previewVideo2) previewVideo2.load();
    
    // 功能3 - 使用独立的 previewVideo3
    const previewVideo3 = document.getElementById('previewVideo3');
    const src3 = document.getElementById('previewSrc3');
    if (src3) src3.src = Config.VIDEO_FILES[0];
    if (previewVideo3) previewVideo3.load();
    
    // 功能4
    const previewMain = document.getElementById('previewMain');
    const previewDist = document.getElementById('previewDist');
    const src4Main = document.getElementById('previewMainSrc');
    const src4Dist = document.getElementById('previewDistSrc');
    if (src4Main) src4Main.src = Config.VIDEO_FILES[0];
    if (src4Dist) src4Dist.src = Config.VIDEO_FILES[1 % Config.VIDEO_FILES.length];
    if (previewMain) previewMain.load();
    if (previewDist) previewDist.load();
  }

  function updateModule2Preview() {
    const video = document.getElementById('previewVideo');
    const blurSlider = document.getElementById('previewBlurSlider');
    if (video && blurSlider) {
      const v = blurSlider.value;
      video.style.filter = v > 0 ? `blur(${v * 0.5}px)` : 'none';
    }
  }

  function updateModule3Preview() {
    const soaSlider = document.getElementById('previewSOASlider');
    if (soaSlider) {
      const v = parseInt(soaSlider.value);
      const t = document.getElementById('prev3SOAText');
      if (t) t.textContent = `SOA: ${v > 0 ? '+' : ''}${v} ms`;
    }
  }

  window.playPreview = async function() {
    if (previewPlaying) {
      AudioProcessor.stopAllAudio();
      stopAllPreviewVideos();
      previewPlaying = false;
      updatePreviewButton(false);
      return;
    }
    try {
      previewPlaying = true;
      updatePreviewButton(true);

      // ★ 根据功能读取对应的SNR选择器
      let snrSliderId = 'previewSNRSlider';
      if (STATE.func === 2) snrSliderId = 'previewSNRSlider2';
      else if (STATE.func === 3) snrSliderId = 'previewSNRSlider3';
      else if (STATE.func === 4) snrSliderId = 'previewSNRSlider4';
      
      const snrSlider = document.getElementById(snrSliderId);
      const snr = snrSlider ? parseInt(snrSlider.value) : 0;

      // ★ 新增：读取功能4的注意条件和目标位置
      let attCondition = 'single';
      let targetSide = 'left';
      if (STATE.func === 4) {
        const attRadio = document.querySelector('input[name="previewAttCondition"]:checked');
        if (attRadio) attCondition = attRadio.value;
        const sideRadio = document.querySelector('input[name="previewTargetSide"]:checked');
        if (sideRadio) targetSide = sideRadio.value;
        
        // 更新目标标签
        const targetLabel = document.getElementById('previewTargetLabel');
        if (targetLabel) {
          targetLabel.textContent = `👤 目标（${targetSide === 'left' ? '左' : '右'}）`;
        }
      }

      STATE.isPlaying = false;
      AudioProcessor.stopAllAudio();
      stopAllPreviewVideos();

      // ★ 修复：预览时播放真实的音频文件（ba/da/ga），而非TTS合成音
      // 取第一个材料（ba）作为预览示例
      const previewMat = Config.MATERIALS[0];

      if (STATE.func === 1) {
        // 功能1：纯音频 + 噪音（无视频）
        console.log('[playPreview] 功能1预览，SNR:', snr, '音频:', previewMat.audio);
        await AudioProcessor.playMixedAudioFile(previewMat.audio, snr);
      } else if (STATE.func === 2) {
        // 功能2：视频（带模糊）+ 音频 + 噪音
        const video = document.getElementById('previewVideo');
        const blurSlider = document.getElementById('previewBlurSlider');
        if (video) {
          video.currentTime = 0;
          if (blurSlider) {
            const v = blurSlider.value;
            video.style.filter = v > 0 ? `blur(${v * Config.BLUR_CSS_FACTOR}px)` : 'none';
          }
          await video.play();
        }
        console.log('[playPreview] 功能2预览，SNR:', snr, '音频:', previewMat.audio);
        await AudioProcessor.playMixedAudioFile(previewMat.audio, snr);
        if (video) { video.pause(); video.currentTime = 0; }
      } else if (STATE.func === 3) {
        // 功能3：单个视频 + SOA延迟 + 音频 + 模糊度
        const video = document.getElementById('previewVideo3');
        const soaSlider = document.getElementById('previewSOASlider');
        const blurSlider3 = document.getElementById('previewBlurSlider3');
        const soa = soaSlider ? parseInt(soaSlider.value) : 0;
        
        if (video) {
          video.currentTime = 0;
          // 应用模糊度
          if (blurSlider3) {
            const v = blurSlider3.value;
            video.style.filter = v > 0 ? `blur(${v * Config.BLUR_CSS_FACTOR}px)` : 'none';
          } else {
            video.style.filter = 'none';
          }
          
          if (soa >= 0) {
            await video.play();
            if (soa > 0) await new Promise(r => setTimeout(r, soa));
          }
        }
        console.log('[playPreview] 功能3预览，SNR:', snr, 'SOA:', soa, '音频:', previewMat.audio);
        await AudioProcessor.playMixedAudioFile(previewMat.audio, snr);
        // 若音频比视频短，等视频播完
        if (video && !video.paused) {
          await new Promise(r => {
            video.onended = r;
            // 超时保护：3秒后强制继续
            setTimeout(r, 3000);
          });
        }
        if (video) { video.pause(); video.currentTime = 0; }
      } else if (STATE.func === 4) {
        // 功能4：目标视频 + 干扰视频 + 音频
        // 根据目标位置决定哪个视频是目标
        const vL = document.getElementById('previewMain');  // 左侧视频
        const vR = document.getElementById('previewDist');  // 右侧视频
        
        if (targetSide === 'left') {
          // 目标在左，干扰在右
          if (vL) { vL.currentTime = 0; await vL.play(); }
          if (vR && attCondition === 'dual') { vR.currentTime = 0; await vR.play(); }
        } else {
          // 目标在右，干扰在左
          if (vL && attCondition === 'dual') { vL.currentTime = 0; await vL.play(); }
          if (vR) { vR.currentTime = 0; await vR.play(); }
        }
        
        console.log('[playPreview] 功能4预览，SNR:', snr, '注意:', attCondition, '目标位置:', targetSide, '音频:', previewMat.audio);
        
        // ★ 修复：双人条件时播放两个音频
        if (attCondition === 'dual') {
          // 为干扰说话人随机选择一个不同的材料
          let distractorMat;
          do {
            distractorMat = Config.MATERIALS[Math.floor(Math.random() * Config.MATERIALS.length)];
          } while (distractorMat.label === previewMat.label);
          
          console.log('[playPreview] 功能4双人模式，目标音频:', previewMat.audio, '干扰音频:', distractorMat.audio);
          await AudioProcessor.playDualMixedAudioFile(previewMat.audio, distractorMat.audio, snr);
        } else {
          // 单人条件只播放目标音频
          await AudioProcessor.playMixedAudioFile(previewMat.audio, snr);
        }
        
        if (vL) vL.pause();
        if (vR) vR.pause();
      }

      previewPlaying = false;
      updatePreviewButton(false);
    } catch(e) {
      console.error('[playPreview] 失败:', e);
      AudioProcessor.stopAllAudio();
      stopAllPreviewVideos();
      previewPlaying = false;
      updatePreviewButton(false);
      UIHelper.showNotification('预览播放失败: ' + e.message, 'error');
    }
  };

  function updatePreviewButton(isPlaying) {
    document.querySelectorAll('[onclick="playPreview()"]').forEach(btn => {
      if (isPlaying) {
        btn.textContent = '⏹️ 停止预览';
        btn.classList.replace('bg-primary', 'bg-red-500');
      } else {
        btn.textContent = '▶️ 播放预览';
        btn.classList.replace('bg-red-500', 'bg-primary');
      }
    });
  }

  function stopAllPreviewVideos() {
    ['previewVideo','previewVideo3','previewMain','previewDist'].forEach(id => {
      const v = document.getElementById(id);
      if (v) v.pause();
    });
  }

  // ==================== 试次统计 ====================
  function updateTrialSummary() {
    const snrLevels  = getSelectedValues('.snr-lvl');
    const blurLevels = getSelectedValues('.blur-lvl');
    const soaLevels  = getSelectedValues('.soa-lvl');
    const attLevels  = getSelectedValues('.att-lvl');
    const snrReps    = parseInt(document.getElementById('snrReps')?.value) || 3;
    const blurReps   = parseInt(document.getElementById('blurReps')?.value) || 3;
    const soaReps    = parseInt(document.getElementById('soaReps')?.value) || 3;

    let total = 0, detail = '';
    if (STATE.func === 1) {
      total  = snrLevels.length * snrReps;
      detail = `SNR: ${snrLevels.length}档 × ${snrReps}次 = ${total}试次`;
    } else if (STATE.func === 2) {
      const c = snrLevels.length * blurLevels.length;
      const r = Math.max(snrReps, blurReps);
      total  = c * r;
      detail = `SNR(${snrLevels.length}) × 模糊度(${blurLevels.length}) × ${r}次 = ${total}试次`;
    } else if (STATE.func === 3) {
      const c = snrLevels.length * blurLevels.length * soaLevels.length;
      const r = Math.max(snrReps, blurReps, soaReps);
      total  = c * r;
      detail = `SNR(${snrLevels.length}) × 模糊(${blurLevels.length}) × SOA(${soaLevels.length}) × ${r}次 = ${total}试次`;
    } else if (STATE.func === 4) {
      total  = snrLevels.length * attLevels.length * snrReps;
      detail = `SNR(${snrLevels.length}) × 注意(${attLevels.length}) × ${snrReps}次 = ${total}试次`;
    }

    const el = document.getElementById('previewTotal');
    if (el) el.textContent = total;
    const s = document.getElementById('summaryText');
    if (s) s.textContent = detail;
  }

  // ==================== 生成程序（管理员流程） ====================
  window.generateTrials = function() {
    UIHelper.showLoading('正在生成试次...');
    try {
      const config = {
        snrLevels:  getSelectedValues('.snr-lvl'),
        blurLevels: getSelectedValues('.blur-lvl'),
        soaLevels:  getSelectedValues('.soa-lvl'),
        attLevels:  getSelectedValues('.att-lvl'),
        repetitions: parseInt(document.getElementById('snrReps')?.value) || 3,
        order: getCurrentOrder()
      };
      
      // ★ 保存管理员设置（按被试、阶段、功能保存）
      AdminSettings.saveSettings(STATE.subjectId, STATE.phase, STATE.func, config);

      // 同步 STATE.snrMode
      const snrModeEl = document.getElementById('snrMode');
      if (snrModeEl) STATE.snrMode = snrModeEl.value;
      console.log('[Generate] 设置已保存', config, 'snrMode:', STATE.snrMode);

      let trials = [];
      if (STATE.func === 1) trials = Module1.generateTrialQueue(config);
      else if (STATE.func === 2) trials = Module2.generateTrialQueue(config);
      else if (STATE.func === 3) trials = Module3.generateTrialQueue(config);
      else if (STATE.func === 4) trials = Module4.generateTrialQueue(config);

      STATE.trialQueue = trials;
      STATE.currentTrialIndex = 0;
      STATE.results = [];

      if (STATE.snrMode === 'adaptive') initAdaptiveAlgorithm();

      updateTrialSummary();
      UIHelper.hideLoading();
      UIHelper.showNotification(`已生成 ${trials.length} 个试次`, 'success');

      UIHelper.showScreen('generate');
      updateGenerateUI(trials.length);
    } catch(e) {
      console.error('生成失败:', e);
      UIHelper.hideLoading();
      UIHelper.showNotification('生成失败: ' + e.message, 'error');
    }
  };

  // ==================== 保存管理员设置并生成试次 ====================
  window.saveAdminSettings = function () {
    UIHelper.showLoading('正在保存设置并生成试次...');
    try {
      const snrMode = document.getElementById('snrMode')?.value || 'adaptive';
      const config = {
        snrLevels:  getSelectedValues('.snr-lvl'),
        blurLevels: getSelectedValues('.blur-lvl'),
        soaLevels:  getSelectedValues('.soa-lvl'),
        attLevels:  getSelectedValues('.att-lvl'),
        repetitions: parseInt(document.getElementById('snrReps')?.value) || 3,
        snrMode:    snrMode,
        order:      getCurrentOrder(),
        orderState: Object.assign({}, orderState)
      };

      // 同步 STATE.snrMode
      STATE.snrMode = snrMode;

      // 保存管理员设置
      AdminSettings.saveSettings(STATE.subjectId, STATE.phase, STATE.func, config);
      console.log('[saveAdminSettings]', STATE.subjectId, STATE.phase, STATE.func, config);

      // 生成试次
      let trials = [];
      if (STATE.func === 1) trials = Module1.generateTrialQueue(config);
      else if (STATE.func === 2) trials = Module2.generateTrialQueue(config);
      else if (STATE.func === 3) trials = Module3.generateTrialQueue(config);
      else if (STATE.func === 4) trials = Module4.generateTrialQueue(config);

      STATE.trialQueue = trials;
      STATE.currentTrialIndex = 0;
      STATE.results = [];

      if (STATE.snrMode === 'adaptive') initAdaptiveAlgorithm();

      UIHelper.hideLoading();
      UIHelper.showNotification(`设置已保存，已生成 ${trials.length} 个试次`, 'success');
      
      // 跳转到准备完毕界面
      UIHelper.showScreen('generate');
      updateGenerateUI(trials.length);
    } catch(e) {
      console.error('保存并设置失败:', e);
      UIHelper.hideLoading();
      UIHelper.showNotification('操作失败: ' + e.message, 'error');
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
    const gc = document.getElementById('generateCount');
    if (gc) gc.textContent = trialCount;

    const funcNames  = { 1:'功能一：抗干扰训练', 2:'功能二：视觉整合训练', 3:'功能三：异步校准训练', 4:'功能四：注意定位训练' };
    const phaseNames = { pre:'训练前测试', train:'训练中', post:'训练后测试' };
    const snrLevels  = getSelectedValues('.snr-lvl');
    const blurLevels = getSelectedValues('.blur-lvl');
    const soaLevels  = getSelectedValues('.soa-lvl');
    const attLevels  = getSelectedValues('.att-lvl');

    const sl = document.getElementById('expSettingsList');
    if (sl) {
      sl.innerHTML = [
        `<li><strong>功能：</strong>${funcNames[STATE.func]}</li>`,
        `<li><strong>阶段：</strong>${phaseNames[STATE.phase]}</li>`,
        `<li><strong>被试：</strong>${STATE.subjectId}</li>`
      ].join('');
    }

    const pl = document.getElementById('expParamsList');
    if (pl) {
      const rows = [`<li><strong>SNR：</strong>${snrLevels.sort((a,b)=>b-a).join(', ')} dB</li>`];
      if (STATE.func === 2 && blurLevels.length) rows.push(`<li><strong>模糊度：</strong>${blurLevels.join(', ')}%</li>`);
      if (STATE.func === 3 && soaLevels.length)  rows.push(`<li><strong>SOA：</strong>${soaLevels.join(', ')} ms</li>`);
      if (STATE.func === 4 && attLevels.length)  rows.push(`<li><strong>注意条件：</strong>${attLevels.join(', ')}</li>`);
      rows.push(`<li><strong>总题数：</strong>${trialCount}</li>`);
      pl.innerHTML = rows.join('');
    }
  }

  // ==================== 开始实验 ====================
  window.startExperiment = function() {
    // ★ 修复：检查 trialQueue 是否为空
    if (!STATE.trialQueue || STATE.trialQueue.length === 0) {
      UIHelper.showNotification('错误：没有生成的试次。请先点击"生成程序"按钮。', 'error');
      console.error('[startExperiment] trialQueue 为空，无法开始实验');
      return;
    }

    try {
      console.log('[startExperiment] 开始实验，试次数:', STATE.trialQueue.length);
      
      EventLogger.startSession({ subjectId: STATE.subjectId, phase: STATE.phase, func: STATE.func });
      
      // ★ 关键修复：确保实验界面正确显示
      console.log('[startExperiment] 显示实验界面');
      UIHelper.showScreen('exp');
      
      // 验证屏幕是否真的显示了
      const expScreen = document.getElementById('screen_exp');
      if (expScreen && !expScreen.classList.contains('active')) {
        console.warn('[startExperiment] 实验界面未激活，强制显示');
        expScreen.classList.add('active');
      }
      
      updateExperimentUI();
      setupExperimentVideoSources();
      
      console.log('[startExperiment] 开始第一个试次');
      startNextTrial();
      
    } catch (e) {
      console.error('[startExperiment] 实验启动失败:', e);
      UIHelper.showNotification('实验启动失败: ' + e.message, 'error');
    }
  };

  /**
   * 设置实验视频源，每个视频取对应材料（循环复用）
   * 修复：设置 source.src 后必须调用 video.load()
   * ★ 新增：添加错误处理，防止视频加载失败导致白屏
   */
  function setupExperimentVideoSources() {
    const mats = Config.MATERIALS;
    const n    = mats.length;

    // 功能2：单视频 → 取第一个材料
    const expVideo = document.getElementById('expVideo');
    const expSrc   = document.getElementById('expVideoSrc');
    if (expSrc) {
      expSrc.src = mats[0].video;
      if (expVideo) {
        expVideo.load();
        expVideo.onerror = function() {
          console.error('[Video] 功能2视频加载失败:', mats[0].video);
          UIHelper.showNotification('视频加载失败，请检查文件路径', 'error');
        };
      }
    }

    // 功能3：单视频 → 取第一个材料
    const expVideo3 = document.getElementById('expVideo3');
    const expSrc3   = document.getElementById('expVideo3Src');
    if (expSrc3) {
      expSrc3.src = mats[0].video;
      if (expVideo3) {
        expVideo3.load();
        expVideo3.onerror = function() {
          console.error('[Video] 功能3视频加载失败:', mats[0].video);
        };
      }
    }

    // 功能4：目标 / 干扰视频
    const expVideoTarget = document.getElementById('expVideoTarget');
    const expVideoDist   = document.getElementById('expVideoDist');
    const expTargetSrc   = document.getElementById('expTargetSrc');
    const expDistSrc     = document.getElementById('expDistSrc');
    if (expTargetSrc) {
      expTargetSrc.src = mats[0].video;
      if (expVideoTarget) {
        expVideoTarget.load();
        expVideoTarget.onerror = function() {
          console.error('[Video] 功能4目标视频加载失败:', mats[0].video);
        };
      }
    }
    if (expDistSrc) {
      expDistSrc.src = mats[1 % n].video;
      if (expVideoDist) {
        expVideoDist.load();
        expVideoDist.onerror = function() {
          console.error('[Video] 功能4干扰视频加载失败:', mats[1 % n].video);
        };
      }
    }
    
    console.log('[Video] 实验视频源设置完成');
  }

  /**
   * 根据当前试次的词语找到对应的视频/音频路径
   * @param {string} word - 试次词语（对应 Config.MATERIALS[i].label）
   * @returns {{ video:string, audio:string } | null}
   */
  function getMaterialForWord(word) {
    const mat = Config.MATERIALS.find(m => m.label === word);
    return mat || Config.MATERIALS[0];
  }

  function updateExperimentUI() {
    const funcNames  = { 1:'功能一', 2:'功能二', 3:'功能三', 4:'功能四' };

    const expTitleBar = document.getElementById('expTitleBar');
    if (expTitleBar) expTitleBar.textContent = funcNames[STATE.func];

    const expSubtitleBar = document.getElementById('expSubtitleBar');
    if (expSubtitleBar) expSubtitleBar.textContent = `被试 ${STATE.subjectId}`;

    const phaseTag = document.getElementById('expPhaseTag');
    if (phaseTag) phaseTag.textContent = '';

    // 显示对应功能视图
    [1,2,3,4].forEach(f => {
      const v = document.getElementById(`expView${f}`);
      if (v) v.classList.toggle('hidden', f !== STATE.func);
    });
  }

  // ==================== 试次流程 ====================
  
  /**
   * 显示"点击播放按钮开始"的提示
   * 在试次开始时调用，不显示具体题目
   */
  function showQuestionPrompt() {
    const q = document.getElementById('expQuestion');
    if (q) {
      q.textContent = '▶️ 点击播放按钮开始';
      q.classList.add('text-blue-500', 'font-bold');
    }
    
    // 隐藏选项或显示为"待播放"状态
    const buttons = document.querySelectorAll('#expChoices button');
    buttons.forEach(btn => {
      btn.textContent = '⏳ 等待...';
      btn.disabled = true;
      btn.className = 'choice-btn py-2.5 px-3 bg-gray-200 border-2 border-gray-300 rounded-xl text-center text-sm font-bold opacity-50';
    });
    
    console.log('[Trial] 显示播放提示，等待用户点击播放按钮');
  }

  async function startNextTrial() {
    // ★ 修复：清理可能存在的超时计时器
    if (responseTimeoutId) {
      clearTimeout(responseTimeoutId);
      responseTimeoutId = null;
      console.log('[startNextTrial] 已清理上一个超时计时器');
    }
    
    if (STATE.currentTrialIndex >= STATE.trialQueue.length) {
      showResults();
      return;
    }

    try {
      resetFeedback();

      const trial = STATE.trialQueue[STATE.currentTrialIndex];

      // ★ 修复：功能4 试次开始前显示目标位置提示（每次都显示）
      if (STATE.func === 4 && trial) {
        const side = trial.targetSide || 'left';
        const hintText = `📍 本试次请定位${side === 'left' ? '左侧' : '右侧'}目标说话人的内容`;
        
        // 使用覆盖层显示在视频上方
        const overlay = document.getElementById('trialOverlay');
        const overlayText = document.getElementById('trialOverlayText');
        if (overlay && overlayText) {
          overlayText.textContent = hintText;
          overlay.classList.remove('hidden');
        } else {
          // 如果覆盖层不存在，使用题目区域显示
          const q = document.getElementById('expQuestion');
          if (q) {
            q.innerHTML = `请定位<strong>${side === 'left' ? '左侧' : '右侧'}</strong>目标说话人的内容：`;
          }
        }
        
        // 1.5秒后自动隐藏覆盖层
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        if (overlay) overlay.classList.add('hidden');
      }

      // 洗牌选项（只做一次）
      if (!trial.shuffledChoices) {
        const correct = trial.correctAnswer;
        const others  = trial.choices.filter(c => c !== correct);
        for (let i = others.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [others[i], others[j]] = [others[j], others[i]];
        }
        // 将正确答案插入随机位置（0-3）
        const insertAt = Math.floor(Math.random() * 4);
        const shuffled = [...others.slice(0, 3)];
        shuffled.splice(insertAt, 0, correct);
        trial.shuffledChoices = shuffled;
        trial.correctIndex    = insertAt;
      }

      // ★ 修改：不在试次开始时显示题目，等用户点击播放按钮后再显示
      // updateTrialUI(trial);

      // ★ 新增：只显示"点击播放按钮开始"的提示
      showQuestionPrompt();

      STATE.isWaitingForResponse = false;
      STATE.isPlaying            = false;
      STATE.responseStartTime    = null;
      STATE.isReadyForPlay       = false;

      // 等待用户点击播放按钮
      enableChoiceButtons(false);

      // ★ 播放按钮先禁用，等所有DOM更新完成后再启用
      updatePlayButtonReady(false);

      // 使用 requestAnimationFrame 确保DOM渲染完成后再启用播放按钮
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          updatePlayButtonReady(true);
          console.log('[startNextTrial] 播放按钮已就绪');
        });
      });

    } catch(e) {
      console.error('开始试次失败:', e);
    }
  }

  function resetFeedback() {
    const fb   = document.getElementById('expFeedback');
    const fbTx = document.getElementById('expFeedbackText');
    if (fb)   { fb.classList.add('hidden'); fb.className = 'mt-2 p-3 rounded-xl text-center hidden'; }
    if (fbTx) fbTx.textContent = '';
  }

  function updateTrialUI(trial) {
    const n = STATE.trialQueue.length;
    const i = STATE.currentTrialIndex + 1;

    const prog = document.getElementById('expProgressText');
    if (prog) prog.textContent = `${i} / ${n}`;

    const bar = document.getElementById('expProgressBar');
    if (bar) bar.style.width = `${(i / n) * 100}%`;

    updateChoiceButtons(trial);
  }

  function updateChoiceButtons(trial) {
    if (!trial) return;
    const choices = trial.shuffledChoices || trial.choices || [];
    const buttons = document.querySelectorAll('#expChoices button');
    const labels  = ['A','B','C','D'];

    buttons.forEach((btn, idx) => {
      if (idx < choices.length) {
        btn.textContent = `${labels[idx]}. ${choices[idx]}`;
        btn.disabled    = true;
        btn.className   = 'choice-btn py-2.5 px-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-center text-base font-bold opacity-50';
        btn.onclick = (function(i) {
          return function() { submitAnswer(i); };
        })(idx);
      }
    });

    const q = document.getElementById('expQuestion');
    if (q) {
      const qs = {
        1:'请仔细听声音，选出您听到的音节：',
        2:'请结合口型，选出您看到/听到的音节：',
        3:'请注意两个说话人的关系，选出目标内容：',
        4:'请定位目标说话人，选出其内容：'
      };
      q.textContent = qs[STATE.func] || '请选择正确答案：';
    }
  }

  // 超时计时器 ID（用于取消超时）
  let responseTimeoutId = null;
  window.expPlay = async function() {
    // 防重复
    if (STATE.isPlaying) return;
    // ★ 防止未就绪时点击（选项和视频还没准备好）
    if (!STATE.isReadyForPlay) return;

    STATE.isPlaying = false;
    STATE.isWaitingForResponse = false;
    AudioProcessor.stopAllAudio();
    stopAllVideos();

    try {
      STATE.isPlaying         = true;
      STATE.responseStartTime = Date.now();

      const trial = STATE.trialQueue[STATE.currentTrialIndex];
      if (!trial) throw new Error('没有当前试次');

      // ★ 新增：在播放前显示题目
      updateTrialUI(trial);

      updatePlayButton(true);

      // ★ 关键修复：立即启用选项按钮，不等待播放完毕
      STATE.isWaitingForResponse = true;
      enableChoiceButtons(true);
      
      // ★ 修复：在点点击播放后立即启动超时计时器
      if (responseTimeoutId) clearTimeout(responseTimeoutId);
      responseTimeoutId = setTimeout(() => {
        if (STATE.isWaitingForResponse) {
          EventLogger.user('timeout', { trial: STATE.currentTrialIndex + 1 });
          submitAnswer(-1);
        }
      }, Config.RESPONSE_TIMEOUT);
      console.log('[expPlay] 超时计时器已启动，等待', Config.RESPONSE_TIMEOUT, 'ms');

      updateExpConditionDisplay(trial);

      EventLogger.user('click_play', {
        trial: STATE.currentTrialIndex + 1,
        snr: trial.snr, blur: trial.blur, soa: trial.soa, attention: trial.attention
      });

      // 根据材料找到对应视频/音频
      const mat = getMaterialForWord(trial.word);

      if (STATE.func === 1) {
        // 纯音频，用试次对应音频文件
        await AudioProcessor.playMixedAudioFile(mat.audio, trial.snr);
      } else if (STATE.func === 2) {
        // 更新视频为本次试次对应材料
        const video = document.getElementById('expVideo');
        const src   = document.getElementById('expVideoSrc');
        if (src && src.src !== new URL(mat.video, location.href).href) {
          src.src = mat.video;
          if (video) video.load();
        }
        if (video) {
          video.currentTime = 0;
          video.style.filter = trial.blur > 0 ? `blur(${trial.blur * Config.BLUR_CSS_FACTOR}px)` : 'none';
          await video.play();
        }
        await AudioProcessor.playMixedAudioFile(mat.audio, trial.snr);
      } else if (STATE.func === 3) {
        await playWithSOA(trial, mat);
      } else if (STATE.func === 4) {
        // ★ 修复：根据 trial.targetSide 动态设置视频源和标签
        const targetSide = trial.targetSide || 'left';
        
        // 动态更新视频标签
        const leftLabel = document.getElementById('expTargetLabel');
        const rightLabel = document.getElementById('expDistractorLabel');
        if (leftLabel && rightLabel) {
          if (targetSide === 'left') {
            // 目标在左
            leftLabel.textContent = '👤 目标';
            leftLabel.className = 'absolute top-1 left-1 bg-blue-600 text-white text-xs px-2 py-0.5 rounded';
            rightLabel.textContent = '🚫 干扰';
            rightLabel.className = 'absolute top-1 right-1 bg-red-600 text-white text-xs px-2 py-0.5 rounded';
          } else {
            // 目标在右
            leftLabel.textContent = '🚫 干扰';
            leftLabel.className = 'absolute top-1 left-1 bg-red-600 text-white text-xs px-2 py-0.5 rounded';
            rightLabel.textContent = '👤 目标';
            rightLabel.className = 'absolute top-1 right-1 bg-blue-600 text-white text-xs px-2 py-0.5 rounded';
          }
        }
        
        // 更新提示文本
        const expQuestion = document.getElementById('expQuestion');
        if (expQuestion) {
          expQuestion.innerHTML = `请定位<strong>${targetSide === 'left' ? '左侧' : '右侧'}</strong>目标说话人的内容：`;
        }
        
        // 根据目标位置决定哪个视频播放目标材料
        if (targetSide === 'left') {
          // 目标在左：左侧播放目标，右侧播放干扰（如果 dual）
          const targetVideo = document.getElementById('expVideoTarget');
          const targetSrc   = document.getElementById('expTargetSrc');
          if (targetSrc) targetSrc.src = mat.video;
          if (targetVideo) { targetVideo.load(); targetVideo.currentTime = 0; await targetVideo.play(); }
          
          if (trial.attention === 'dual') {
            const distIdx   = (Config.MATERIALS.findIndex(m => m.label === trial.word) + 1) % Config.MATERIALS.length;
            const distMat   = Config.MATERIALS[distIdx];
            const distVideo = document.getElementById('expVideoDist');
            const distSrc   = document.getElementById('expDistSrc');
            if (distSrc) distSrc.src = distMat.video;
            if (distVideo) { distVideo.load(); distVideo.currentTime = 0; await distVideo.play(); }
            
            // ★ 新增：同时播放目标音频和干扰音频并混音
            await AudioProcessor.playDualMixedAudioFile(mat.audio, distMat.audio, trial.snr);
          } else {
            // 单人模式：只播放目标音频
            await AudioProcessor.playMixedAudioFile(mat.audio, trial.snr);
          }
        } else {
          // 目标在右：右侧播放目标，左侧播放干扰（如果 dual）
          const targetVideo = document.getElementById('expVideoDist');  // 右侧视频
          const targetSrc   = document.getElementById('expDistSrc');
          if (targetSrc) targetSrc.src = mat.video;
          if (targetVideo) { targetVideo.load(); targetVideo.currentTime = 0; await targetVideo.play(); }
          
          if (trial.attention === 'dual') {
            const distIdx   = (Config.MATERIALS.findIndex(m => m.label === trial.word) + 1) % Config.MATERIALS.length;
            const distMat   = Config.MATERIALS[distIdx];
            const distVideo = document.getElementById('expVideoTarget'); // 左侧视频
            const distSrc   = document.getElementById('expTargetSrc');
            if (distSrc) distSrc.src = distMat.video;
            if (distVideo) { distVideo.load(); distVideo.currentTime = 0; await distVideo.play(); }
            
            // ★ 新增：同时播放目标音频和干扰音频并混音
            await AudioProcessor.playDualMixedAudioFile(mat.audio, distMat.audio, trial.snr);
          } else {
            // 单人模式：只播放目标音频
            await AudioProcessor.playMixedAudioFile(mat.audio, trial.snr);
          }
        }
      }
      
      STATE.isPlaying = false;
      updatePlayButton(false);
      // ★ 播放完成后禁用播放按钮，等待用户作答
      updatePlayButtonReady(false);
      
      console.log('[expPlay] 播放完成，等待用户作答...');
    } catch(e) {
      console.error('[expPlay] 播放失败:', e);
      STATE.isPlaying = false;
      STATE.isWaitingForResponse = false;
      updatePlayButton(false);
      updatePlayButtonReady(false);
      UIHelper.showNotification('播放失败，请重试', 'error');
    }
  };

  /**
   * 功能3：基于 SOA 的毫秒级音画同步（修改为单个视频窗口）
   * 功能3只有一个视频窗口，只是视频和音频的延时
   */
  async function playWithSOA(trial, mat) {
    const video = document.getElementById('expVideo3');
    const soa   = trial.soa || 0;
    
    if (!video) {
      await AudioProcessor.playMixedAudioFile(mat.audio, trial.snr);
      return;
    }
    
    // 功能3 只有一个视频窗口
    const src = document.getElementById('expVideo3Src');
    if (src) src.src = mat.video;
    video.load();
    
    video.currentTime = 0;
    
    EventLogger.stimulus('soa_start', { soa, trial: STATE.currentTrialIndex + 1 });
    
    // 根据SOA值调整视频和音频的播放时序
    if (soa > 0) {
      // 视频提前：先播放视频，延迟播放音频
      await video.play();
      await new Promise(r => setTimeout(r, soa));
      await AudioProcessor.playMixedAudioFile(mat.audio, trial.snr);
    } else if (soa < 0) {
      // 音频提前：先播放音频，延迟播放视频
      const audioPromise = AudioProcessor.playMixedAudioFile(mat.audio, trial.snr);
      await new Promise(r => setTimeout(r, Math.abs(soa)));
      await video.play();
      await audioPromise;
    } else {
      // 同步播放
      await video.play();
      await AudioProcessor.playMixedAudioFile(mat.audio, trial.snr);
    }
    
    EventLogger.stimulus('soa_complete', { soa });
    
    // 播放完后停止视频
    video.pause();
    video.currentTime = 0;
  }

  function updatePlayButton(isPlaying) {
    ['exp1PlayBtn','exp2PlayBtn','exp3PlayBtn','exp4PlayBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.disabled = isPlaying;
        btn.classList.toggle('opacity-50', isPlaying);
        btn.classList.toggle('play-pulse', !isPlaying);
        if (isPlaying) {
          btn.textContent = '🔊 播放中...';
        } else {
          const labels = {1:'▶️ 播放（按空格键）', 2:'▶️ 播放（按空格键）', 3:'▶️ 同步播放（按空格键）', 4:'▶️ 播放（按空格键）'};
          btn.textContent = labels[STATE.func] || '▶️ 播放';
        }
      }
    });
  }

  /**
   * 控制播放按钮是否就绪（选项和视频准备完成后才可点击）
   */
  function updatePlayButtonReady(ready) {
    STATE.isReadyForPlay = ready;
    ['exp1PlayBtn','exp2PlayBtn','exp3PlayBtn','exp4PlayBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.disabled = !ready;
        btn.classList.toggle('opacity-50', !ready);
        btn.classList.toggle('play-pulse', ready);
      }
    });
  }

  function updateExpConditionDisplay(trial) {
    if (STATE.func === 2) {
      const e2s = document.getElementById('exp2SNR');
      const e2b = document.getElementById('exp2Blur');
      if (e2s) e2s.textContent = trial.snr + ' dB';
      if (e2b) e2b.textContent = trial.blur + '%';
    }
    if (STATE.func === 3) {
      const e3snr = document.getElementById('exp3SNR');
      const e3soa = document.getElementById('exp3SOAValue');
      if (e3snr) e3snr.textContent = trial.snr + ' dB';
      if (e3soa) e3soa.textContent = trial.soa + ' ms';
    }
    if (STATE.func === 4) {
      const e4a = document.getElementById('exp4Att');
      const e4s = document.getElementById('exp4SNR');
      if (e4a) e4a.textContent = trial.attention === 'single' ? '单说话人' : '双说话人';
      if (e4s) e4s.textContent = trial.snr + ' dB';
    }
    if (STATE.func === 1) {
      const e1s = document.getElementById('expSNRDisplay');
      if (e1s) e1s.textContent = trial.snr + ' dB';
    }
  }

  function enableChoiceButtons(enabled) {
    document.querySelectorAll('#expChoices button').forEach(btn => {
      btn.disabled = !enabled;
      if (!enabled) {
        btn.className = 'choice-btn py-2.5 px-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-center text-base font-bold opacity-50';
      } else {
        btn.className = 'choice-btn py-2.5 px-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-center text-base font-bold cursor-pointer hover:bg-blue-50 hover:border-blue-400';
      }
    });
  }

  // ==================== 提交答案 ====================
  function submitAnswer(selectedIndex) {
    if (!STATE.isWaitingForResponse) {
      console.warn('[submitAnswer] 当前不在等待响应状态，忽略此次点击');
      return;
    }
    
    // ★ 修复：取消超时计时器
    if (responseTimeoutId) {
      clearTimeout(responseTimeoutId);
      responseTimeoutId = null;
      console.log('[submitAnswer] 已取消超时计时器');
    }
    
    try {
      STATE.isWaitingForResponse = false;
      const rt    = STATE.responseStartTime ? Date.now() - STATE.responseStartTime : 0;
      const trial = STATE.trialQueue[STATE.currentTrialIndex];
      if (!trial) return;

      const isCorrect = selectedIndex === trial.correctIndex;

      const result = {
        trial:      STATE.currentTrialIndex + 1,
        snr:        trial.snr,
        blur:       trial.blur || 0,
        soa:        trial.soa  || 0,
        attention:  trial.attention || 'single',
        word:       trial.word,
        correct:    isCorrect,
        selectedIndex,
        correctIndex: trial.correctIndex,
        rt:         rt > Config.RT_CEIL ? Config.RT_CEIL : rt,
        choice:     selectedIndex >= 0 ? ['A','B','C','D'][selectedIndex] : 'TIMEOUT',
        timestamp:  Date.now()
      };

      STATE.results.push(result);

      // ★ 立即渲染按钮颜色（不等 ITI）
      const buttons = document.querySelectorAll('#expChoices button');
      buttons.forEach((btn, idx) => {
        btn.disabled = true;
        if (idx === trial.correctIndex) {
          btn.className = 'choice-btn py-2.5 px-3 rounded-xl text-center text-base font-bold correct';
        } else if (idx === selectedIndex && !isCorrect) {
          btn.className = 'choice-btn py-2.5 px-3 rounded-xl text-center text-base font-bold wrong';
        } else {
          btn.className = 'choice-btn py-2.5 px-3 rounded-xl text-center text-base font-bold opacity-30';
        }
      });

      // ★ 立即显示反馈
      const fb   = document.getElementById('expFeedback');
      const fbTx = document.getElementById('expFeedbackText');
      if (fb && fbTx) {
        fb.classList.remove('hidden');
        if (isCorrect) {
          fb.className = 'mt-2 p-3 rounded-xl text-center bg-green-100 border border-green-300';
          fbTx.textContent = '✅ 回答正确！';
        } else if (selectedIndex === -1) {
          fb.className = 'mt-2 p-3 rounded-xl text-center bg-gray-100';
          fbTx.textContent = '⏰ 超时未作答';
        } else {
          const correctLabel = ['A','B','C','D'][trial.correctIndex];
          const correctWord  = (trial.shuffledChoices || trial.choices)[trial.correctIndex];
          fb.className = 'mt-2 p-3 rounded-xl text-center bg-red-100 border border-red-300';
          fbTx.textContent = `❌ 答案是 ${correctLabel}. ${correctWord}`;
        }
      }

      AudioProcessor.stopAllAudio();
      stopAllVideos();
      STATE.isPlaying = false;

      updateExperimentStats();

      STATE.currentTrialIndex++;

      // ★ 使用较短 ITI，让病人看到反馈后快速进入下一题
      setTimeout(() => {
        startNextTrial();
      }, Config.ITI);

    } catch(e) {
      console.error('提交答案失败:', e);
    }
  }

  function stopAllVideos() {
    document.querySelectorAll('video').forEach(v => v.pause());
  }

  function updateExperimentStats() {
    // Stats display removed per user request
  }

  // ==================== 结果 ====================
  function showResults() {
    AudioProcessor.stopAllAudio();
    stopAllVideos();
    if ('speechSynthesis' in window) speechSynthesis.cancel();

    EventLogger.endSession();

    if (STATE.results.length > 0) {
      try {
        const fitResult  = calculateThreshold();
        const threshold  = extractThresholdValue(fitResult);
        const metadata   = {
          subjectId: STATE.subjectId,
          phase:     STATE.phase,
          func:      STATE.func,
          snrMode:   STATE.snrMode,
          threshold, fitResult,
          eventLog: EventLogger.toJSON()
        };
        DataManager.saveExperimentData(metadata, STATE.results);
        DataManager.downloadToLocal(metadata, STATE.results, fitResult);
      } catch(e) {
        console.error('[Save] 保存失败:', e);
      }
    }

    UIHelper.showScreen('results');
    updateResultsUI();
  }

  function updateResultsUI() {
    const results = STATE.results;
    const n = results.length;
    if (n === 0) return;

    const corr     = results.filter(r => r.correct).length;
    const accuracy = Math.round(corr / n * 100);

    const rTotal = document.getElementById('rTotal');
    if (rTotal) rTotal.textContent = n;
    const rAcc = document.getElementById('rAcc');
    if (rAcc) rAcc.textContent = `${accuracy}%`;

    const validRTs = results.filter(r => r.rt < 10000).map(r => r.rt);
    const avgRT    = validRTs.length > 0 ? Math.round(validRTs.reduce((a,b)=>a+b,0)/validRTs.length) : 0;
    const rRT = document.getElementById('rRT');
    if (rRT) rRT.textContent = `${avgRT}ms`;

    const startTime = results[0].timestamp;
    const endTime   = results[results.length-1].timestamp;
    const durMin    = Math.round((endTime - startTime) / 60000);
    const rDur = document.getElementById('rDuration');
    if (rDur) rDur.textContent = durMin > 0 ? `${durMin}min` : '<1min';

    // 鼓励语
    const msg = document.getElementById('encourageMsg');
    if (msg) {
      const phaseMsg = {
        pre:   '基线测试完成，请告知工作人员，准备开始训练。',
        train: `训练完成！您的正确率是 ${accuracy}%，继续加油！`,
        post:  `后测完成，正确率 ${accuracy}%。请告知工作人员查看您的进步情况。`
      };
      msg.querySelector('div').textContent = phaseMsg[STATE.phase] || '本次训练已完成，请告知工作人员。';
    }

    const funcNames  = { 1:'功能一', 2:'功能二', 3:'功能三', 4:'功能四' };
    const phaseNames = { pre:'训练前测试', train:'训练中', post:'训练后测试' };
    const resSubtitle = document.getElementById('resSubtitle');
    if (resSubtitle) resSubtitle.textContent = `被试 ${STATE.subjectId} · ${funcNames[STATE.func]} · ${phaseNames[STATE.phase]}`;

    renderResultsTable();
    renderThreshold();
    renderResultsCharts();
  }

  function renderResultsTable() {
    const tbody = document.getElementById('resTableBody');
    const thead = document.getElementById('resTableHead');
    if (!tbody) return;

    if (thead) {
      let h = '<th class="p-2 text-left">题次</th><th class="p-2 text-left">SNR</th>';
      if (STATE.func === 2 || STATE.func === 3) h += '<th class="p-2 text-left">模糊</th>';
      if (STATE.func === 3) h += '<th class="p-2 text-left">SOA</th>';
      if (STATE.func === 4) h += '<th class="p-2 text-left">条件</th>';
      h += '<th class="p-2 text-left">词语</th><th class="p-2 text-left">正确</th><th class="p-2 text-left">反应时</th>';
      thead.innerHTML = h;
    }

    tbody.innerHTML = STATE.results.map(r => {
      const badge = r.correct
        ? '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">✅</span>'
        : (r.choice === 'TIMEOUT'
          ? '<span class="px-2 py-0.5 bg-gray-200 text-gray-500 rounded text-xs">⏰</span>'
          : '<span class="px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs">❌</span>');

      let row = `<tr class="border-t hover:bg-gray-50">
        <td class="p-2">${r.trial}</td>
        <td class="p-2">${r.snr} dB</td>`;
      if (STATE.func === 2 || STATE.func === 3) row += `<td class="p-2">${r.blur}%</td>`;
      if (STATE.func === 3)  row += `<td class="p-2">${r.soa} ms</td>`;
      if (STATE.func === 4)  row += `<td class="p-2">${r.attention === 'single' ? '单' : '双'}</td>`;
      row += `<td class="p-2">${r.word || '--'}</td>
        <td class="p-2">${badge}</td>
        <td class="p-2">${r.rt < 10000 ? r.rt + 'ms' : '--'}</td>
      </tr>`;
      return row;
    }).join('');
  }

  function renderThreshold() {
    const fitResult = calculateThreshold();
    const rThreshold = document.getElementById('rThreshold');
    const rThresholdLabel = document.getElementById('rThresholdLabel');
    const rThresholdDesc  = document.getElementById('rThresholdDesc');
    if (!rThreshold) return;

    const funcConfig = {
      1: { label:'噪音阈值 (SNR)', unit:'dB', desc:'Logistic拟合 80%正确率对应的SNR' },
      2: { label:'视觉增益', unit:'dB', desc:'清晰 vs 模糊口型的SNR差值' },
      3: { label:'整合时窗', unit:'ms', desc:'正确率≥80%的SOA范围' },
      4: { label:'干扰抑制成本', unit:'dB', desc:'双说话人 - 单说话人的SNR差值' }
    };
    const info = funcConfig[STATE.func];
    if (rThresholdLabel) rThresholdLabel.textContent = info.label;
    if (rThresholdDesc)  rThresholdDesc.textContent  = info.desc;

    let val = null;
    if (fitResult) {
      if (STATE.func === 1) val = fitResult.threshold;
      else if (STATE.func === 2) val = fitResult.gain;
      else if (STATE.func === 3) val = fitResult.window;
      else if (STATE.func === 4) val = fitResult.cost;
    }

    rThreshold.textContent = val !== null && val !== undefined
      ? `${val.toFixed(2)} ${info.unit}` : '--';
  }

  function renderResultsCharts() {
    const fitResult = calculateThreshold();
    const canvas    = document.getElementById('psychCurve');
    if (!canvas || !fitResult) return;

    if (STATE.func === 1) {
      Psychometric.drawCurve(canvas, fitResult, {
        title:'功能一：心理物理曲线', xLabel:'SNR (dB)', yLabel:'正确率', lineColor:'#6366f1'
      });
    } else if (STATE.func === 2 && fitResult.fitClear && fitResult.fitBlur) {
      drawDualCurves(canvas, fitResult.fitClear, fitResult.fitBlur, {
        title:'功能二：视觉增益', xLabel:'SNR (dB)', yLabel:'正确率',
        label1:`清晰(${fitResult.clearBlur}%)`, label2:`模糊(${fitResult.maxBlur}%)`,
        color1:'#6366f1', color2:'#f59e0b'
      });
    } else if (STATE.func === 3 && fitResult.fit) {
      Psychometric.drawCurve(canvas, fitResult.fit, {
        title:'功能三：视听整合时窗', xLabel:'SOA (ms)', yLabel:'正确率', lineColor:'#6366f1'
      });
    } else if (STATE.func === 4 && fitResult.fitSingle && fitResult.fitDual) {
      drawDualCurves(canvas, fitResult.fitSingle, fitResult.fitDual, {
        title:'功能四：注意干扰', xLabel:'SNR (dB)', yLabel:'正确率',
        label1:'单说话人', label2:'双说话人', color1:'#6366f1', color2:'#ef4444'
      });
    }
  }

  function drawDualCurves(canvas, fit1, fit2, opts) {
    const el = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!el || !fit1 || !fit2) return;
    const ctx = el.getContext('2d');
    const rect = el.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    el.width   = rect.width * dpr;
    el.height  = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    const mg = { top:50, right:30, bottom:50, left:55 };
    const pW = W - mg.left - mg.right, pH = H - mg.top - mg.bottom;

    ctx.fillStyle = '#fafafa'; ctx.fillRect(0,0,W,H);

    const allXs = [...fit1.data.map(d=>d.x), ...fit2.data.map(d=>d.x)];
    const xMin  = Math.min(...allXs), xMax = Math.max(...allXs);
    const xPad  = (xMax - xMin) * 0.15;

    const toX = x => mg.left + (x-(xMin-xPad))/(xMax-xMin+2*xPad)*pW;
    const toY = y => mg.top + pH - y/1.05*pH;

    ctx.strokeStyle='#e5e7eb'; ctx.lineWidth=0.5;
    for (let y=0;y<=1;y+=0.25) { ctx.beginPath(); ctx.moveTo(mg.left,toY(y)); ctx.lineTo(W-mg.right,toY(y)); ctx.stroke(); }

    ctx.strokeStyle='#10b981'; ctx.lineWidth=1; ctx.setLineDash([6,4]);
    ctx.beginPath(); ctx.moveTo(mg.left,toY(.8)); ctx.lineTo(W-mg.right,toY(.8)); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle='#10b981'; ctx.font='11px sans-serif'; ctx.textAlign='left';
    ctx.fillText('80%',W-mg.right-35,toY(.8)-5);

    [fit1,fit2].forEach((fit,idx) => {
      const color = idx===0 ? opts.color1 : opts.color2;
      const pts   = Psychometric.generateCurvePoints(fit,200);
      if (pts.length>0) {
        ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.beginPath();
        pts.forEach((pt,i)=>{ const cx=toX(pt.x),cy=toY(pt.y); i===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy); });
        ctx.stroke();
      }
      fit.data.forEach(d=>{
        const cx=toX(d.x), cy=toY(d.k/d.n), r=Math.max(3,Math.min(7,Math.sqrt(d.n)*1.3));
        ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
        ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.stroke();
      });
    });

    ctx.strokeStyle='#374151'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(mg.left,mg.top); ctx.lineTo(mg.left,mg.top+pH); ctx.lineTo(W-mg.right,mg.top+pH); ctx.stroke();
    ctx.fillStyle='#374151'; ctx.font='bold 12px sans-serif'; ctx.textAlign='center';
    ctx.fillText(opts.xLabel,W/2,H-8); ctx.fillText(opts.title,W/2,18);
    ctx.save(); ctx.translate(14,H/2); ctx.rotate(-Math.PI/2); ctx.fillText(opts.yLabel,0,0); ctx.restore();

    ctx.fillStyle='#6b7280'; ctx.font='11px sans-serif'; ctx.textAlign='center';
    const step=3;
    for (let x=Math.ceil((xMin-xPad)/step)*step; x<=xMax+xPad; x+=step) ctx.fillText(x.toFixed(0),toX(x),mg.top+pH+18);
    ctx.textAlign='right';
    for (let y=0;y<=1;y+=0.25) ctx.fillText((y*100).toFixed(0)+'%',mg.left-8,toY(y)+4);

    // 图例
    const legX=mg.left+10, legY=mg.top+12;
    ctx.fillStyle='rgba(255,255,255,.85)'; ctx.fillRect(legX,legY-12,180,40);
    ctx.strokeStyle='#d1d5db'; ctx.lineWidth=1; ctx.strokeRect(legX,legY-12,180,40);
    [[opts.label1,opts.color1,0],[opts.label2,opts.color2,18]].forEach(([lb,cl,dy])=>{
      ctx.strokeStyle=cl; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(legX+8,legY+dy); ctx.lineTo(legX+30,legY+dy); ctx.stroke();
      ctx.fillStyle='#374151'; ctx.font='11px sans-serif'; ctx.textAlign='left';
      ctx.fillText(lb,legX+36,legY+dy+4);
    });
  }

  // ==================== 历史记录（兼容旧调用，跳转新页面） ====================
  window.showHistory = function() {
    window.location.href = 'history.html';
  };

  // ==================== 键盘快捷键 ====================
  function handleKeyPress(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    const key = event.key.toLowerCase();

    if (key === ' ') {
      event.preventDefault();
      if (!STATE.isPlaying && !STATE.isWaitingForResponse) window.expPlay();
    }
    if (['a','b','c','d'].includes(key)) {
      const idx = key.charCodeAt(0) - 97;
      if (STATE.isWaitingForResponse) submitAnswer(idx);
    }
    if (key === 'escape') {
      if (confirm('确定要退出吗？')) showResults();
    }
  }

  // ==================== Hash 导航（浏览器前进/后退） ====================
  function handleHashChange() {
    const hash = window.location.hash.slice(1);
    if (hash && ['quick','guide','menu','prep','generate','exp','results','history'].includes(hash)) {
      UIHelper.showScreen(hash);
    }
  }

  // ==================== 数据导出 ====================
  window.exportResults = function() {
    try {
      const metadata = {
        subjectId: STATE.subjectId, phase: STATE.phase,
        func: STATE.func, snrMode: STATE.snrMode,
        threshold: calculateThreshold()
      };
      DataManager.saveExperimentData(metadata, STATE.results);
      UIHelper.showNotification('数据已保存', 'success');
    } catch(e) {
      UIHelper.showNotification('导出失败', 'error');
    }
  };

  function calculateThreshold() {
    if (STATE.results.length < 5) return null;
    if (STATE.func === 1) return Module1.calculateThreshold(STATE.results);
    if (STATE.func === 2) return Module2.calculateVisualGain(STATE.results);
    if (STATE.func === 3) return Module3.calculateIntegrationWindow(STATE.results);
    if (STATE.func === 4) return Module4.calculateInterferenceSuppressionCost(STATE.results);
    return null;
  }

  function extractThresholdValue(fit) {
    if (!fit) return null;
    if (fit.threshold !== undefined) return fit.threshold;
    if (fit.gain      !== undefined) return fit.gain;
    if (fit.window    !== undefined) return fit.window;
    if (fit.cost      !== undefined) return fit.cost;
    return null;
  }

  // ==================== 实用函数 ====================
  window.goToQuickScreen = function() { 
    UIHelper.showScreen('quick'); 
  };
  
  window.goToMenu = function() { UIHelper.showScreen('menu'); };

  window.confirmQuit = function() {
    UIHelper.showConfirm('确定要退出吗？当前进度将保存。', () => {
      exportResults();
      showResults();
    });
  };

  function getSelectedValues(selector) {
    return Array.from(document.querySelectorAll(selector))
      .filter(el => el.checked)
      .map(el => el.value.trim())
      .map(v => isNaN(v) ? v : parseInt(v));
  }

  // 兼容旧接口
  /**
   * 切换变量组的随机/顺序模式
   * @param {string} varType - 'snr' | 'blur' | 'soa' | 'att'
   * @param {string} mode - 'random' | 'seq'
   */
  window.setOrder = function(varType, mode) {
    orderState[varType] = mode;

    const btnR = document.getElementById(varType + 'OrderR');
    const btnS = document.getElementById(varType + 'OrderS');
    if (btnR && btnS) {
      const colorMap = { snr: 'blue', blur: 'purple', soa: 'orange', att: 'green' };
      const c = colorMap[varType] || 'blue';
      if (mode === 'random') {
        btnR.className = 'px-2 py-0.5 rounded bg-' + c + '-200 font-medium';
        btnS.className = 'px-2 py-0.5 rounded bg-gray-100';
      } else {
        btnR.className = 'px-2 py-0.5 rounded bg-gray-100';
        btnS.className = 'px-2 py-0.5 rounded bg-' + c + '-200 font-medium';
      }
    }
    console.log('[setOrder]', varType, '→', mode);
  };

  /**
   * SNR 模式切换回调（自适应/固定阈值/组合遍历）
   */
  window.updateSNRSettings = function() {
    const modeEl = document.getElementById('snrMode');
    const adaptiveInfo = document.getElementById('adaptiveInfo');
    if (!modeEl) return;
    const mode = modeEl.value;
    // 显示/隐藏自适应算法说明
    if (adaptiveInfo) {
      adaptiveInfo.style.display = (mode === 'adaptive') ? 'block' : 'none';
    }
    // 同步 STATE
    STATE.snrMode = mode;
    console.log('[updateSNRSettings] snrMode →', mode);
  };

  console.log('app.js v3.1 加载完成');
})();
