/**
 * @fileoverview 音频处理模块 v3.2 — 修复音频播放问题
 * 
 * 修复要点：
 * 1. playTaskAudioFile() 现在正确等待音频播放完毕后再 resolve Promise
 * 2. 简化了事件处理逻辑，去掉了有问题的 eventTriggered 标志
 * 3. 添加了更多错误日志，帮助定位问题
 */

const AudioProcessor = (function () {
  'use strict';

  // ==================== 私有状态 ===================
  let audioContext = null;
  let noiseBuffer = null;
  let noiseSource = null;
  let noiseGainNode = null;
  let taskSource = null;
  let signalGainNode = null;
  let taskAudioElement = null;
  let taskAudioSourceNode = null;
  let masterGainNode = null;
  let isPlaying = false;
  let isNoiseStarted = false;
  const audioCache = new Map();

  // ==================== 初始化 ===================
  
  async function initAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      masterGainNode = audioContext.createGain();
      masterGainNode.gain.value = 1.0;
      masterGainNode.connect(audioContext.destination);
      
      signalGainNode = audioContext.createGain();
      signalGainNode.gain.value = Config.SIGNAL_GAIN != null ? Config.SIGNAL_GAIN : 0.5;
      signalGainNode.connect(masterGainNode);
    }
    
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
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
        console.log('[Audio] 噪音文件大小:', arrayBuffer.byteLength, 'bytes');
        noiseBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.log('[Audio] ✓ 噪音文件加载成功并解码');
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
    isNoiseStarted = true;
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
    isNoiseStarted = false;
  }
  
  function setNoiseLevel(snr, signalGainValue) {
    if (!noiseGainNode) {
      console.error('[Audio] ✗ noiseGainNode 未初始化');
      return;
    }
    
    const sigGain = signalGainValue || Config.SIGNAL_GAIN;
    const noiseGainValue = sigGain * Math.pow(10, -snr / 20);
    const clamped = Math.min(noiseGainValue, sigGain * Config.NOISE_GAIN_CLAMP);
    
    console.log('[Audio] 设置噪音电平:', {
      snr: snr,
      signalGain: sigGain,
      calculatedNoiseGain: noiseGainValue,
      clampedNoiseGain: clamped,
      NOISE_GAIN_CLAMP: Config.NOISE_GAIN_CLAMP
    });
    
    const now = audioContext.currentTime;
    noiseGainNode.gain.cancelScheduledValues(now);
    noiseGainNode.gain.setValueAtTime(noiseGainNode.gain.value, now);
    noiseGainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, clamped), now + 0.02);
    
    console.log('[Audio] 噪音增益已设置:', noiseGainNode.gain.value);
  }
  
  function fadeOutAndStopNoise() {
    if (noiseGainNode && isNoiseStarted) {
      const now = audioContext.currentTime;
      noiseGainNode.gain.cancelScheduledValues(now);
      noiseGainNode.gain.setTargetAtTime(0, now, Config.NOISE_FADE_TIME);
      
      setTimeout(() => {
        stopNoiseSource();
      }, Config.NOISE_STOP_DELAY);
    }
  }

  // ==================== 任务音频 ===================
  
  /**
   * 通过语音合成播放文本
   */
  function playTaskAudio(text) {
    return new Promise(function (resolve, reject) {
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
   * ★ 修复版：播放任务音频文件
   * 每次创建新的 &lt;audio&gt; 元素以避免事件冲突
   * 确保音频能正常播放并被听到
   */
  function playTaskAudioFile(audioPath) {
    return new Promise(function (resolve, reject) {
      try {
        console.log('[Audio] [playTaskAudioFile] ========== 开始 ==========');
        console.log('[Audio] [playTaskAudioFile] 音频路径:', audioPath);
        
        // 每次创建新的 audio 元素（避免事件冲突）
        console.log('[Audio] [playTaskAudioFile] 创建新的 &lt;audio&gt; 元素');
        const audioElement = document.createElement('audio');
        audioElement.style.display = 'none';
        if (window.location.protocol !== 'file:') {
          audioElement.crossOrigin = 'anonymous';
        }
        document.body.appendChild(audioElement);
        
        // 创建 MediaElementSource 并连接到 signalGainNode
        console.log('[Audio] [playTaskAudioFile] 创建 MediaElementSource...');
        const sourceNode = audioContext.createMediaElementSource(audioElement);
        sourceNode.connect(signalGainNode);
        console.log('[Audio] [playTaskAudioFile] ✓ 已连接到 signalGainNode, signalGain =', signalGainNode.gain.value);
        
        let resolved = false;
        
        function doResolve() {
          if (!resolved) {
            resolved = true;
            console.log('[Audio] [playTaskAudioFile] ✓ Promise resolve');
            // 清理
            try {
              audioElement.pause();
              sourceNode.disconnect();
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
              sourceNode.disconnect();
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
            message: err ? err.message : 'unknown',
            readyState: audioElement.readyState,
            networkState: audioElement.networkState,
            currentSrc: audioElement.currentSrc
          });
          doReject(new Error('音频加载失败: ' + (err ? err.message : '未知错误')));
        };
        
        // 可以播放事件
        audioElement.oncanplaythrough = function() {
          console.log('[Audio] [playTaskAudioFile] ✓ canplaythrough 事件, readyState =', audioElement.readyState);
          console.log('[Audio] [playTaskAudioFile] 调用 play()...');
          
          audioElement.play().then(function() {
            console.log('[Audio] [playTaskAudioFile] ✓ play() Promise 已解决 (音频正在播放)');
            console.log('[Audio] [playTaskAudioFile] paused =', audioElement.paused, ', currentTime =', audioElement.currentTime);
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
      console.log('[Audio] 噪音已启动, isNoiseStarted:', isNoiseStarted);
      
      console.log('[Audio] 4. 设置噪音电平...');
      setNoiseLevel(snr, Config.SIGNAL_GAIN);
      
      console.log('[Audio] 5. 播放任务音频...');
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
      setNoiseLevel(snr, Config.SIGNAL_GAIN);
      
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
      setNoiseLevel(snr, Config.SIGNAL_GAIN);
      
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
    
    if (taskAudioElement) {
      taskAudioElement.pause();
      taskAudioElement.currentTime = 0;
    }
    
    if (taskSource) {
      try { taskSource.stop(); } catch (e) {}
      taskSource.disconnect();
      taskSource = null;
    }
    
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }
    
    isPlaying = false;
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

  // ==================== 公共 API ===================
  return {
    initAudioContext,
    loadNoise,
    setNoiseLevel,
    stopAllAudio,
    playMixedAudio,
    playMixedAudioFile,
    playMixedAudioAt,
    playPreviewMixed,
    playTaskAudio,
    playTaskAudioFile,
    getAudioContext,
    isAudioPlaying,
    get VIDEO_FILES() { return Config.VIDEO_FILES; },
    get AUDIO_FILES() { return Config.AUDIO_FILES; },
    get NOISE_FILE() { return Config.NOISE.white; }
  };
})();
