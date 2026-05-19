/**
 * @fileoverview 音频处理模块 v3.4 — 修复信号音无法播放问题
 * 
 * 核心修改：
 * 1. 信号音直接通过 &lt;audio&gt; 元素播放（不经过 Web Audio）
 * 2. 噪音继续通过 Web Audio 播放
 * 3. 两者同时播放，确保信号音能听到
 * 4. 添加了详细调试日志
 */

const AudioProcessor = (function () {
  'use strict';

  // ==================== 私有状态 ===================
  let audioContext = null;
  let noiseBuffer = null;
  let noiseSource = null;
  let noiseGainNode = null;
  let masterGainNode = null;
  let isPlaying = false;

  // ==================== 初始化 ===================
  
  async function initAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      masterGainNode = audioContext.createGain();
      masterGainNode.gain.value = 1.0;
      masterGainNode.connect(audioContext.destination);
      
      console.log('[Audio] AudioContext 已初始化');
    }
    
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
      console.log('[Audio] AudioContext 已恢复, 状态:', audioContext.state);
    }
    
    return audioContext;
  }

  // ==================== 噪音管理 ===================
  
  async function loadNoise() {
    if (noiseBuffer) {
      console.log('[Audio] 噪音缓冲区已存在，跳过加载');
      return noiseBuffer;
    }
    
    console.log('[Audio] 开始加载噪音文件:', Config.NOISE.white);
    
    try {
      const response = await fetch(Config.NOISE.white);
      console.log('[Audio] 噪音文件 fetch 响应:', response.status, response.statusText);
      
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        noiseBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.log('[Audio] ✓ 噪音文件加载成功');
        return noiseBuffer;
      } else {
        console.error('[Audio] ✗ 噪音文件 HTTP 错误:', response.status);
      }
    } catch (error) {
      console.error('[Audio] ✗ 噪音文件加载失败:', error);
    }
    
    console.warn('[Audio] 使用合成噪音作为备用');
    noiseBuffer = createSyntheticNoise();
    return noiseBuffer;
  }
  
  function createSyntheticNoise() {
    const sampleRate = audioContext.sampleRate;
    const length = sampleRate * 4;
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    
    let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    
    return buffer;
  }
  
  function startNoise() {
    stopNoiseSource();
    
    noiseSource = audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    
    noiseGainNode = audioContext.createGain();
    noiseGainNode.gain.setValueAtTime(0, audioContext.currentTime);
    noiseSource.connect(noiseGainNode);
    noiseGainNode.connect(masterGainNode);
    
    noiseSource.start();
    console.log('[Audio] ✓ 噪音已启动');
  }
  
  function stopNoiseSource() {
    if (noiseSource) {
      try { noiseSource.stop(); } catch (e) {}
      noiseSource.disconnect();
      noiseSource = null;
    }
    if (noiseGainNode) {
      noiseGainNode.disconnect();
      noiseGainNode = null;
    }
  }
  
  function setNoiseLevel(snr) {
    if (!noiseGainNode) {
      console.error('[Audio] ✗ noiseGainNode 未初始化');
      return;
    }
    
    const sigGain = Config.SIGNAL_GAIN;
    const noiseGainValue = sigGain * Math.pow(10, -snr / 20);
    const clamped = Math.min(noiseGainValue, sigGain * Config.NOISE_GAIN_CLAMP);
    
    console.log('[Audio] 设置噪音电平:', {
      snr: snr,
      signalGain: sigGain,
      noiseGain: clamped
    });
    
    const now = audioContext.currentTime;
    noiseGainNode.gain.cancelScheduledValues(now);
    noiseGainNode.gain.setValueAtTime(noiseGainNode.gain.value, now);
    noiseGainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, clamped), now + 0.02);
  }
  
  function fadeOutAndStopNoise() {
    if (noiseGainNode) {
      const now = audioContext.currentTime;
      noiseGainNode.gain.cancelScheduledValues(now);
      noiseGainNode.gain.setTargetAtTime(0, now, Config.NOISE_FADE_TIME);
      
      setTimeout(() => {
        stopNoiseSource();
      }, Config.NOISE_STOP_DELAY);
      
      console.log('[Audio] 噪音淡出中...');
    }
  }

  // ==================== 任务音频（不使用 Web Audio）====================
  
  function playTaskAudio(text) {
    return new Promise(async function (resolve, reject) {
      if (!('speechSynthesis' in window)) {
        reject(new Error('浏览器不支持语音合成'));
        return;
      }
      
      speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      
      utterance.onend = function () {
        console.log('[Audio] 语音合成播放结束');
        resolve();
      };
      
      utterance.onerror = function (e) {
        console.error('[Audio] 语音合成错误:', e.error);
        if (e.error === 'cancelled' || e.error === 'interrupted') {
          resolve();
        } else {
          reject(e);
        }
      };
      
      speechSynthesis.speak(utterance);
    });
  }

  /**
   * ★ 修复版：直接通过 &lt;audio&gt; 元素播放，不经过 Web Audio
   * 这样可以确保信号音一定能听到
   */
  async function playTaskAudioFile(audioPath) {
    return new Promise(async function (resolve, reject) {
      try {
        console.log('[Audio] [playTaskAudioFile] ========== 开始 ==========');
        console.log('[Audio] [playTaskAudioFile] 音频路径:', audioPath);
        
        // 创建 &lt;audio&gt; 元素
        console.log('[Audio] [playTaskAudioFile] 创建 &lt;audio&gt; 元素');
        const audioElement = document.createElement('audio');
        audioElement.style.display = 'none';
        document.body.appendChild(audioElement);
        
        // ★ 新增：设置音频输出设备
        const savedSinkId = localStorage.getItem('audioSinkId') || '';
        if (savedSinkId && typeof audioElement.setSinkId === 'function') {
          try {
            await audioElement.setSinkId(savedSinkId);
            console.log('[Audio] [playTaskAudioFile] ✓ 设置输出设备:', savedSinkId);
          } catch (err) {
            console.warn('[Audio] [playTaskAudioFile] ⚠ 设置输出设备失败:', err);
          }
        } else if (savedSinkId) {
          console.warn('[Audio] [playTaskAudioFile] ⚠ 浏览器不支持 setSinkId');
        }
        
        let resolved = false;
        
        function doResolve() {
          if (!resolved) {
            resolved = true;
            console.log('[Audio] [playTaskAudioFile] ✓ Promise resolve');
            // 清理
            try {
              audioElement.pause();
              document.body.removeChild(audioElement);
            } catch (e) {}
            resolve();
          }
        }
        
        function doReject(err) {
          if (!resolved) {
            resolved = true;
            console.error('[Audio] [playTaskAudioFile] ✗ Promise reject:', err);
            try {
              audioElement.pause();
              document.body.removeChild(audioElement);
            } catch (e) {}
            reject(err);
          }
        }
        
        // 错误事件
        audioElement.onerror = function() {
          const err = audioElement.error;
          console.error('[Audio] [playTaskAudioFile] ✗ 音频加载失败:', {
            code: err ? err.code : 'unknown',
            message: err ? err.message : 'unknown'
          });
          doReject(new Error('音频加载失败: ' + (err ? err.message : '未知错误')));
        };
        
        // 可以播放事件
        audioElement.oncanplaythrough = function() {
          console.log('[Audio] [playTaskAudioFile] ✓ canplaythrough 事件, readyState =', audioElement.readyState);
          console.log('[Audio] [playTaskAudioFile] 调用 play()...');
          
          audioElement.play().then(function() {
            console.log('[Audio] [playTaskAudioFile] ✓ play() 成功，音频正在播放');
          }).catch(function(err) {
            console.error('[Audio] [playTaskAudioFile] ✗ play() 失败:', err);
            doReject(err);
          });
        };
        
        // 播放结束事件
        audioElement.onended = function() {
          console.log('[Audio] [playTaskAudioFile] ✓ onended 事件触发');
          doResolve();
        };
        
        // 超时保护
        setTimeout(function() {
          if (!resolved) {
            console.warn('[Audio] [playTaskAudioFile] ⚠ 播放超时，强制结束');
            doResolve();
          }
        }, 10000);
        
        // 设置 src 并加载
        console.log('[Audio] [playTaskAudioFile] 设置 src =', audioPath);
        audioElement.src = audioPath;
        console.log('[Audio] [playTaskAudioFile] 调用 load()...');
        audioElement.load();
        
      } catch (error) {
        console.error('[Audio] [playTaskAudioFile] ✗ 异常:', error);
        reject(error);
      }
    });
  }

  // ==================== 核心混合播放 ===================
  
  async function playMixedAudio(taskText, snr, taskAudioPath) {
    try {
      console.log('[Audio] ========== 开始混合播放 ==========');
      console.log('[Audio] 参数:', { taskText, snr, taskAudioPath });
      
      isPlaying = true;
      
      console.log('[Audio] 1. 初始化音频上下文...');
      await initAudioContext();
      
      console.log('[Audio] 2. 加载噪音...');
      await loadNoise();
      
      console.log('[Audio] 3. 启动噪音 (SNR:', snr, 'dB)...');
      startNoise();
      
      console.log('[Audio] 4. 设置噪音电平...');
      setNoiseLevel(snr);
      
      console.log('[Audio] 5. 播放任务音频（直接通过 &lt;audio&gt; 元素）...');
      if (taskAudioPath) {
        console.log('[Audio] 使用文件路径:', taskAudioPath);
        await playTaskAudioFile(taskAudioPath);
      } else {
        console.log('[Audio] 使用语音合成:', taskText);
        await playTaskAudio(taskText);
      }
      console.log('[Audio] ✓ 任务音频播放完毕');
      
      console.log('[Audio] 6. 淡出并停止噪音...');
      fadeOutAndStopNoise();
      
      console.log('[Audio] ========== 混合播放完成 ==========');
      isPlaying = false;
    } catch (error) {
      console.error('[Audio] ✗ 混合音频播放失败:', error);
      fadeOutAndStopNoise();
      isPlaying = false;
      throw error;
    }
  }
  
  async function playMixedAudioAt(taskText, snr, delayMs) {
    try {
      isPlaying = true;
      delayMs = delayMs || 0;
      
      await initAudioContext();
      await loadNoise();
      
      startNoise();
      setNoiseLevel(snr);
      
      if (delayMs > 0) {
        await new Promise(function(resolve) { setTimeout(resolve, delayMs); });
      }
      
      await playTaskAudio(taskText);
      
      fadeOutAndStopNoise();
      isPlaying = false;
    } catch (error) {
      console.error('[Audio] 定时混合音频播放失败:', error);
      fadeOutAndStopNoise();
      isPlaying = false;
      throw error;
    }
  }
  
  async function playPreviewMixed(snr) {
    try {
      isPlaying = true;
      
      await initAudioContext();
      await loadNoise();
      
      startNoise();
      setNoiseLevel(snr);
      
      await playTaskAudio('测试');
      
      isPlaying = false;
    } catch (error) {
      console.error('[Audio] 预览播放失败:', error);
      fadeOutAndStopNoise();
      isPlaying = false;
      throw error;
    }
  }

  // ==================== 停止控制 ===================
  
  function stopAllAudio() {
    fadeOutAndStopNoise();
    
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }
    
    isPlaying = false;
    console.log('[Audio] 所有音频已停止');
  }

  // ==================== 查询接口 ===================
  
  function getAudioContext() {
    return audioContext;
  }
  
  function isAudioPlaying() {
    return isPlaying;
  }
  
  async function playMixedAudioFile(audioFilePath, snr) {
    return playMixedAudio(null, snr, audioFilePath);
  }

  /**
   * ★ 新增：同时播放两个音频文件并混音（用于双人模式）
   * @param {string} audioFile1 - 目标音频路径
   * @param {string} audioFile2 - 干扰音频路径
   * @param {number} snr - 信噪比
   */
  async function playDualMixedAudioFile(audioFile1, audioFile2, snr) {
    try {
      console.log('[Audio] ========== 开始双人混音播放 ==========');
      console.log('[Audio] 参数:', { audioFile1, audioFile2, snr });
      
      isPlaying = true;
      
      console.log('[Audio] 1. 初始化音频上下文...');
      await initAudioContext();
      
      console.log('[Audio] 2. 加载噪音...');
      await loadNoise();
      
      console.log('[Audio] 3. 启动噪音 (SNR:', snr, 'dB)...');
      startNoise();
      
      console.log('[Audio] 4. 设置噪音电平...');
      setNoiseLevel(snr);
      
      // 同时播放两个音频文件
      console.log('[Audio] 5. 同时播放两个音频文件...');
      const play1 = playTaskAudioFile(audioFile1);
      const play2 = playTaskAudioFile(audioFile2);
      
      await Promise.all([play1, play2]);
      console.log('[Audio] ✓ 两个音频文件播放完毕');
      
      console.log('[Audio] 6. 淡出并停止噪音...');
      fadeOutAndStopNoise();
      
      console.log('[Audio] ========== 双人混音播放完成 ==========');
      isPlaying = false;
    } catch (error) {
      console.error('[Audio] ✗ 双人混音音频播放失败:', error);
      fadeOutAndStopNoise();
      isPlaying = false;
      throw error;
    }
  }

  // ==================== 公共 API ===================

  
  // ==================== 音频输出设备选择 ===================
  
  async function enumerateAudioDevices() {
    try {
      // 需要先获取用户媒体权限才能看到设备标签
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        console.warn('[Audio] 无法获取麦克风权限，设备标签可能为空');
      }
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputDevices = devices.filter(d => d.kind === 'audiooutput');
      
      console.log('[Audio] 可用音频输出设备:', outputDevices);
      return outputDevices;
    } catch (err) {
      console.error('[Audio] 枚举音频设备失败:', err);
      return [];
    }
  }
  
  /**
   * 获取当前音频输出设备ID
   */
  function getCurrentSinkId() {
    return localStorage.getItem('audioSinkId') || '';
  }
  
  /**
   * 设置音频输出设备
   * @param {string} sinkId - 设备ID（空字符串表示默认设备）
   */
  function setAudioSinkId(sinkId) {
    localStorage.setItem('audioSinkId', sinkId);
    console.log('[Audio] 已保存音频输出设备:', sinkId || '（默认）');
  }

  /* ==================================================================
   * 精准时序专用：解码并缓存 AudioBuffer
   * 用于功能三的毫秒级 SOA 同步
   * ================================================================== */
  const _audioBufferCache = {};

  async function loadAudioBuffer(audioPath) {
    if (_audioBufferCache[audioPath]) return _audioBufferCache[audioPath];
    await initAudioContext();
    const resp = await fetch(audioPath);
    const arrayBuf = await resp.arrayBuffer();
    const buf = await audioContext.decodeAudioData(arrayBuf);
    _audioBufferCache[audioPath] = buf;
    return buf;
  }

  /**
   * 批量预加载并解码音频文件（并行）
   * 调用一次后，后续 loadAudioBuffer 直接命中缓存（<1ms）
   * @param {string[]} paths
   */
  async function preloadAudioBuffers(paths) {
    if (!Array.isArray(paths)) return;
    await initAudioContext();
    const tasks = paths.map(p => loadAudioBuffer(p).catch(e => {
      console.warn('[AudioProcessor] 预解码失败:', p, e && e.message);
    }));
    await Promise.all(tasks);
    console.log(`[AudioProcessor] 已预解码 ${paths.length} 个音频`);
  }

  function isAudioBufferCached(audioPath) {
    return !!_audioBufferCache[audioPath];
  }

  /**
   * 在指定 audioContext 时刻播放已缓存的音频（用于精准 SOA）
   * @param {string} audioPath - 音频路径
   * @param {number} startAt - audioContext.currentTime 坐标系下的精确启动时刻
   * @returns {Promise<{node: AudioBufferSourceNode, duration: number}>}
   *           Promise 在音频自然结束时 resolve
   */
  async function playAudioBufferScheduled(audioPath, startAt) {
    const buffer = await loadAudioBuffer(audioPath);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    // 通过专用 gain 连到目的（不经噪音通道）
    const taskGain = audioContext.createGain();
    taskGain.gain.value = 1.0;
    source.connect(taskGain).connect(audioContext.destination);
    return new Promise((resolve) => {
      source.onended = () => resolve({ node: source, duration: buffer.duration });
      source.start(Math.max(audioContext.currentTime, startAt));
    });
  }

  return {
    initAudioContext,
    loadNoise,
    setNoiseLevel,
    startNoise,
    fadeOutAndStopNoise,
    stopAllAudio,
    playMixedAudio,
    playMixedAudioFile,
    playDualMixedAudioFile,  // 新增：双人混音
    playMixedAudioAt,
    playPreviewMixed,
    playTaskAudio,
    playTaskAudioFile,
    // 精准时序
    loadAudioBuffer,
    preloadAudioBuffers,
    isAudioBufferCached,
    playAudioBufferScheduled,
    getAudioContext,
    isAudioPlaying,
    get VIDEO_FILES() { return Config.VIDEO_FILES; },
    get AUDIO_FILES() { return Config.AUDIO_FILES; },
    get NOISE_FILE() { return Config.NOISE.white; }
  };
})();
