/**
 * 自适应训练引擎 AdaptiveEngine
 *
 * 系统按以下顺序链式处理四大功能模块：
 *   1. 功能1：听觉抗干扰      → 核心指标 threshold (噪音阈值)
 *   2. 功能2：视觉整合        → 核心指标 gain (视觉增益)
 *   3. 功能3：视听异步校准    → 核心指标 window (整合时窗宽度 ms)
 *   4. 功能4：注意定位        → 核心指标 cost (干扰抑制成本)
 *
 * 公共 API：
 *   AdaptiveEngine.generateNextConfig(evalResults)
 *   AdaptiveEngine.saveNextSessionSettings(evalResults, userId)
 *   AdaptiveEngine.calculateCognitiveScore(evalResults)
 *
 * evalResults 结构（来自历史记录或当前评估）：
 *   {
 *     func1: { threshold, r2, ... }            // 来自 Module1.calculateThreshold
 *     func2: { gain, fitClear:{threshold},
 *              fitBlur:{threshold}, clearBlur, maxBlur }   // 来自 Module2.calculateVisualGain
 *     func3: { window, visualLeadWindow, audioLeadWindow,
 *              lowerSOA, upperSOA }            // 来自 Module3.calculateIntegrationWindow
 *     func4: { cost, singleThreshold, dualThreshold } // 来自 Module4.calculateInterferenceCost
 *   }
 */
