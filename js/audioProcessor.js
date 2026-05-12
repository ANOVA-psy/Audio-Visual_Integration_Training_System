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

      // 构建 master → destination 路由
      masterGainNode = audioContext.createGain();
      masterGainNode.gain.value = 1.0;
      masterGainNode.connect(audioContext.destination);
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
   * @returns {Promise<AudioBuffer>}
   */
  async function loadNoise() {
    if (noiseBuffer) return noiseBuffer;

    try {
      const response = await fetch(Config.NOISE.white);
      if (!response.ok) throw new Error('HTTP ' + response.status);

      const arrayBuffer = await response.arrayBuffer();
      noiseBuffer = await audioContext.decodeAudioData(arrayBuffer);

      if (typeof EventLogger !== 'undefined') {
        EventLogger.audio('noise_loaded', {
          duration: noiseBuffer.duration,
          channels: noiseBuffer.numberOfChannels,
          sampleRate: noiseBuffer.sampleRate
        });
      }

      return noiseBuffer;
    } catch (error) {
      console.warn('[Audio] 噪音文件加载失败，使用合成噪音:', error);
      noiseBuffer = createSyntheticNoise();
      return noiseBuffer;
    }
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
  function playTaskAudioFile(audioPath) {
    return new Promise(async function (resolve, reject) {
      try {
        const audioBuffer = await loadAudioBuffer(audioPath);

        // 停止之前的任务音频
        if (taskSource) {
          try { taskSource.stop(); } catch (e) { /* ignore */ }
          taskSource.disconnect();
        }

        taskSource = audioContext.createBufferSource();
        taskSource.buffer = audioBuffer;

        signalGainNode = audioContext.createGain();
        signalGainNode.gain.value = Config.SIGNAL_GAIN;
        taskSource.connect(signalGainNode);
        signalGainNode.connect(masterGainNode);

        if (typeof EventLogger !== 'undefined') {
          EventLogger.audio('file_start', { path: audioPath, duration: audioBuffer.duration });
        }

        taskSource.onended = function () {
          if (typeof EventLogger !== 'undefined') EventLogger.audio('file_end', { path: audioPath });
          resolve();
        };

        taskSource.start();
      } catch (error) {
        console.error('[Audio] 任务音频播放失败:', error);
        if (typeof EventLogger !== 'undefined') EventLogger.audio('file_error', { error: error.message });
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
   * 停止所有音频（彻底停止 + 清理节点）
   */
  function stopAllAudio() {
    fadeOutAndStopNoise();

    if (taskSource) {
      try { taskSource.stop(); } catch (e) { /* ignore */ }
      taskSource.disconnect();
      taskSource = null;
    }
    if (signalGainNode) {
      signalGainNode.disconnect();
      signalGainNode = null;
    }

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

  // ==================== 公共 API ====================
  return {
    initAudioContext,
    loadNoise,
    setNoiseLevel,
    stopAllAudio,
    playMixedAudio,
    playMixedAudioAt,    // ★ 新增：支持 SOA 延迟的定时播放
    playPreviewMixed,
    playTaskAudio,
    playTaskAudioFile,
    getAudioContext,
    isAudioPlaying,
    // 向后兼容：保留 VIDEO_FILES 和 AUDIO_FILES 引用
    get VIDEO_FILES() { return Config.VIDEO_FILES; },
    get AUDIO_FILES() { return Config.AUDIO_FILES; },
    get NOISE_FILE() { return Config.NOISE.white; }
  };
})();
