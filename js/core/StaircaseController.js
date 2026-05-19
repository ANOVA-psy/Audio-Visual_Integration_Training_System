/**
 * StaircaseController — 训练自适应阶梯引擎
 *
 * 与 AdaptiveEngine（生成"起点"）配合：
 *   AdaptiveEngine.generateNextConfig() → 起点参数
 *   StaircaseController                  → 训练运行中动态调节难度
 *
 * 4 个功能各自的阶梯规则：
 *   功能1：2-down/1-up（连答 2 题 → SNR -1 dB；答错 1 题 → SNR +1 dB）
 *   功能2：3-down/1-up（连答 3 题 → 模糊度 +1 档；答错 1 题 → 退回前一档；档位 [0,4,8,12,16,20]%）
 *   功能3：时窗边界两极拉伸（每次随机出题；做对 → 边界 +10 ms 外推；做错 → 边界 -10 ms 内缩）
 *   功能4：双轴联动（2-down/1-up 调 SNR；SNR 已升至安全上限仍答错 → 干扰源额外 -1 dB 衰减）
 *
 * 终止判定：totalTrials >= maxTrials（默认 40）或 reversals >= maxReversals（默认 6）
 *
 * 公共 API：
 *   const sc = new StaircaseController(func, initialDifficulty, opts);
 *   sc.getNextTrial()                  → { snr, blur, soa, attention, ... }
 *   sc.updateDifficulty(isCorrect)     → { isReversal, isCompleted, currentDifficulty }
 *   sc.isCompleted                     → boolean
 *   sc.getSummary()                    → 训练摘要（含轨迹）
 */
