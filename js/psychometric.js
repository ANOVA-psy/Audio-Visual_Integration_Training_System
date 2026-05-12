/**
 * 心理物理曲线拟合模块 (Psychometric Curve Fitting)
 * 
 * 使用带猜测率和失误率的 Logistic 函数进行最大似然估计拟合：
 * P(x) = γ + (1 - γ - λ) / (1 + exp(-β(x - α)))
 * 
 * α (alpha): 阈值 — 曲线中点对应的自变量值
 * β (beta):  斜率 — 被试对难度变化的敏感度
 * γ (gamma): 猜测率 — 随机猜测的正确概率 (4AFC: 0.25)
 * λ (lambda): 失误率 — 走神等导致的随机错误率 (典型 0.02)
 * 
 * 拟合方法：Nelder-Mead 单纯形法（2D：α, β），γ和λ固定
 */

const Psychometric = (function() {
  'use strict';

  // ==================== 核心函数 ====================

  /**
   * Logistic 心理物理函数
   * @param {number} x - 自变量（SNR、SOA 等）
   * @param {number} alpha - 阈值参数
   * @param {number} beta - 斜率参数
   * @param {number} gamma - 猜测率
   * @param {number} lambda - 失误率
   * @returns {number} 预测正确率 [0, 1]
   */
  function psychFunc(x, alpha, beta, gamma, lambda) {
    const inner = -beta * (x - alpha);
    // 防止数值溢出
    const clampedInner = Math.max(-500, Math.min(500, inner));
    return gamma + (1 - gamma - lambda) / (1 + Math.exp(clampedInner));
  }

  /**
   * 负对数似然（用于最小化）
   * @param {Array} data - [{x, k, n}] 其中 x=条件值, k=正确数, n=总数
   * @param {number} alpha
   * @param {number} beta
   * @param {number} gamma
   * @param {number} lambda
   * @returns {number} 负对数似然
   */
  function negLogLikelihood(data, alpha, beta, gamma, lambda) {
    let nll = 0;
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const p = psychFunc(d.x, alpha, beta, gamma, lambda);
      // 钳位防止 log(0)
      const pClamped = Math.max(1e-10, Math.min(1 - 1e-10, p));
      // 二项分布对数似然
      if (d.k > 0) nll -= d.k * Math.log(pClamped);
      if (d.n - d.k > 0) nll -= (d.n - d.k) * Math.log(1 - pClamped);
    }
    return nll;
  }

  // ==================== 拟合算法 ====================

  /**
   * Nelder-Mead 单纯形法（2D 优化）
   * 用于最小化 negLogLikelihood(data, alpha, beta, gamma, lambda)
   * 
   * @param {Function} objective - 目标函数 f(alpha, beta) → number
   * @param {number[]} x0 - 初始点 [alpha0, beta0]
   * @param {Object} options - 可选参数
   * @returns {{alpha: number, beta: number, nll: number}}
   */
  function nelderMead2D(objective, x0, options) {
    const opts = Object.assign({
      maxIter: 500,
      tol: 1e-8,
      alpha: 1.0,    // 反射系数
      gamma: 2.0,    // 扩展系数
      rho: 0.5,      // 收缩系数
      sigma: 0.5     // 缩小系数
    }, options);

    // 初始步长
    const step = [2.0, 0.05];

    // 初始化单纯形（3个顶点）
    let simplex = [
      [x0[0], x0[1]],
      [x0[0] + step[0], x0[1]],
      [x0[0], x0[1] + step[1]]
    ];

    // 计算每个顶点的目标函数值
    let fVals = simplex.map(p => objective(p[0], p[1]));

    for (let iter = 0; iter < opts.maxIter; iter++) {
      // 排序：fVals[0] <= fVals[1] <= fVals[2]
      const indices = [0, 1, 2];
      indices.sort((a, b) => fVals[a] - fVals[b]);
      simplex = indices.map(i => simplex[i]);
      fVals = indices.map(i => fVals[i]);

      // 收敛检查
      const range = Math.max(
        Math.abs(fVals[2] - fVals[0]),
        Math.abs(simplex[2][0] - simplex[0][0]),
        Math.abs(simplex[2][1] - simplex[0][1])
      );
      if (range < opts.tol) break;

      // 质心（排除最差点）
      const centroid = [
        (simplex[0][0] + simplex[1][0]) / 2,
        (simplex[0][1] + simplex[1][1]) / 2
      ];

      // 反射
      const xr = [
        centroid[0] + opts.alpha * (centroid[0] - simplex[2][0]),
        centroid[1] + opts.alpha * (centroid[1] - simplex[2][1])
      ];
      const fr = objective(xr[0], xr[1]);

      if (fr < fVals[0]) {
        // 扩展
        const xe = [
          centroid[0] + opts.gamma * (xr[0] - centroid[0]),
          centroid[1] + opts.gamma * (xr[1] - centroid[1])
        ];
        const fe = objective(xe[0], xe[1]);
        if (fe < fr) {
          simplex[2] = xe;
          fVals[2] = fe;
        } else {
          simplex[2] = xr;
          fVals[2] = fr;
        }
      } else if (fr < fVals[1]) {
        simplex[2] = xr;
        fVals[2] = fr;
      } else {
        // 收缩
        const xc = [
          centroid[0] + opts.rho * (simplex[2][0] - centroid[0]),
          centroid[1] + opts.rho * (simplex[2][1] - centroid[1])
        ];
        const fc = objective(xc[0], xc[1]);
        if (fc < fVals[2]) {
          simplex[2] = xc;
          fVals[2] = fc;
        } else {
          // 缩小
          for (let i = 1; i < 3; i++) {
            simplex[i] = [
              simplex[0][0] + opts.sigma * (simplex[i][0] - simplex[0][0]),
              simplex[0][1] + opts.sigma * (simplex[i][1] - simplex[0][1])
            ];
            fVals[i] = objective(simplex[i][0], simplex[i][1]);
          }
        }
      }
    }

    // 返回最佳点
    const bestIdx = fVals[0] <= fVals[1] && fVals[0] <= fVals[2] ? 0 :
                    fVals[1] <= fVals[2] ? 1 : 2;
    return {
      alpha: simplex[bestIdx][0],
      beta: simplex[bestIdx][1],
      nll: fVals[bestIdx]
    };
  }

  // ==================== 公共接口 ====================

  /**
   * 主拟合函数 — 将原始试次数据拟合为心理物理曲线
   * 
   * @param {Array} results - 试次结果数组 [{snr, correct}, ...]
   * @param {string} xKey - 自变量字段名（'snr', 'soa', 'blur' 等）
   * @param {Object} params - 可选参数
   * @param {number} params.gamma - 猜测率（默认 0.25，4选1）
   * @param {number} params.lambda - 失误率（默认 0.02）
   * @param {number} params.criterion - 阈值标准（默认 0.80，即80%正确率）
   * @returns {Object|null} 拟合结果
   */
  function fit(results, xKey, params) {
    const p = Object.assign({
      gamma: 0.25,
      lambda: 0.02,
      criterion: 0.80
    }, params);

    if (!results || results.length < 5) return null;

    // 1. 按自变量分组，计算每个条件的 (正确数/总数)
    const groups = {};
    results.forEach(r => {
      const x = r[xKey];
      if (x === undefined || x === null) return;
      if (!groups[x]) groups[x] = { x: x, k: 0, n: 0 };
      groups[x].n++;
      if (r.correct) groups[x].k++;
    });

    const data = Object.values(groups).sort((a, b) => a.x - b.x);
    
    // 至少需要2个不同条件
    if (data.length < 2) return null;

    // 2. 计算初始估计
    const xs = data.map(d => d.x);
    const proportions = data.map(d => d.k / d.n);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);

    // 初始 α：正确率最接近 50% 的点（相对猜测率和失误率的中点）
    const midPoint = (p.gamma + (1 - p.lambda)) / 2;
    let bestIdx = 0;
    let bestDiff = Infinity;
    proportions.forEach((prop, i) => {
      const diff = Math.abs(prop - midPoint);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    });
    const alpha0 = xs[bestIdx];

    // 初始 β：估计斜率
    // 使用线性回归估计初始斜率
    const xRange = xMax - xMin;
    let beta0 = 0.5;
    if (xRange > 0) {
      // 如果正确率跨度够大，用跨度/范围估算
      const propRange = Math.max(...proportions) - Math.min(...proportions);
      if (propRange > 0.1) {
        beta0 = Math.max(0.1, propRange / xRange * 4);
      }
    }

    // 3. 多起点 Nelder-Mead 拟合
    const objective = (a, b) => negLogLikelihood(data, a, b, p.gamma, p.lambda);
    
    let bestResult = null;
    
    // 多个初始点增加鲁棒性
    const starts = [
      [alpha0, beta0],
      [alpha0, beta0 * 2],
      [alpha0, beta0 * 0.5],
      [(xMin + xMax) / 2, 0.3],
      [(xMin + xMax) / 2, 1.0]
    ];

    starts.forEach(start => {
      try {
        const result = nelderMead2D(objective, start);
        if (!bestResult || result.nll < bestResult.nll) {
          bestResult = result;
        }
      } catch (e) {
        // 某个起点失败，跳过
      }
    });

    if (!bestResult) return null;

    // 4. 计算阈值（在 criterion 水平的自变量值）
    // P(x) = criterion → x = alpha - (1/beta) * ln((1-gamma-lambda)/(criterion-gamma) - 1)
    let threshold = null;
    const critClamped = Math.max(p.gamma + 0.01, Math.min(1 - p.lambda - 0.01, p.criterion));
    const innerRatio = (1 - p.gamma - p.lambda) / (critClamped - p.gamma) - 1;
    if (innerRatio > 0 && bestResult.beta > 0) {
      threshold = bestResult.alpha - (1 / bestResult.beta) * Math.log(innerRatio);
    }

    // 5. 计算拟合优度（伪 R²）
    const nullModel = data.reduce((sum, d) => {
      const pAvg = d.k / d.n;
      if (pAvg > 0) sum -= d.k * Math.log(pAvg);
      if (d.n - d.k > 0) sum -= (d.n - d.k) * Math.log(1 - pAvg);
      return sum;
    }, 0);
    const r2 = 1 - bestResult.nll / nullModel;

    return {
      alpha: bestResult.alpha,          // 阈值（曲线中点）
      beta: bestResult.beta,            // 斜率
      gamma: p.gamma,                   // 猜测率
      lambda: p.lambda,                 // 失误率
      threshold: threshold,             // criterion 水平处的阈值
      criterion: p.criterion,           // 阈值标准
      nll: bestResult.nll,              // 负对数似然
      r2: Math.max(0, r2),              // 伪 R²
      data: data,                       // 分组数据 [{x, k, n, p}]
      // 为 data 添加经验正确率
      proportions: proportions
    };
  }

  /**
   * 根据拟合结果生成曲线点（用于绘图）
   * @param {Object} fitResult - fit() 的返回值
   * @param {number} nPoints - 曲线点数
   * @returns {Array} [{x, y}] 曲线坐标
   */
  function generateCurvePoints(fitResult, nPoints) {
    nPoints = nPoints || 100;
    if (!fitResult || !fitResult.data || fitResult.data.length < 2) return [];

    const xs = fitResult.data.map(d => d.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const padding = (xMax - xMin) * 0.15;

    const points = [];
    for (let i = 0; i <= nPoints; i++) {
      const x = xMin - padding + (xMax - xMin + 2 * padding) * (i / nPoints);
      const y = psychFunc(x, fitResult.alpha, fitResult.beta, fitResult.gamma, fitResult.lambda);
      points.push({ x: x, y: y });
    }
    return points;
  }

  /**
   * 在 Canvas 上绘制心理物理曲线（S 型曲线）
   * 
   * @param {HTMLCanvasElement|string} canvas - Canvas 元素或 ID
   * @param {Object} fitResult - fit() 的返回值
   * @param {Object} options - 绘图选项
   */
  function drawCurve(canvas, fitResult, options) {
    const canvasEl = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!canvasEl || !fitResult) return;

    const ctx = canvasEl.getContext('2d');
    const opts = Object.assign({
      title: '心理物理曲线',
      xLabel: 'SNR (dB)',
      yLabel: '正确率',
      showDataPoints: true,
      showThreshold: true,
      showCriterion: true,
      lineColor: '#6366f1',
      pointColor: '#f59e0b',
      thresholdColor: '#ef4444',
      criterionColor: '#10b981',
      bgColor: '#fafafa',
      gridColor: '#e5e7eb'
    }, options);

    // 设置 canvas 尺寸
    const rect = canvasEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const margin = { top: 40, right: 30, bottom: 50, left: 55 };
    const plotW = W - margin.left - margin.right;
    const plotH = H - margin.top - margin.bottom;

    // 清空
    ctx.fillStyle = opts.bgColor;
    ctx.fillRect(0, 0, W, H);

    // 数据范围
    const xs = fitResult.data.map(d => d.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const xPad = (xMax - xMin) * 0.15;

    const yMin = 0;
    const yMax = 1.05;

    // 坐标转换
    function toCanvasX(x) { return margin.left + (x - (xMin - xPad)) / (xMax - xMin + 2 * xPad) * plotW; }
    function toCanvasY(y) { return margin.top + plotH - (y - yMin) / (yMax - yMin) * plotH; }

    // 绘制网格
    ctx.strokeStyle = opts.gridColor;
    ctx.lineWidth = 0.5;

    // Y 轴网格
    for (let y = 0; y <= 1; y += 0.25) {
      const cy = toCanvasY(y);
      ctx.beginPath();
      ctx.moveTo(margin.left, cy);
      ctx.lineTo(W - margin.right, cy);
      ctx.stroke();
    }

    // X 轴网格
    const xStep = getXStep(xMin - xPad, xMax + xPad, 7);
    for (let x = Math.ceil((xMin - xPad) / xStep) * xStep; x <= xMax + xPad; x += xStep) {
      const cx = toCanvasX(x);
      ctx.beginPath();
      ctx.moveTo(cx, margin.top);
      ctx.lineTo(cx, margin.top + plotH);
      ctx.stroke();
    }

    // 标准线（80% criterion）
    if (opts.showCriterion && fitResult.criterion) {
      const cy = toCanvasY(fitResult.criterion);
      ctx.strokeStyle = opts.criterionColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(margin.left, cy);
      ctx.lineTo(W - margin.right, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = opts.criterionColor;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${(fitResult.criterion * 100).toFixed(0)}% 标准`, W - margin.right - 65, cy - 5);
    }

    // 猜测率线
    if (fitResult.gamma > 0) {
      const gy = toCanvasY(fitResult.gamma);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(margin.left, gy);
      ctx.lineTo(W - margin.right, gy);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`猜测率 ${(fitResult.gamma * 100).toFixed(0)}%`, margin.left + 5, gy - 4);
    }

    // 绘制拟合曲线
    const curvePoints = generateCurvePoints(fitResult, 200);
    if (curvePoints.length > 0) {
      ctx.strokeStyle = opts.lineColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      curvePoints.forEach((pt, i) => {
        const cx = toCanvasX(pt.x);
        const cy = toCanvasY(pt.y);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
    }

    // 绘制阈值竖线
    if (opts.showThreshold && fitResult.threshold !== null) {
      const tx = toCanvasX(fitResult.threshold);
      ctx.strokeStyle = opts.thresholdColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(tx, margin.top);
      ctx.lineTo(tx, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // 阈值标注
      ctx.fillStyle = opts.thresholdColor;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      const xUnit = opts.xLabel.includes('dB') ? ' dB' : (opts.xLabel.includes('ms') ? ' ms' : '');
      ctx.fillText(`阈值: ${fitResult.threshold.toFixed(1)}${xUnit}`, tx, margin.top - 8);
    }

    // 绘制数据点
    if (opts.showDataPoints && fitResult.data) {
      fitResult.data.forEach(d => {
        const cx = toCanvasX(d.x);
        const cy = toCanvasY(d.k / d.n);
        const r = Math.max(3, Math.min(8, Math.sqrt(d.n) * 1.5));

        // 点
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = opts.pointColor;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 误差棒（95% CI 二项分布近似）
        const n = d.n;
        const p = d.k / n;
        const se = Math.sqrt(p * (1 - p) / n);
        const ciH = Math.min(p + 1.96 * se, 1);
        const ciL = Math.max(p - 1.96 * se, 0);

        ctx.strokeStyle = opts.pointColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, toCanvasY(ciH));
        ctx.lineTo(cx, toCanvasY(ciL));
        ctx.stroke();

        // 误差棒端帽
        const capW = 4;
        ctx.beginPath();
        ctx.moveTo(cx - capW, toCanvasY(ciH));
        ctx.lineTo(cx + capW, toCanvasY(ciH));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - capW, toCanvasY(ciL));
        ctx.lineTo(cx + capW, toCanvasY(ciL));
        ctx.stroke();
      });
    }

    // 坐标轴
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + plotH);
    ctx.lineTo(W - margin.right, margin.top + plotH);
    ctx.stroke();

    // 轴标签
    ctx.fillStyle = '#374151';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel, W / 2, H - 8);

    ctx.save();
    ctx.translate(14, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel, 0, 0);
    ctx.restore();

    // 标题
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(opts.title, W / 2, 18);

    // X 轴刻度
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'center';
    for (let x = Math.ceil((xMin - xPad) / xStep) * xStep; x <= xMax + xPad; x += xStep) {
      const cx = toCanvasX(x);
      ctx.fillText(x.toFixed(xStep < 1 ? 1 : 0), cx, margin.top + plotH + 18);
    }

    // Y 轴刻度
    ctx.textAlign = 'right';
    for (let y = 0; y <= 1; y += 0.25) {
      const cy = toCanvasY(y);
      ctx.fillText((y * 100).toFixed(0) + '%', margin.left - 8, cy + 4);
    }

    // 拟合参数文本框
    const boxX = W - margin.right - 170;
    const boxY = margin.top + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(boxX, boxY, 162, 68);
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, 162, 68);

    ctx.fillStyle = '#374151';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`\u03B1 (阈值) = ${fitResult.alpha.toFixed(2)}`, boxX + 8, boxY + 16);
    ctx.fillText(`\u03B2 (斜率) = ${fitResult.beta.toFixed(3)}`, boxX + 8, boxY + 32);
    ctx.fillText(`\u03B3 (猜测) = ${fitResult.gamma.toFixed(2)}`, boxX + 8, boxY + 48);
    ctx.fillText(`伪 R\u00B2 = ${fitResult.r2.toFixed(3)}`, boxX + 8, boxY + 64);
  }

  /**
   * 计算合适的刻度步长
   */
  function getXStep(min, max, targetTicks) {
    const range = max - min;
    const rawStep = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / mag;
    let step;
    if (normalized <= 1.5) step = 1 * mag;
    else if (normalized <= 3.5) step = 2 * mag;
    else if (normalized <= 7.5) step = 5 * mag;
    else step = 10 * mag;
    return Math.max(step, 1);
  }

  // ==================== 公共 API ====================
  return {
    fit: fit,
    psychFunc: psychFunc,
    generateCurvePoints: generateCurvePoints,
    drawCurve: drawCurve,
    negLogLikelihood: negLogLikelihood
  };
})();
