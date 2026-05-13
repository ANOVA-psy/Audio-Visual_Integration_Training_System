/**
 * @fileoverview 音频处理模块 v3 — Audio Graph 架构
 *
 * 重构要点：
 * 1. 所有参数从 Config 读取，不再硬编码
 * 2. 噪音增益使用 exponentialRampToValueAtTime 平滑过渡，避免咔哒声
 * 3. 明确的音频路由图：
 *    ┌─────────────┐     ┌────────────┐
 *    │ NoiseSource │──▶ │ noiseGain  │──┐
 *    └─────────────┘     └────────────┘  │   ┌────────────┐     ┌──────────────┐
 *                                        ├──▶│ masterGain │──▶ │ destination   │
 *    ┌─────────────┐     ┌────────────┐  │   └────────────┘     └──────────────┘
 *    │  TaskSource │──▶ │ signalGain │──┘
 *    └─────────────┘     └────────────┘
 *
 * 4. SNR 控制公式：noiseGain = signalGain × 10^((signal_dB - SNR) / 20)
 *    等价于：noiseGain = signalGain × 10^(-SNR/20)（当 signal_dB = 0 时）
 *
 * 5. 音频缓存：通过 AudioBuffer 缓存在内存中，减少 fetch 延迟
 */

const AudioProcessor = (function () {
  'use strict';

  // ==================== 私有状态 ====================
  /** @type {AudioContext|null} */
  let audioContext = null;
  /** @type {AudioBuffer|null} */
  let noiseBuffer = null;
  /** @type {BufferSourceNode|null} */
  let noiseSource = null;
  /** @type {GainNode|null} */
  let noiseGainNode = null;
  /** @type {BufferSourceNode|null} */
  let taskSource = null;
  /** @type {GainNode|null} */
  let signalGainNode = null;
  /** @type {HTMLAudioElement|null} 任务音频元素（用于播放 mp4 等视频容器中的音频） */
  let taskAudioElement = null;
  /** @type {MediaElementAudioSourceNode|null} */
  let taskAudioSourceNode = null;
  /** @type {GainNode|null} */
  let masterGainNode = null;
  /** @type {boolean} */
  let isPlaying = false;
  /** @type {boolean} */
  let isNoiseStarted = false;
  /** @type {Map<string, AudioBuffer>} 音频文件缓存 */
  const audioCache = new Map();

  // ==================== 初始化 ====================

  /**
   * 初始化 AudioContext（惰性创建，需用户交互后调用）
   * @returns {Promise<AudioContext>}
   */
  async function initAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // 构建 audio graph: masterGain → destination
      masterGainNode = audioContext.createGain();
      masterGainNode.gain.value = 1.0;
      masterGainNode.connect(audioContext.destination);

      // ★ signalGainNode：任务音频增益节点（持久化，只创建一次）
      signalGainNode = audioContext.createGain();
      signalGainNode.gain.value = Config.SIGNAL_GAIN != null ? Config.SIGNAL_GAIN : 0.5;
      signalGainNode.connect(masterGainNode);
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    if (typeof EventLogger !== 'undefined') {
      EventLogger.audio('context_init', { sampleRate: audioContext.sampleRate });
    }

    return audioContext;
  }

  // ==================== 噪音管理 ====================

  /**
   * 加载白噪音文件并解码为 AudioBuffer（仅首次加载，后续使用缓存）
   * 如果文件不存在，自动使用合成噪音
   * @returns {Promise<AudioBuffer>}
   */
  async function loadNoise() {
    if (noiseBuffer) return noiseBuffer;

    // 尝试加载 WAV 文件
    try {
      const response = await fetch(Config.NOISE.white);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        noiseBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        if (typeof EventLogger !== 'undefined') {
          EventLogger.audio('noise_loaded', {
            duration: noiseBuffer.duration,
            channels: noiseBuffer.numberOfChannels,
            sampleRate: noiseBuffer.sampleRate,
            source: 'file'
          });
        }
        
        console.log('[Audio] 噪音文件加载成功');
        return noiseBuffer;
      }
    } catch (error) {
      console.warn('[Audio] 噪音文件加载失败，使用合成噪音:', error);
    }
    
    // 备用方案：生成合成粉红噪音
    console.log('[Audio] 使用合成噪音');
    noiseBuffer = createSyntheticNoise();
    return noiseBuffer;
  }

  /**
   * 生成合成粉红噪音（备用方案，无需网络请求）
   * @returns {AudioBuffer}
   */
  function createSyntheticNoise() {
    const sampleRate = audioContext.sampleRate;
    const length = sampleRate * 4; // 4 秒
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
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

    if (typeof EventLogger !== 'undefined') {
      EventLogger.audio('noise_synthesized', { duration: 4, sampleRate: sampleRate });
    }

    return buffer;
  }

  /**
   * 启动噪音源（GainNode 初始为 0，静音状态）
   * 构建路由：noiseBuffer → noiseGainNode → masterGainNode → destination
   */
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

    if (typeof EventLogger !== 'undefined') {
      EventLogger.audio('noise_start', { loop: true });
    }
  }

  /**
   * 停止噪音源（彻底断开节点，非静音）
   */
  function stopNoiseSource() {
    if (noiseSource) {
      try { noiseSource.stop(); } catch (e) { /* ignore */ }
      noiseSource.disconnect();
      noiseSource = null;
    }
    if (noiseGainNode) {
      noiseGainNode.disconnect();
      noiseGainNode = null;
    }
    isNoiseStarted = false;
  }

  /**
   * 根据 SNR 设置噪音增益（核心公式）
   *
   * 公式推导：
   *   SNR = 20 × log10(signal_rms / noise_rms)
   *   noise_rms = signal_rms × 10^(-SNR/20)
   *   noiseGain = signalGain × 10^(-SNR/20)
   *
   * 使用 exponentialRampToValueAtTime 平滑过渡（20ms），避免咔哒声。
   *
   * @param {number} snr - 信噪比（dB）
   * @param {number} [signalGainValue] - 语音信号增益，默认使用 Config.SIGNAL_GAIN
   */
  function setNoiseLevel(snr, signalGainValue) {
    if (!noiseGainNode) return;

    const sigGain = signalGainValue || Config.SIGNAL_GAIN;
    // ★ 核心公式：noiseGain = signalGain × 10^(-SNR/20)
    const noiseGainValue = sigGain * Math.pow(10, -snr / 20);
    // 钳位，防止噪音过大导致削波
    const clamped = Math.min(noiseGainValue, sigGain * Config.NOISE_GAIN_CLAMP);

    // ★ 平滑过渡：使用 exponentialRamp（避免 setValueAtTime 产生的咔哒声）
    const now = audioContext.currentTime;
    noiseGainNode.gain.cancelScheduledValues(now);
    noiseGainNode.gain.setValueAtTime(noiseGainNode.gain.value, now);
    noiseGainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, clamped), now + 0.02);

    if (typeof EventLogger !== 'undefined') {
      EventLogger.audio('snr_set', {
        snr: snr,
        signalGain: sigGain,
        noiseGain: clamped,
        method: 'exponentialRamp'
      });
    }
  }

  /**
   * 淡出并停止噪音（使用 setTargetAtTime 指数衰减）
   */
  function fadeOutAndStopNoise() {
    if (noiseGainNode && isNoiseStarted) {
      const now = audioContext.currentTime;
      noiseGainNode.gain.cancelScheduledValues(now);
      noiseGainNode.gain.setTargetAtTime(0, now, Config.NOISE_FADE_TIME);

      setTimeout(() => {
        stopNoiseSource();
      }, Config.NOISE_STOP_DELAY);

      if (typeof EventLogger !== 'undefined') {
        EventLogger.audio('noise_fadeout', { tau: Config.NOISE_FADE_TIME });
      }
    }
  }

  // ==================== 任务音频 ====================

  /**
   * TTS 合成语音播放
   * @param {string} text - 要播放的文本
   * @returns {Promise<void>}
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

      if (typeof EventLogger !== 'undefined') {
        EventLogger.audio('tts_start', { text: text });
      }

      utterance.onend = function () {
        if (typeof EventLogger !== 'undefined') EventLogger.audio('tts_end', { text: text });
        resolve();
      };
      utterance.onerror = function (e) {
        if (e.error === 'canceled' || e.error === 'interrupted') {
          resolve();
        } else {
          if (typeof EventLogger !== 'undefined') EventLogger.audio('tts_error', { error: e.error });
          reject(e);
        }
      };

      speechSynthesis.speak(utterance);
    });
  }

  /**
   * 从缓存或网络加载音频文件为 AudioBuffer
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<AudioBuffer>}
   */
  async function loadAudioBuffer(audioPath) {
    if (audioCache.has(audioPath)) {
      return audioCache.get(audioPath);
    }

    const response = await fetch(audioPath);
    if (!response.ok) throw new Error('HTTP ' + response.status);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(arrayBuffer);
    audioCache.set(audioPath, buffer);

    return buffer;
  }

  /**
   * 通过 Web Audio API 播放任务音频文件
   * 路由：audioBuffer → signalGainNode → masterGainNode → destination
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<void>}
   */
  /**
   * ★ 重写：通过 <audio> 元素播放任务音频文件（支持 mp4 视频容器中的音频轨道）
   * 使用 MediaElementAudioSourceNode 接入 Web Audio 图，与噪音混合输出
   * @param {string} audioPath - 音频文件路径（支持 mp4/webm/mp3/wav 等）
   * @returns {Promise<void>}
   */
  function playTaskAudioFile(audioPath) {
    return new Promise(function (resolve, reject) {
      try {
        // 创建 <audio> 元素（仅一次），并创建对应的 MediaElementAudioSourceNode（仅一次）
        if (!taskAudioElement) {
          taskAudioElement = document.createElement('audio');
          taskAudioElement.style.display = 'none';
          // ★ 不在 file:// 协议下设置 crossOrigin，否则会导致加载失败
          if (window.location.protocol !== 'file:') {
            taskAudioElement.crossOrigin = 'anonymous';
          }
          document.body.appendChild(taskAudioElement);

          // ★ 每个 <audio> 元素只能创建一个 MediaElementAudioSourceNode
          taskAudioSourceNode = audioContext.createMediaElementSource(taskAudioElement);
          taskAudioSourceNode.connect(signalGainNode);
        }

        // ★ 关键修复：先添加事件监听器，再设置 src
        // 否则可能错过 canplaythrough 事件
        let eventTriggered = false;
        
        // 错误监听（必须在设置 src 之前）
        var onError = function (e) {
          if (eventTriggered) return;
          eventTriggered = true;
          taskAudioElement.removeEventListener('error', onError);
          taskAudioElement.removeEventListener('canplaythrough', onCanPlay);
          console.error('[Audio] 音频加载失败:', audioPath, e);
          reject(new Error('音频加载失败: ' + audioPath));
        };
        taskAudioElement.addEventListener('error', onError, { once: true });

        // canplaythrough: 音频已足够加载，可以播放
        var onCanPlay = function () {
          if (eventTriggered) return;
          eventTriggered = true;
          taskAudioElement.removeEventListener('error', onError);
          taskAudioElement.removeEventListener('canplaythrough', onCanPlay);
          
          console.log('[Audio] 音频准备就绪，开始播放:', audioPath);
          
          // ★ 修复：只播放，不在这里resolve，等待onended事件
          taskAudioElement.play().catch(function (err) {
            console.error('[Audio] 播放失败:', audioPath, err);
            reject(err);
          });
        };
        taskAudioElement.addEventListener('canplaythrough', onCanPlay, { once: true });

        // ★ 超时保护：5秒后强制继续（防止事件未触发导致卡死）
        setTimeout(function () {
          if (!eventTriggered) {
            eventTriggered = true;
            taskAudioElement.removeEventListener('error', onError);
            taskAudioElement.removeEventListener('canplaythrough', onCanPlay);
            console.warn('[Audio] 音频加载超时，尝试直接播放:', audioPath);
            // 尝试直接播放
            taskAudioElement.play().then(function () {
              resolve();
            }).catch(function (err) {
              reject(new Error('音频加载超时: ' + audioPath));
            });
          }
        }, 5000);

        // 播放结束事件（必须在设置 src 之前）
        taskAudioElement.onended = function () {
          if (eventTriggered) return;
          eventTriggered = true;
          console.log('[Audio] 音频播放结束:', audioPath);
          if (typeof EventLogger !== 'undefined') {
            EventLogger.audio('file_end', { path: audioPath });
          }
          resolve();
        };

        if (typeof EventLogger !== 'undefined') {
          EventLogger.audio('file_start', { path: audioPath, method: 'MediaElement' });
        }

        // 设置 src 并加载（在事件监听器添加之后）
        console.log('[Audio] 开始加载音频:', audioPath);
        taskAudioElement.src = audioPath;
        taskAudioElement.load();

      } catch (error) {
        console.error('[Audio] 任务音频播放失败:', error);
        if (typeof EventLogger !== 'undefined') {
          EventLogger.audio('file_error', { error: error.message });
        }
        reject(error);
      }
    });
  }

  // ==================== 核心混合播放 ====================

  /**
   * ★ 核心接口：混合播放噪音 + 任务音频
   *
   * Audio Graph 路由（此方法启动后）：
   *   [NoiseSource] → [noiseGain]  ─┐
   *                                 ├──▶ [masterGain] → [speakers]
   *   [TaskSource]  → [signalGain] ─┘
   *
   * @param {string} taskText - TTS 文本
   * @param {number} snr - 信噪比（dB）
   * @param {string} [taskAudioPath] - 任务音频文件路径（可选，优先使用文件）
   * @returns {Promise<void>}
   */
  async function playMixedAudio(taskText, snr, taskAudioPath) {
    try {
      isPlaying = true;

      await initAudioContext();
      await loadNoise();

      // 步骤 1：启动噪音（静音状态）
      startNoise();

      // 步骤 2：根据 SNR 设置噪音增益（带平滑过渡）
      setNoiseLevel(snr, Config.SIGNAL_GAIN);

      // 步骤 3：播放任务音频（噪音同时在进行）
      if (taskAudioPath) {
        await playTaskAudioFile(taskAudioPath);
      } else {
        await playTaskAudio(taskText);
      }

      // 步骤 4：任务音频播放完毕 → 淡出停止噪音
      fadeOutAndStopNoise();

      isPlaying = false;
    } catch (error) {
      console.error('[Audio] 混合音频播放失败:', error);
      fadeOutAndStopNoise();
      isPlaying = false;
      throw error;
    }
  }

  /**
   * 在指定时间点播放任务音频（用于功能 3 的毫秒级 SOA 同步）
   *
   * @param {string} taskText - TTS 文本
   * @param {number} snr - 信噪比
   * @param {number} [delayMs=0] - 延迟毫秒数（基于 audioContext.currentTime）
   * @returns {Promise<void>}
   */
  async function playMixedAudioAt(taskText, snr, delayMs) {
    try {
      isPlaying = true;
      delayMs = delayMs || 0;

      await initAudioContext();
      await loadNoise();

      // 启动噪音
      startNoise();
      setNoiseLevel(snr, Config.SIGNAL_GAIN);

      if (delayMs > 0) {
        // 等待延迟
        await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
      }

      // 播放任务音频
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

  /**
   * 预览用混合播放（手动停止版本）
   * @param {number} snr - 信噪比
   * @returns {Promise<void>}
   */
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

  // ==================== 停止控制 ====================

  /**
   * 停止所有音频（彻底停止 + 清理临时节点）
   * ★ 不清理 signalGainNode（持久化节点，始终连接到 masterGainNode）
   */
  function stopAllAudio() {
    fadeOutAndStopNoise();

    // ★ 只停止 <audio> 元素，不断开 signalGainNode
    if (taskAudioElement) {
      taskAudioElement.pause();
      taskAudioElement.currentTime = 0;
    }
    // ★ 不清理 taskAudioSourceNode（它是持久化的，只创建一次）
    // 如果清理，下次 playTaskAudioFile() 时会报错

    // 兼容旧代码：停止旧 taskSource（如有）
    if (taskSource) {
      try { taskSource.stop(); } catch (e) { /* ignore */ }
      taskSource.disconnect();
      taskSource = null;
    }
    // ★ 不断开 signalGainNode！它应该持久化
    // if (signalGainNode) {
    //   signalGainNode.disconnect();
    //   signalGainNode = null;
    // }

    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }

    isPlaying = false;

    if (typeof EventLogger !== 'undefined') {
      EventLogger.audio('all_stopped');
    }
  }

  // ==================== 查询接口 ====================

  function getAudioContext() {
    return audioContext;
  }

  function isAudioPlaying() {
    return isPlaying;
  }

  /**
   * ★ 快捷接口：通过音频文件路径混合播放（配合 MATERIALS 使用）
   *
   * 等价于 playMixedAudio(null, snr, audioFilePath)，
   * 避免调用方需要区分 TTS / 文件两种模式。
   *
   * @param {string} audioFilePath - 音频文件路径（如 'assets/audio/M8_ba_A.mp4'）
   * @param {number} snr - 信噪比（dB）
   * @returns {Promise<void>}
   */
  async function playMixedAudioFile(audioFilePath, snr) {
    return playMixedAudio(null, snr, audioFilePath);
  }

  // ==================== 公共 API ====================
  return {
    initAudioContext,
    loadNoise,
    setNoiseLevel,
    stopAllAudio,
    playMixedAudio,
    playMixedAudioFile,  // ★ 新增：通过文件路径播放（配合 MATERIALS）
    playMixedAudioAt,    // ★ SOA 延迟播放
    playPreviewMixed,
    playTaskAudio,
    playTaskAudioFile,
    getAudioContext,
    isAudioPlaying,
    // 向后兼容
    get VIDEO_FILES() { return Config.VIDEO_FILES; },
    get AUDIO_FILES() { return Config.AUDIO_FILES; },
    get NOISE_FILE() { return Config.NOISE.white; }
  };
})();
