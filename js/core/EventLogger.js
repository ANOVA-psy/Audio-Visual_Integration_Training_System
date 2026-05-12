/**
 * @fileoverview 全量原始事件记录器（Raw Event Logger）
 *
 * 心理学实验要求完整的行为日志，以便后期追溯异常：
 * "被试在第 15 试次按了 B 按钮后 300ms 又按了 C，是手滑还是 bug？"
 *
 * 与 DataManager（存试次结果）不同，EventLogger 记录的是**每一个用户操作**：
 * - 播放按钮点击时间
 * - 每个选项按钮的点击时间（包括重复点击）
 * - 键盘按键时间
 * - 屏幕切换时间
 * - 系统事件（音频播放开始/结束、视频 seek 等）
 *
 * 所有日志附带 performance.now() 毫秒级时间戳。
 */

const EventLogger = (function () {
  'use strict';

  /** @type {Array<Object>} 事件队列 */
  let events = [];

  /** @type {number|null} 实验开始时间（performance.now） */
  let sessionStart = null;

  /** @type {string|null} 当前被试 ID */
  let subjectId = null;

  /** @type {string|null} 当前阶段 */
  let phase = null;

  /** @type {number|null} 当前功能模块 */
  let func = null;

  // ==================== 会话管理 ====================

  /**
   * 开始一个新的日志会话
   * @param {Object} params
   * @param {string} params.subjectId - 被试编号
   * @param {string} params.phase - pre / train / post
   * @param {number} params.func - 功能模块 1~4
   */
  function startSession(params) {
    events = [];
    sessionStart = performance.now();
    subjectId = params.subjectId || 'S001';
    phase = params.phase || 'train';
    func = params.func || 1;

    log('system', 'session_start', {
      subjectId: subjectId,
      phase: phase,
      func: func,
      userAgent: navigator.userAgent,
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 结束当前会话
   */
  function endSession() {
    log('system', 'session_end', {
      duration: sessionStart ? performance.now() - sessionStart : 0
    });
  }

  // ==================== 日志记录 ====================

  /**
   * 记录一个事件
   * @param {string} category - 事件类别：'user' | 'system' | 'audio' | 'video' | 'stimulus'
   * @param {string} action - 事件动作名称
   * @param {Object} [data={}] - 附带数据
   */
  function log(category, action, data) {
    events.push({
      t: sessionStart ? performance.now() - sessionStart : 0,  // 相对于实验开始的毫秒数
      ts: Date.now(),                                             // 绝对时间戳
      cat: category,
      act: action,
      d: data || {}
    });
  }

  // ==================== 便捷方法 ====================

  /**
   * 记录用户操作
   * @param {string} action - 'click_play' | 'click_choice' | 'keypress' | 'click_exit'
   * @param {Object} [data]
   */
  function user(action, data) {
    log('user', action, data);
  }

  /**
   * 记录刺激呈现
   * @param {string} action - 'stimulus_start' | 'stimulus_end'
   * @param {Object} [data] - 包含 trial, snr, blur, soa 等
   */
  function stimulus(action, data) {
    log('stimulus', action, data);
  }

  /**
   * 记录音频事件
   * @param {string} action - 'noise_start' | 'noise_stop' | 'tts_start' | 'tts_end' | 'audio_error'
   * @param {Object} [data]
   */
  function audio(action, data) {
    log('audio', action, data);
  }

  /**
   * 记录视频事件
   * @param {string} action - 'video_play' | 'video_pause' | 'video_seek'
   * @param {Object} [data]
   */
  function video(action, data) {
    log('video', action, data);
  }

  /**
   * 记录系统事件
   * @param {string} action - 'screen_change' | 'error' | 'warning'
   * @param {Object} [data]
   */
  function system(action, data) {
    log('system', action, data);
  }

  // ==================== 数据获取 ====================

  /**
   * 获取全部原始事件日志
   * @returns {Array<Object>}
   */
  function getEvents() {
    return events.slice();
  }

  /**
   * 获取指定类别的事件
   * @param {string} category
   * @returns {Array<Object>}
   */
  function getByCategory(category) {
    return events.filter(e => e.cat === category);
  }

  /**
   * 导出为 JSON 字符串（用于数据存储）
   * @returns {string}
   */
  function toJSON() {
    return JSON.stringify({
      sessionInfo: {
        subjectId: subjectId,
        phase: phase,
        func: func,
        startTime: sessionStart,
        totalEvents: events.length,
        exportTime: new Date().toISOString()
      },
      events: events
    }, null, 2);
  }

  /**
   * 清空事件日志
   */
  function clear() {
    events = [];
    sessionStart = null;
    subjectId = null;
    phase = null;
    func = null;
  }

  // ==================== 公共 API ====================
  return {
    startSession,
    endSession,
    log,
    user,
    stimulus,
    audio,
    video,
    system,
    getEvents,
    getByCategory,
    toJSON,
    clear
  };
})();