(function (root) {
  'use strict';

  /* ---------- 常量 ---------- */
  const BLUR_LEVELS = [0, 4, 8, 12, 16, 20]; // 模糊度档位（步长数组）
  const FUNC4_SNR_MAX = 9;                    // 功能 4 SNR 安全上限（dB）— 超过则触发干扰衰减

  /**
   * @param {1|2|3|4} func
   * @param {Object} initialDifficulty - AdaptiveEngine 给出的起点参数
   * @param {Object} [opts]
   * @param {number} [opts.maxTrials=40]
   * @param {number} [opts.maxReversals=6]
   */
  function StaircaseController(func, initialDifficulty, opts) {
    if (!(this instanceof StaircaseController)) {
      return new StaircaseController(func, initialDifficulty, opts);
    }
    opts = opts || {};
    initialDifficulty = initialDifficulty || {};

    this.func          = func;
    this.maxTrials     = opts.maxTrials     || 40;
    this.maxReversals  = opts.maxReversals  || 6;

    this.totalTrials   = 0;
    this.reversals     = 0;
    this.isCompleted   = false;

    // 上一次方向：'down' = 变难，'up' = 变易，null = 还没动过
    this._lastDirection = null;
    // 连续答对计数（用于 2-down / 3-down）
    this._consecutiveCorrect = 0;

    // 当前难度（按功能不同含义）
    this.currentDifficulty = this._buildInitialDifficulty(initialDifficulty);

    // 记录每次 trial 后的状态（便于绘制阶梯曲线）
    this.history = []; // [{trial, snr, blur, soa, isCorrect, isReversal}]
  }

  StaircaseController.prototype._buildInitialDifficulty = function (init) {
    switch (this.func) {
      case 1:
        return { snr: numOr(init.initialSNR, -1) };
      case 2:
        return {
          snr:  numOr(init.initialSNR, -3),
          blurIndex: snapToBlurIndex(numOr(init.initialBlur, 0))
        };
      case 3: {
        const lo = numOr(init.visualLeadStart, -120);
        const hi = numOr(init.audioLeadStart,   80);
        return {
          snr:           numOr(init.initialSNR, -2),
          visualBoundary: lo, // 当前视觉领先边界（负值）
          audioBoundary:  hi  // 当前听觉领先边界（正值）
        };
      }
      case 4:
        return {
          snr:                   numOr(init.initialSNR, 0),
          distractorAttenuation: numOr(init.distractorAttenuation, 0)
        };
    }
    return {};
  };

  /**
   * 生成下一个 trial 的参数（供 module.generateTrialQueue / 试次循环调用）
   * @returns {Object|null} null 表示已终止
   */
  StaircaseController.prototype.getNextTrial = function () {
    if (this.isCompleted) return null;
    const d = this.currentDifficulty;

    switch (this.func) {
      case 1:
        return { snr: round1(d.snr), blur: 0, soa: 0, attention: 'single' };

      case 2:
        return { snr: round1(d.snr), blur: BLUR_LEVELS[d.blurIndex] || 0,
                 soa: 0, attention: 'single' };

      case 3: {
        // 在两个边界之间随机抽一个出题
        const useVisual = Math.random() < 0.5;
        const soa = useVisual ? d.visualBoundary : d.audioBoundary;
        return { snr: round1(d.snr), blur: 0, soa: Math.round(soa),
                 attention: 'single', _whichBoundary: useVisual ? 'visual' : 'audio' };
      }
      case 4: {
        // 单/双任务交替出题（双任务为主，单任务作为对照）
        const isDual = (this.totalTrials % 3 !== 0); // 2 双 1 单
        return {
          snr:                   round1(d.snr),
          blur:                  0,
          soa:                   0,
          attention:             isDual ? 'dual' : 'single',
          distractorAttenuation: round1(d.distractorAttenuation)
        };
      }
    }
    return null;
  };

  /**
   * 根据被试是否答对，调节下一次试次的难度
   * @param {boolean} isCorrect
   * @param {Object} [meta] 上一次 trial 的额外信息（如 _whichBoundary）
   * @returns {{ isReversal: boolean, isCompleted: boolean, currentDifficulty: Object }}
   */
  StaircaseController.prototype.updateDifficulty = function (isCorrect, meta) {
    if (this.isCompleted) {
      return { isReversal: false, isCompleted: true, currentDifficulty: this.currentDifficulty };
    }
    meta = meta || {};
    this.totalTrials += 1;

    let direction = null;       // 本次实际调节方向
    const before  = JSON.parse(JSON.stringify(this.currentDifficulty));

    switch (this.func) {
      case 1:
        direction = this._stairFunc1(isCorrect);
        break;
      case 2:
        direction = this._stairFunc2(isCorrect);
        break;
      case 3:
        direction = this._stairFunc3(isCorrect, meta._whichBoundary || 'visual');
        break;
      case 4:
        direction = this._stairFunc4(isCorrect);
        break;
    }

    // 记录方向反转
    let isReversal = false;
    if (direction && this._lastDirection && direction !== this._lastDirection) {
      this.reversals += 1;
      isReversal = true;
    }
    if (direction) this._lastDirection = direction;

    // 终止判定
    if (this.totalTrials >= this.maxTrials || this.reversals >= this.maxReversals) {
      this.isCompleted = true;
    }

    this.history.push({
      trial:      this.totalTrials,
      before:     before,
      after:      JSON.parse(JSON.stringify(this.currentDifficulty)),
      isCorrect:  !!isCorrect,
      direction:  direction,
      isReversal: isReversal
    });

    return {
      isReversal:        isReversal,
      isCompleted:       this.isCompleted,
      currentDifficulty: this.currentDifficulty
    };
  };

  /* ---------- 各功能阶梯实现 ---------- */

  // 功能1：2-down / 1-up（SNR）
  StaircaseController.prototype._stairFunc1 = function (isCorrect) {
    const d = this.currentDifficulty;
    if (isCorrect) {
      this._consecutiveCorrect += 1;
      if (this._consecutiveCorrect >= 2) {
        d.snr -= 1;          // 变难
        this._consecutiveCorrect = 0;
        return 'down';
      }
      return null;            // 不调难度，继续累计
    } else {
      this._consecutiveCorrect = 0;
      d.snr += 1;            // 变易
      return 'up';
    }
  };

  // 功能2：3-down / 1-up（模糊度档位）
  StaircaseController.prototype._stairFunc2 = function (isCorrect) {
    const d = this.currentDifficulty;
    if (isCorrect) {
      this._consecutiveCorrect += 1;
      if (this._consecutiveCorrect >= 3) {
        if (d.blurIndex < BLUR_LEVELS.length - 1) {
          d.blurIndex += 1;   // 上调一档（变难）
        }
        this._consecutiveCorrect = 0;
        return 'down';
      }
      return null;
    } else {
      this._consecutiveCorrect = 0;
      if (d.blurIndex > 0) {
        d.blurIndex -= 1;     // 退回前一档（变易）
      }
      return 'up';
    }
  };

  // 功能3：时窗边界两极拉伸（10ms 步长）
  StaircaseController.prototype._stairFunc3 = function (isCorrect, whichBoundary) {
    const d = this.currentDifficulty;
    const STEP = 10;
    if (whichBoundary === 'visual') {
      // 视觉领先边界（负值）：做对 → 更负（外推变难），做错 → 向 0 内缩（变易）
      if (isCorrect) { d.visualBoundary -= STEP; return 'down'; }
      else            { d.visualBoundary  = Math.min(d.visualBoundary + STEP, -10); return 'up'; }
    } else {
      // 听觉领先边界（正值）：做对 → 更正（外推变难），做错 → 向 0 内缩（变易）
      if (isCorrect) { d.audioBoundary  += STEP; return 'down'; }
      else            { d.audioBoundary  = Math.max(d.audioBoundary  - STEP, 10); return 'up'; }
    }
  };

  // 功能4：2-down / 1-up（SNR）+ SNR 升到安全上限后激活干扰衰减
  StaircaseController.prototype._stairFunc4 = function (isCorrect) {
    const d = this.currentDifficulty;
    if (isCorrect) {
      this._consecutiveCorrect += 1;
      if (this._consecutiveCorrect >= 2) {
        d.snr -= 1;
        this._consecutiveCorrect = 0;
        return 'down';
      }
      return null;
    } else {
      this._consecutiveCorrect = 0;
      if (d.snr >= FUNC4_SNR_MAX) {
        // SNR 已到安全上限：转而衰减干扰源
        d.distractorAttenuation -= 1;
      } else {
        d.snr += 1;
      }
      return 'up';
    }
  };

  /* ---------- 工具 ---------- */

  StaircaseController.prototype.getSummary = function () {
    return {
      func:        this.func,
      totalTrials: this.totalTrials,
      reversals:   this.reversals,
      isCompleted: this.isCompleted,
      finalDifficulty: this.currentDifficulty,
      maxTrials:    this.maxTrials,
      maxReversals: this.maxReversals,
      historyLen:   this.history.length
    };
  };

  function numOr(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }
  function round1(v) {
    return Math.round((+v + Number.EPSILON) * 10) / 10;
  }
  function snapToBlurIndex(blur) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < BLUR_LEVELS.length; i++) {
      const d = Math.abs(BLUR_LEVELS[i] - blur);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
  }

  // 公开
  root.StaircaseController = StaircaseController;
})(typeof window !== 'undefined' ? window : this);
