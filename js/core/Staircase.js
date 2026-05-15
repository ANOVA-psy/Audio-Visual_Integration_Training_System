/**
 * @fileoverview 通用阶梯法（Staircase）自适应算法
 *
 * 实现经典的 1-up / N-down 阶梯法，用于心理物理学实验中动态调整
 * 刺激强度（SNR）。功能 1~4 共用此类，保证阈值计算标准一致。
 *
 * 核心逻辑：
 * - 连续答对 N 次（ADAPTIVE_DOWN） → 难度升级（SNR 减小 1 步）
 * - 连续答错 1 次（ADAPTIVE_UP）   → 难度降级（SNR 增大 1 步）
 * - 累积反转达到 maxReversals 次 → 实验结束
 * - 阈值 = 最后若干次反转点 SNR 的平均值
 *
 * @example
 *   const sc = new Staircase({
 *     startValue: 0,
 *     stepSize: 3,
 *     min: -12,
 *     max: 6,
 *     downRule: 3,
 *     upRule: 1,
 *     maxReversals: 8
 *   });
 *
 *   sc.nextTrial(snr);  // → 获取当前 SNR
 *   sc.record(isCorrect);  // → 记录反应，自动调整
 *   sc.getThreshold();  // → 获取阈值
 *   sc.isFinished();  // → 检查是否完成
 */

const Staircase = (function () {
  'use strict';

  /**
   * @typedef {Object} StaircaseOptions
   * @property {number} [startValue=0]     - 起始 SNR 值
   * @property {number} [stepSize=3]       - 每步变化的 SNR 量
   * @property {number} [min=-18]          - SNR 下限
   * @property {number} [max=9]            - SNR 上限
   * @property {number} [downRule=3]       - 连续答对 N 次后升级（变难）
   * @property {number} [upRule=1]         - 答错 1 次后降级（变易）
   * @property {number} [maxReversals=8]   - 反转次数停止阈值
   * @property {number} [warmUpTrials=0]   - 预热试次数（不计入反转）
   */

  /**
   * 构造阶梯法实例
   * @param {StaircaseOptions} opts
   */
  function Staircase(opts) {
    opts = Object.assign({
      startValue: 0,
      stepSize: 3,
      min: -18,
      max: 9,
      downRule: 3,
      upRule: 1,
      maxReversals: 8,
      warmUpTrials: 0
    }, opts || {});

    /** @type {Object} 保存配置引用，供 reset() 使用 */
    this.opts = opts;

    /** @type {number} 当前刺激强度 */
    this.currentValue = opts.startValue;
    /** @type {number} 步进大小 */
    this.stepSize = opts.stepSize;
    /** @type {number} 下限 */
    this.min = opts.min;
    /** @type {number} 上限 */
    this.max = opts.max;
    /** @type {number} 连续答对计数 */
    this.streakCorrect = 0;
    /** @type {number} 连续答错计数 */
    this.streakWrong = 0;
    /** @type {number} 降级规则 */
    this.downRule = opts.downRule;
    /** @type {number} 升级规则 */
    this.upRule = opts.upRule;
    /** @type {number} 最大反转次数 */
    this.maxReversals = opts.maxReversals;
    /** @type {number} 预热试次数 */
    this.warmUpTrials = opts.warmUpTrials;

    /** @type {number} 总试次计数 */
    this.trialCount = 0;
    /** @type {Array<{trial: number, value: number, direction: string}>} */
    this.reversals = [];
    /** @type {Array<{trial: number, value: number, correct: boolean}>} */
    this.history = [];
    /** @type {string|null} 上一步方向：'up' 或 'down' */
    this.lastDirection = null;
  }

  /**
   * 获取下一个试次应使用的刺激强度
   * @returns {number} 当前 SNR 值
   */
  Staircase.prototype.nextTrial = function () {
    return this.currentValue;
  };

  /**
   * 记录被试反应并更新阶梯状态
   * @param {boolean} isCorrect - 本次反应是否正确
   * @returns {{value: number, reversal: boolean, finished: boolean}}
   */
  Staircase.prototype.record = function (isCorrect) {
    this.trialCount++;
    const oldValue = this.currentValue;
    let isReversal = false;

    if (isCorrect) {
      this.streakCorrect++;
      this.streakWrong = 0;

      if (this.streakCorrect >= this.downRule) {
        // 连续答对 N 次 → 升级（SNR 减小 = 变难）
        this.currentValue = Math.max(this.min, this.currentValue - this.stepSize);
        this.streakCorrect = 0;

        if (this.lastDirection === 'up') {
          isReversal = true;
        }
        this.lastDirection = 'down';
      }
    } else {
      this.streakWrong++;
      this.streakCorrect = 0;

      if (this.streakWrong >= this.upRule) {
        // 答错 1 次 → 降级（SNR 增大 = 变易）
        this.currentValue = Math.min(this.max, this.currentValue + this.stepSize);
        this.streakWrong = 0;

        if (this.lastDirection === 'down') {
          isReversal = true;
        }
        this.lastDirection = 'up';
      }
    }

    // 记录到历史
    this.history.push({
      trial: this.trialCount,
      value: oldValue,
      correct: isCorrect
    });

    // 预热期结束后的反转才记录
    if (isReversal && this.trialCount > this.warmUpTrials) {
      this.reversals.push({
        trial: this.trialCount,
        value: oldValue,
        direction: this.lastDirection
      });
    }

    return {
      value: this.currentValue,
      reversal: isReversal,
      finished: this.isFinished()
    };
  };

  /**
   * 判断是否达到停止条件
   * @returns {boolean}
   */
  Staircase.prototype.isFinished = function () {
    return this.reversals.length >= this.maxReversals;
  };

  /**
   * 计算阈值（最后 N 次反转点的平均值）
   * 取后半段反转点（前半段不稳定，丢弃）
   * @returns {number|null} 阈值（SNR dB），数据不足返回 null
   */
  Staircase.prototype.getThreshold = function () {
    if (this.reversals.length < 3) return null;

    // 丢弃前 1/3（粗搜索阶段），取后 2/3
    const keepCount = Math.ceil(this.reversals.length * 2 / 3);
    const recent = this.reversals.slice(-keepCount);
    const sum = recent.reduce((acc, r) => acc + r.value, 0);
    return sum / recent.length;
  };

  /**
   * 获取阶梯法的完整状态快照（用于数据存储）
   * @returns {Object}
   */
  Staircase.prototype.getSnapshot = function () {
    return {
      trialCount: this.trialCount,
      currentValue: this.currentValue,
      reversals: this.reversals.slice(),
      threshold: this.getThreshold(),
      finished: this.isFinished()
    };
  };

  /**
   * 从状态快照恢复（用于跨会话继续实验）
   * @param {Object} snapshot - getSnapshot() 的返回值
   */
  Staircase.prototype.restore = function (snapshot) {
    if (!snapshot) return;
    this.trialCount = snapshot.trialCount || 0;
    this.currentValue = snapshot.currentValue || this.currentValue;
    this.reversals = (snapshot.reversals || []).slice();
  };

  /**
   * 重置阶梯状态（保持构造参数）
   */
  Staircase.prototype.reset = function () {
    const startValue = arguments.length > 0 ? arguments[0] : (this.opts ? this.opts.startValue : 0);
    this.currentValue = startValue;
    this.streakCorrect = 0;
    this.streakWrong = 0;
    this.trialCount = 0;
    this.reversals = [];
    this.history = [];
    this.lastDirection = null;
  };

  return Staircase;
})();