const AdaptiveEngine = (function () {
  'use strict';

  const VERSION = '1.0.0';

  /* ============================================================
   * AI 推荐起点 / 边界的合理范围（与 admin UI 档位严格对齐）
   * ------------------------------------------------------------
   * SNR             ∈ [-9, +9]   dB   （admin SNR 档位 [-9..+9]）
   * Blur (模糊度)    ∈ [0, 20]    %    （admin 档位 [0,4,8,12,16,20]）
   * SOA·视觉领先     ∈ [-300, 0]  ms   （admin 档位 [-300..+300]，视觉领先须 ≤0）
   * SOA·听觉领先     ∈ [0, +300]  ms   （听觉领先须 ≥0）
   * 干扰源衰减        ∈ [-12, 0]   dB   （≤0；过大会让任务过易）
   * 总试次上限        ∈ [5, 200]   次
   * 反转上限          ∈ [2, 20]    次
   *
   * 任何超出范围的推导值都会被 clamp 到边界，并在控制台打印 warning。
   * ============================================================ */
  const RANGES = {
    snr:           { min: -9,   max:   9 },
    blur:          { min:  0,   max:  20 },
    soaVisualLead: { min: -300, max:   0 },   // 视觉领先：SOA ≤ 0
    soaAudioLead:  { min:  0,   max: 300 },   // 听觉领先：SOA ≥ 0
    distractor:    { min: -12,  max:   0 },   // 衰减必为非正值
    totalTrials:   { min:  5,   max: 200 },
    maxReversals:  { min:  2,   max:  20 }
  };

  /**
   * 把任意数值约束到 [min, max] 区间内，超出则打印 warning 便于研究者察觉
   */
  function clampRange(value, range, label) {
    if (value == null || !isFinite(value)) return value;
    if (value < range.min) {
      console.warn(`[AdaptiveEngine] ${label}=${value} 低于下限 ${range.min}，已自动 clamp`);
      return range.min;
    }
    if (value > range.max) {
      console.warn(`[AdaptiveEngine] ${label}=${value} 高于上限 ${range.max}，已自动 clamp`);
      return range.max;
    }
    return value;
  }

  /* ============================================================
   * 1. 自适应难度配置生成（按用户给定的难度递推规则）
   * ============================================================ */

  /**
   * 根据评估结果生成下一次训练的难度配置
   * @param {Object} evalResults
   * @returns {Object} nextConfig
   */
  function generateNextConfig(evalResults) {
    const r = evalResults || {};
    const func1 = r.func1 || {};
    const func2 = r.func2 || {};
    const func3 = r.func3 || {};
    const func4 = r.func4 || {};

    /* ---- 功能1：听觉抗干扰 ---- */
    // 初始 SNR = threshold + 2.0 dB（略难于阈值，挑战听觉边界）→ clamp 到 SNR 档位范围
    const func1Threshold = numOr(func1.threshold, -3.0);
    const func1InitialSNR = +clampRange(+(func1Threshold + 2.0).toFixed(2),
                                         RANGES.snr, 'func1.initialSNR');

    /* ---- 功能2：视觉整合 ---- */
    // 固定 SNR = fitClear.threshold + 1.0 dB → clamp
    const func2BaseSNRRaw = numOr(func2.fitClear && func2.fitClear.threshold,
                                   func1Threshold) + 1.0;
    const func2BaseSNR = +clampRange(+func2BaseSNRRaw.toFixed(2),
                                      RANGES.snr, 'func2.initialSNR');
    // 模糊度按 gain 动态切入：>3 从4, 1.5~3 从8, <1.5 从0 → clamp 到 [0, 20]
    const gain = numOr(func2.gain, 0);
    let initialBlur;
    if (gain > 3.0)        initialBlur = 4;
    else if (gain >= 1.5)  initialBlur = 8;
    else                    initialBlur = 0;
    initialBlur = clampRange(initialBlur, RANGES.blur, 'func2.initialBlur');

    /* ---- 功能3：视听异步校准 ---- */
    // 固定 SNR = 功能1 threshold + 1.0 dB → clamp 到 SNR 范围
    const func3SNR = +clampRange(+(func1Threshold + 1.0).toFixed(2),
                                  RANGES.snr, 'func3.initialSNR');
    // 视觉领先起点：lowerSOA + 30 ms（窗口内部一点，逐步外推）→ clamp 到 [-300, 0]
    // 听觉领先起点：upperSOA - 20 ms                              → clamp 到 [0, +300]
    const lowerSOA = numOr(func3.lowerSOA, -150);
    const upperSOA = numOr(func3.upperSOA,  100);
    const visualLeadStart = clampRange(+(lowerSOA + 30).toFixed(0),
                                        RANGES.soaVisualLead, 'func3.visualLeadStart');
    const audioLeadStart  = clampRange(+(upperSOA - 20).toFixed(0),
                                        RANGES.soaAudioLead,  'func3.audioLeadStart');

    /* ---- 功能4：注意定位 ---- */
    // 初始 SNR = dualThreshold + 1.5 dB → clamp
    const dualThreshold = numOr(func4.dualThreshold, -2.0);
    const func4InitialSNR = +clampRange(+(dualThreshold + 1.5).toFixed(2),
                                         RANGES.snr, 'func4.initialSNR');
    // 干扰源衰减：cost > 3 → -3 dB（更降低干扰强度），否则 0 dB → clamp 到 [-12, 0]
    const cost = numOr(func4.cost, 0);
    const distractorAttenuation = clampRange(cost > 3.0 ? -3.0 : 0.0,
                                              RANGES.distractor, 'func4.distractorAttenuation');

    return {
      func1: {
        initialSNR: func1InitialSNR,
        snrLevels: buildSnrLevels(func1InitialSNR),
        repetitions: 5,
        snrMode: 'adaptive'
      },
      func2: {
        initialSNR: func2BaseSNR,
        initialBlur: initialBlur,
        snrLevels: [func2BaseSNR],
        blurLevels: buildBlurLevels(initialBlur),
        repetitions: 4,
        snrMode: 'fixed'
      },
      func3: {
        initialSNR: func3SNR,
        snrLevels: [func3SNR],
        soaLevels: [visualLeadStart, Math.round((visualLeadStart + audioLeadStart) / 2), audioLeadStart],
        visualLeadStart: visualLeadStart,
        audioLeadStart:  audioLeadStart,
        repetitions: 4,
        snrMode: 'fixed'
      },
      func4: {
        initialSNR: func4InitialSNR,
        snrLevels: buildSnrLevels(func4InitialSNR),
        attLevels: ['single', 'dual'],
        distractorAttenuation: distractorAttenuation,
        repetitions: 4,
        snrMode: 'adaptive'
      }
    };
  }

  /* ============================================================
   * 2. 写入 settings.json（持久化）
   * ============================================================ */

  /**
   * 根据 evalResults 生成下一次配置并保存到该被试的 settings 文件
   * 同时写 localStorage 和（如可用）通过 AdminSettings → /api/save-config 落到服务端
   *
   * @param {Object} evalResults
   * @param {string} userId         被试编号
   * @param {Object} [opts]
   * @param {string} [opts.phase]   'train' (默认)
   * @returns {Object} 完整的 settings.json 对象
   */
  function saveNextSessionSettings(evalResults, userId, opts) {
    const o = opts || {};
    const phase = o.phase || 'train';
    if (!userId) throw new Error('saveNextSessionSettings: userId 必填');

    const nextConfig = generateNextConfig(evalResults);

    // 标准化为 settings.json 顶层结构
    const settingsJson = {
      userId:       userId,
      updatedAt:    new Date().toISOString(),
      version:      VERSION,
      strategyMode: 'adaptive',
      evalSnapshot: extractSnapshot(evalResults),
      func1: nextConfig.func1,
      func2: nextConfig.func2,
      func3: nextConfig.func3,
      func4: nextConfig.func4
    };

    // 模拟 I/O：localStorage（兜底） + AdminSettings（落到 config/settings/ 目录）
    try {
      localStorage.setItem(`avis_next_settings_${userId}`, JSON.stringify(settingsJson));
    } catch (e) {
      console.warn('[AdaptiveEngine] localStorage 写入失败:', e);
    }

    // 通过 AdminSettings 写到 config/settings/{userId}.json 的 phase 内
    if (typeof AdminSettings !== 'undefined' && AdminSettings.saveSettings) {
      const gender = (typeof STATE !== 'undefined' && STATE.gender) ? STATE.gender : '';
      const age    = (typeof STATE !== 'undefined' && STATE.age)    ? STATE.age    : '';

      // 对四个功能分别落盘（兼容现有 saveSettings 签名）
      for (let f = 1; f <= 4; f++) {
        const moduleConfig = nextConfig['func' + f] || {};
        const preset = (AdminSettings.getPresetSettings)
          ? AdminSettings.getPresetSettings(f, phase)
          : {};
        // 用 AI 配置覆盖关键字段
        const merged = Object.assign({}, preset, {
          func:        f,
          phase:       phase,
          snrLevels:   moduleConfig.snrLevels   || preset.snrLevels,
          blurLevels:  moduleConfig.blurLevels  || preset.blurLevels,
          soaLevels:   moduleConfig.soaLevels   || preset.soaLevels,
          attLevels:   moduleConfig.attLevels   || preset.attLevels,
          repetitions: moduleConfig.repetitions || preset.repetitions,
          snrMode:     moduleConfig.snrMode     || preset.snrMode,
          // 额外的 AI 注解（不影响现有模块读取，便于 admin 显示）
          _aiMeta: {
            generatedAt: settingsJson.updatedAt,
            strategyMode: 'adaptive',
            initialSNR:  moduleConfig.initialSNR,
            initialBlur: moduleConfig.initialBlur,
            visualLeadStart: moduleConfig.visualLeadStart,
            audioLeadStart:  moduleConfig.audioLeadStart,
            distractorAttenuation: moduleConfig.distractorAttenuation
          }
        });
        try {
          AdminSettings.saveSettings(userId, phase, f, merged, gender, age);
        } catch (e) {
          console.warn(`[AdaptiveEngine] AdminSettings.saveSettings func${f} 失败`, e);
        }
      }
    }

    console.log('[AdaptiveEngine] 已生成并保存下一次训练配置:', settingsJson);
    return settingsJson;
  }

  /* ============================================================
   * 3. 综合训练成绩量化映射算法（AVIS 认知指数 0-100）
   * ============================================================
   * 权重：
   *   听觉基底分（threshold）       30%
   *   视觉代偿能力（gain）          30%
   *   时空整合精准度（window）      20%
   *   注意抑制效率（cost）          20%
   */

  /**
   * 计算综合视听认知指数（AVIS）
   * @param {Object} evalResults
   * @returns {Object} { auditory, visual, integration, attention, total }
   */
  function calculateCognitiveScore(evalResults) {
    const r = evalResults || {};
    const threshold = numOr(r.func1 && r.func1.threshold, null);
    const gain      = numOr(r.func2 && r.func2.gain,      null);
    const window    = numOr(r.func3 && r.func3.window,    null);
    const cost      = numOr(r.func4 && r.func4.cost,      null);

    // 各维度评分；无数据维度返回 null，不参与总分计算
    const auditory    = scoreThreshold(threshold);
    const visual      = scoreGain(gain);
    const integration = scoreWindow(window);
    const attention   = scoreCost(cost);

    // 仅对有数据的维度做加权归一化（避免未测试维度污染总分）
    const dims = [
      { score: auditory,    weight: 0.30 },
      { score: visual,      weight: 0.30 },
      { score: integration, weight: 0.20 },
      { score: attention,   weight: 0.20 }
    ];
    const valid = dims.filter(d => d.score != null && isFinite(d.score));
    let total = null;
    if (valid.length > 0) {
      const wSum = valid.reduce((a, d) => a + d.weight, 0);
      const sSum = valid.reduce((a, d) => a + d.score * d.weight, 0);
      total = Math.round(sSum / wSum);
    }

    return {
      auditory:    auditory    == null ? null : Math.round(auditory),
      visual:      visual      == null ? null : Math.round(visual),
      integration: integration == null ? null : Math.round(integration),
      attention:   attention   == null ? null : Math.round(attention),
      total:       total,
      // 附带原始指标，方便前端展示
      raw: { threshold, gain, window, cost }
    };
  }

  // 标准：-6dB 满分；0dB 50分；+6dB 趋近 0
  // 使用线性段拼接：[-Inf,-6]=100; (-6, 6) 线性从 100→0 经过 (0, 50); [6,+Inf]=0
  // ★ 无数据返回 null（不参与总分）
  function scoreThreshold(t) {
    if (t == null || !isFinite(t)) return null;
    if (t <= -6) return 100;
    if (t >= 6)  return 0;
    // 在 (-6, 6) 之间线性：t=-6→100, t=0→50, t=6→0
    return clamp(100 - ((t + 6) / 12) * 100, 0, 100);
  }

  // gain >= 4 → 100；gain <= 0 → 0；线性
  // ★ 无数据返回 null
  function scoreGain(g) {
    if (g == null || !isFinite(g)) return null;
    if (g >= 4) return 100;
    if (g <= 0) return 0;
    return (g / 4) * 100;
  }

  // 常模 150ms。|window - 150| = 0 → 100；偏差 >= 150 → 0
  // ★ 无数据返回 null
  function scoreWindow(w) {
    if (w == null || !isFinite(w)) return null;
    const dev = Math.abs(w - 150);
    if (dev >= 150) return 0;
    return clamp(100 - (dev / 150) * 100, 0, 100);
  }

  // cost <= 0 → 100；cost >= 4 → 20；线性映射（保留下限）
  // ★ 无数据返回 null
  function scoreCost(c) {
    if (c == null || !isFinite(c)) return null;
    if (c <= 0) return 100;
    if (c >= 4) return 20;
    return clamp(100 - (c / 4) * 80, 20, 100);
  }

  /* ============================================================
   * 工具函数
   * ============================================================ */

  function numOr(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function buildSnrLevels(centerSNR) {
    // 围绕 centerSNR 形成阶梯（自适应起点 + 邻近难度）
    return [centerSNR + 4, centerSNR + 2, centerSNR, centerSNR - 2, centerSNR - 4]
      .map(v => +v.toFixed(1));
  }
  function buildBlurLevels(initialBlur) {
    const set = new Set([initialBlur]);
    [initialBlur + 4, initialBlur + 8, initialBlur + 12].forEach(b => {
      if (b >= 0 && b <= 20) set.add(b);
    });
    return Array.from(set).sort((a, b) => a - b);
  }

  function extractSnapshot(r) {
    if (!r) return null;
    return {
      threshold: r.func1 && r.func1.threshold,
      gain:      r.func2 && r.func2.gain,
      window:    r.func3 && r.func3.window,
      cost:      r.func4 && r.func4.cost
    };
  }

  /**
   * 从 DataManager 历史记录中聚合最近 active 评估结果
   * 便于 admin / result 页直接读取
   * @param {string} userId
   * @returns {Object} evalResults
   */
  function collectLatestEval(userId) {
    if (typeof DataManager === 'undefined') return {};
    const all = DataManager.getAllData();
    const ret = {};
    [1, 2, 3, 4].forEach(f => {
      const records = all.filter(d =>
        d.metadata && d.metadata.subjectId === userId &&
        d.metadata.func === f &&
        (d.status === 'active' || !d.status)
      ).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      if (records.length > 0 && records[0].psychometricFit) {
        ret['func' + f] = records[0].psychometricFit;
      }
    });
    return ret;
  }

  return {
    VERSION:                  VERSION,
    RANGES:                   RANGES,                  // ★ 暴露合理范围常量给 admin.html 使用
    clampRange:               clampRange,
    generateNextConfig:       generateNextConfig,
    saveNextSessionSettings:  saveNextSessionSettings,
    calculateCognitiveScore:  calculateCognitiveScore,
    collectLatestEval:        collectLatestEval,
    // 单项打分（供历史折线图使用）
    scoreThreshold:           scoreThreshold,
    scoreGain:                scoreGain,
    scoreWindow:              scoreWindow,
    scoreCost:                scoreCost,
    /**
     * 把单条记录的 metadata.threshold / fitResult 映射为 0-100 分
     * @param {Object} record   完整 record 对象（含 metadata 和 psychometricFit）
     * @returns {number} 0-100
     */
    scoreRecord: function (record) {
      if (!record || !record.metadata) return null;
      const f   = record.metadata.func;
      const fit = record.psychometricFit || {};
      let s = null;
      switch (f) {
        case 1: s = scoreThreshold(numOr(fit.threshold, numOr(record.metadata.threshold, null))); break;
        case 2: s = scoreGain(numOr(fit.gain, numOr(record.metadata.threshold, null))); break;
        case 3: s = scoreWindow(numOr(fit.window, numOr(record.metadata.threshold, null))); break;
        case 4: s = scoreCost(numOr(fit.cost, numOr(record.metadata.threshold, null))); break;
        default: return null;
      }
      return (s == null || !isFinite(s)) ? null : Math.round(s);
    }
  };
})();

// 兼容浏览器全局
if (typeof window !== 'undefined') window.AdaptiveEngine = AdaptiveEngine;
