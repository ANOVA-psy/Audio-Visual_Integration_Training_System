/**
 * 一次性脚本：为被试 8888 生成模拟测试/训练数据
 * 在浏览器控制台执行：fetch('/scripts/generate_test_data_8888.js').then(r=>r.text()).then(eval)
 * 或 Node.js：node scripts/generate_test_data_8888.js
 *
 * 数据覆盖：
 *   - 4 个功能（func1-4）× 3 个阶段（pre/train/post）
 *   - 每条记录包含完整 psychometricFit（含 data 散点 + alpha/beta 拟合参数）
 *   - 满足 result.html 4 张图的渲染要求
 */

(function () {
  'use strict';

  const isBrowser = (typeof window !== 'undefined');
  const WORDS = ['妈妈', '爸爸', '哥哥', '姐姐', '弟弟', '妹妹', '奶奶', '爷爷',
                 '苹果', '香蕉', '葡萄', '西瓜', '老师', '学生', '医生', '护士'];

  // ═══════════════════════════════════════
  //  工具
  // ═══════════════════════════════════════
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
  function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  // Logistic 概率
  function logistic(x, alpha, beta, gamma, lambda) {
    return gamma + (1 - gamma - lambda) / (1 + Math.exp(-beta * (x - alpha)));
  }

  // 根据 SNR 与拟合参数模拟单试次（伯努利采样）
  function simulateTrialAtSNR(snr, alpha, beta, gamma, lambda) {
    const p = logistic(snr, alpha, beta, gamma, lambda);
    return Math.random() < p;
  }

  // 生成试次数组：按 levels 平均分配
  function generateTrials(levelsList, trialsPerLevel, alpha, beta, gamma, lambda, extraField) {
    const trials = [];
    let idx = 0;
    levelsList.forEach(snr => {
      for (let i = 0; i < trialsPerLevel; i++) {
        idx++;
        const correctWord = randomChoice(WORDS);
        const isCorrect = simulateTrialAtSNR(snr, alpha, beta, gamma, lambda);
        const choices = [correctWord];
        const others = WORDS.filter(w => w !== correctWord);
        for (let j = 0; j < 3; j++) choices.push(randomChoice(others));
        choices.sort(() => Math.random() - 0.5);
        const correctIndex = choices.indexOf(correctWord);
        const trial = {
          trial: idx,
          snr: snr,
          word: correctWord,
          correct: isCorrect,
          selectedIndex: isCorrect ? correctIndex : randomChoice([0, 1, 2, 3].filter(x => x !== correctIndex)),
          correctIndex: correctIndex,
          rt: isCorrect
            ? 400 + Math.floor(Math.random() * 600)
            : 800 + Math.floor(Math.random() * 1500),
          choice: isCorrect ? ['A', 'B', 'C', 'D'][correctIndex] : 'TIMEOUT',
          timestamp: Date.now() - (50 - idx) * 3000
        };
        if (extraField) Object.assign(trial, extraField);
        trials.push(trial);
      }
    });
    return trials;
  }

  // 由试次 + levels 聚合 data：[{x, y, k, n}]
  function aggregateData(trials, levels, xField) {
    return levels.map(lv => {
      const bucket = trials.filter(t => t[xField] === lv);
      const n = bucket.length;
      const k = bucket.filter(t => t.correct).length;
      return { x: lv, n: n, k: k, y: n > 0 ? k / n : 0 };
    });
  }

  function aggMetric(trials) {
    const n = trials.length;
    const k = trials.filter(t => t.correct).length;
    const acc = n > 0 ? Math.round(k / n * 100) : 0;
    const valid = trials.filter(t => t.rt < 10000);
    const rt = valid.length > 0
      ? Math.round(valid.reduce((s, t) => s + t.rt, 0) / valid.length)
      : 0;
    return { accuracy: acc, avgRT: rt };
  }

  // ═══════════════════════════════════════
  //  各功能生成器：基于能力等级（0~100）控制 alpha/beta
  // ═══════════════════════════════════════

  // 功能 1：阈值拟合（单曲线，SNR vs 正确率）
  function buildFunc1(level) {
    // level 越高 → threshold 越低（小 SNR 也能听懂）
    const alpha = 6 - (level / 100) * 12;            // 6 → -6
    const beta  = 0.4 + (level / 100) * 0.6;         // 0.4 → 1.0 斜率
    const gamma = 0.25, lambda = 0.02;
    const levels = [9, 6, 3, 0, -3, -6, -9];
    const trials = generateTrials(levels, 8, alpha, beta, gamma, lambda);
    const data = aggregateData(trials, levels, 'snr');
    const metric = aggMetric(trials);
    return {
      trials, metric,
      fit: {
        alpha, beta, gamma, lambda,
        threshold: alpha,
        slope: beta,
        r2: 0.85 + Math.random() * 0.1,
        data: data
      }
    };
  }

  // 功能 2：清晰 vs 模糊 双曲线
  function buildFunc2(level) {
    // 清晰口型：能力高，threshold 低
    const alphaClear = 4 - (level / 100) * 10;   // 4 → -6
    const betaClear  = 0.5 + (level / 100) * 0.5;
    // 模糊口型：能力低（threshold 偏右）
    const alphaBlur  = 8 - (level / 100) * 10;   // 8 → -2，比清晰右移
    const betaBlur   = 0.4 + (level / 100) * 0.4;
    const gamma = 0.25, lambda = 0.02;
    const levels = [9, 6, 3, 0, -3, -6];

    const trialsClear = generateTrials(levels, 4, alphaClear, betaClear, gamma, lambda, { blur: 0 });
    const trialsBlur  = generateTrials(levels, 4, alphaBlur,  betaBlur,  gamma, lambda, { blur: 16 });
    const allTrials = trialsClear.concat(trialsBlur).map((t, i) => Object.assign({}, t, { trial: i + 1 }));

    const dataClear = aggregateData(trialsClear, levels, 'snr');
    const dataBlur  = aggregateData(trialsBlur,  levels, 'snr');
    const metric = aggMetric(allTrials);
    const gain = alphaBlur - alphaClear;  // 视觉增益 dB

    return {
      trials: allTrials, metric,
      fit: {
        gain: gain,
        fitClear: {
          alpha: alphaClear, beta: betaClear, gamma, lambda,
          threshold: alphaClear, slope: betaClear,
          r2: 0.82 + Math.random() * 0.12,
          data: dataClear
        },
        fitBlur: {
          alpha: alphaBlur, beta: betaBlur, gamma, lambda,
          threshold: alphaBlur, slope: betaBlur,
          r2: 0.78 + Math.random() * 0.12,
          data: dataBlur
        }
      }
    };
  }

  // 功能 3：SOA 整合时窗（倒 U）
  function buildFunc3(level) {
    // 高斯峰位置稍偏 0（视觉先 ~30ms 最佳）
    const mu = 30 + (Math.random() - 0.5) * 40;
    // sigma 越小 → 时窗越窄（能力越强）
    const sigma = 220 - (level / 100) * 100;  // 220 → 120
    const A = 0.55 + (level / 100) * 0.4;     // 峰值正确率：0.55 → 0.95
    const soaLevels = [-300, -200, -100, 0, 100, 200, 300];
    const trialsPerSOA = 6;
    const trials = [];
    let idx = 0;
    soaLevels.forEach(soa => {
      const p = A * Math.exp(-((soa - mu) * (soa - mu)) / (2 * sigma * sigma));
      const pAdj = Math.max(0.25, Math.min(0.98, p));
      for (let i = 0; i < trialsPerSOA; i++) {
        idx++;
        const isCorrect = Math.random() < pAdj;
        const correctWord = randomChoice(WORDS);
        const choices = [correctWord];
        const others = WORDS.filter(w => w !== correctWord);
        for (let j = 0; j < 3; j++) choices.push(randomChoice(others));
        choices.sort(() => Math.random() - 0.5);
        const correctIndex = choices.indexOf(correctWord);
        trials.push({
          trial: idx, snr: 0, soa: soa, word: correctWord,
          correct: isCorrect,
          selectedIndex: isCorrect ? correctIndex : randomChoice([0,1,2,3].filter(x => x !== correctIndex)),
          correctIndex: correctIndex,
          rt: isCorrect ? 400 + Math.floor(Math.random()*600) : 800 + Math.floor(Math.random()*1500),
          choice: isCorrect ? ['A','B','C','D'][correctIndex] : 'TIMEOUT',
          timestamp: Date.now() - (50 - idx) * 3000
        });
      }
    });

    const data = aggregateData(trials, soaLevels, 'soa');
    const metric = aggMetric(trials);
    // 整合时窗：以 criterion=0.5 划分
    // 简单按高斯反解：x = mu ± sigma·sqrt(-2 ln(0.5/A))
    const ratio = 0.5 / A;
    let halfWidth = 150;
    if (ratio > 0 && ratio < 1) {
      halfWidth = sigma * Math.sqrt(-2 * Math.log(ratio));
    }
    const lowerSOA = Math.round(mu - halfWidth);
    const upperSOA = Math.round(mu + halfWidth);
    const windowW  = upperSOA - lowerSOA;
    // 视觉领先时窗 = |lowerSOA|（仅当 < 0）；听觉领先时窗 = upperSOA（仅当 > 0）
    const visualLeadWindow = lowerSOA < 0 ? Math.abs(lowerSOA) : 0;
    const audioLeadWindow  = upperSOA > 0 ? upperSOA : 0;
    return {
      trials, metric,
      fit: {
        window: windowW,
        visualLeadWindow: visualLeadWindow,
        audioLeadWindow: audioLeadWindow,
        lowerSOA: lowerSOA,
        upperSOA: upperSOA,
        peakSOA: Math.round(mu),
        fit: { data: data, mu: mu, sigma: sigma, A: A }
      }
    };
  }

  // 功能 4：单 vs 双说话人 双曲线 + cost
  function buildFunc4(level) {
    // 单说话人能力高，阈值低
    const alphaSingle = 2 - (level / 100) * 8;   // 2 → -6
    const betaSingle  = 0.5 + (level / 100) * 0.5;
    // 双说话人能力低（注意分散，阈值右移）
    const alphaDual   = 7 - (level / 100) * 9;   // 7 → -2
    const betaDual    = 0.4 + (level / 100) * 0.4;
    const gamma = 0.25, lambda = 0.02;
    const levels = [6, 3, 0, -3, -6];

    const trialsSingle = generateTrials(levels, 4, alphaSingle, betaSingle, gamma, lambda, { attention: 'single' });
    const trialsDual   = generateTrials(levels, 4, alphaDual,   betaDual,   gamma, lambda, { attention: 'dual' });
    const allTrials = trialsSingle.concat(trialsDual).map((t, i) => Object.assign({}, t, { trial: i + 1 }));

    const dataSingle = aggregateData(trialsSingle, levels, 'snr');
    const dataDual   = aggregateData(trialsDual,   levels, 'snr');
    const metric = aggMetric(allTrials);
    const cost = alphaDual - alphaSingle;  // 干扰成本

    return {
      trials: allTrials, metric,
      fit: {
        cost: cost,
        singleThreshold: alphaSingle,
        dualThreshold: alphaDual,
        fitSingle: {
          alpha: alphaSingle, beta: betaSingle, gamma, lambda,
          threshold: alphaSingle, slope: betaSingle,
          r2: 0.83 + Math.random() * 0.12,
          data: dataSingle
        },
        fitDual: {
          alpha: alphaDual, beta: betaDual, gamma, lambda,
          threshold: alphaDual, slope: betaDual,
          r2: 0.80 + Math.random() * 0.12,
          data: dataDual
        }
      }
    };
  }

  const BUILDERS = { 1: buildFunc1, 2: buildFunc2, 3: buildFunc3, 4: buildFunc4 };

  // ═══════════════════════════════════════
  //  组装记录
  // ═══════════════════════════════════════
  const SUBJECT_ID = '8888';
  const GENDER = 'male';
  const AGE = '35';
  const records = [];

  // 能力等级（0=差 → 100=优）：pre 低、train 渐进、post 高
  const LEVELS = {
    1: { pre: 35, train: [40, 50, 62, 75, 85], post: 92 },
    2: { pre: 30, train: [38, 48, 60, 72, 82], post: 88 },
    3: { pre: 32, train: [40, 50, 60, 70, 80], post: 87 },
    4: { pre: 28, train: [35, 45, 58, 70, 80], post: 86 }
  };

  const NOW = Date.now();
  const BASE_TIME = NOW - 3 * 86400000;

  function pushRecord(func, phase, attemptNumber, timestamp, level) {
    const built = BUILDERS[func](level);
    const dateStr = new Date(timestamp).toISOString().split('T')[0];
    records.push({
      id: generateId() + `_${phase}_f${func}_${attemptNumber}`,
      attemptNumber: attemptNumber,
      groupKey: `${SUBJECT_ID}_${phase}_func${func}`,
      status: 'active',
      overwrittenBy: null,
      previousAttemptId: null,
      timestamp: new Date(timestamp).toISOString(),
      metadata: {
        subjectId: SUBJECT_ID,
        gender: GENDER,
        age: AGE,
        date: dateStr,
        phase: phase,
        func: func,
        attemptNumber: attemptNumber,
        snrMode: 'adaptive',
        threshold: func === 1 ? built.fit.threshold : null,
        totalTrials: built.trials.length,
        accuracy: built.metric.accuracy,
        avgRT: built.metric.avgRT
      },
      psychometricFit: built.fit,
      rawEventLog: null,
      results: built.trials
    });
  }

  for (let func = 1; func <= 4; func++) {
    const lv = LEVELS[func];
    // pre
    pushRecord(func, 'pre', 1, BASE_TIME, lv.pre);
    // train (5 rounds)
    const trainDates = [
      BASE_TIME + 1.0 * 86400000,
      BASE_TIME + 1.3 * 86400000,
      BASE_TIME + 1.6 * 86400000,
      BASE_TIME + 2.0 * 86400000,
      BASE_TIME + 2.5 * 86400000
    ];
    lv.train.forEach((lvl, i) => {
      pushRecord(func, 'train', i + 1, trainDates[i], lvl);
    });
    // post
    pushRecord(func, 'post', 1, NOW, lv.post);
  }

  // ═══════════════════════════════════════
  //  注入
  // ═══════════════════════════════════════
  if (isBrowser) {
    const STORAGE_KEY = 'audioVisualTrainingData';
    let existing = [];
    try {
      existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) { existing = []; }
    existing = existing.filter(d => !(d.metadata && d.metadata.subjectId === SUBJECT_ID));
    const merged = existing.concat(records);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    console.log(`✅ 已为被试 ${SUBJECT_ID} 生成 ${records.length} 条模拟数据（已注入 localStorage）`);
    console.log('  - pre:   4 条（每功能 1 条）');
    console.log('  - train: 20 条（每功能 5 轮）');
    console.log('  - post:  4 条（每功能 1 条）');
    console.log('每条记录均包含完整 psychometricFit（data 散点 + alpha/beta 拟合参数）');
    console.log('请刷新 history.html / result.html 查看图表。');
  } else {
    const fs = require('fs');
    const path = require('path');
    const outPath = path.join(__dirname, '..', 'data', 'experiment_history.json');
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { existing = []; }
    existing = existing.filter(d => !(d.metadata && d.metadata.subjectId === SUBJECT_ID));
    const merged = existing.concat(records);
    fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
    console.log(`✅ 已为被试 ${SUBJECT_ID} 生成 ${records.length} 条模拟数据 → ${outPath}`);
  }
})();
