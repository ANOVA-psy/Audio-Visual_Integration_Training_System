/**
 * js/charts.js - 纯 Canvas 图表库
 * 所有图表使用原生 Canvas API 绘制，支持高清屏
 */

const Charts = (function() {
  'use strict';

  // ==================== 通用工具 ====================

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 600, height: 320 };
    const W = Math.floor(rect.width) || 600;
    const H = Math.floor(rect.height) || 320;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx: ctx, W: W, H: H };
  }

  function getNiceStep(min, max, target) {
    const range = max - min;
    const raw = range / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step;
    if (norm <= 1.5) step = 1 * mag;
    else if (norm <= 3.5) step = 2 * mag;
    else if (norm <= 7.5) step = 5 * mag;
    else step = 10 * mag;
    return Math.max(step, 0.1);
  }

  // Catmull-Rom 转 Bezier 平滑
  function smoothToBezier(points, tension) {
    tension = tension || 0.3;
    if (points.length < 2) return points;
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[Math.min(points.length - 1, i + 1)];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      out.push({
        x: p1.x, y: p1.y,
        cp1x: p1.x + (p2.x - p0.x) * tension / 2,
        cp1y: p1.y + (p2.y - p0.y) * tension / 2,
        cp2x: p2.x - (p3.x - p1.x) * tension / 2,
        cp2y: p2.y - (p3.y - p1.y) * tension / 2
      });
    }
    return out;
  }

  // Logistic 函数
  function psychFunc(x, alpha, beta, gamma, lambda) {
    const inner = -beta * (x - alpha);
    const ci = Math.max(-500, Math.min(500, inner));
    return gamma + (1 - gamma - lambda) / (1 + Math.exp(ci));
  }

  // ==================== 1. 趋势折线图 ====================

  function drawTrendLine(canvas, data, opts) {
    opts = opts || {};
    const { ctx, W, H } = setupCanvas(canvas);
    const mg = { top: 50, right: 30, bottom: 50, left: 55 };
    const pW = W - mg.left - mg.right;
    const pH = H - mg.top - mg.bottom;

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, H);

    if (!data || data.length === 0) {
      ctx.fillStyle = '#999';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', W / 2, H / 2);
      return;
    }

    // Y 轴固定 [0, 1]
    const xMin = 0;
    const xMax = data.length - 1;
    const yMin = 0, yMax = 1;

    function toX(x) { return mg.left + (x - xMin) / (xMax - xMin) * pW; }
    function toY(y) { return mg.top + pH - (y - yMin) / (yMax - yMin) * pH; }

    // 网格线（Y轴固定 0-1）
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (var y = 0; y <= 1; y += 0.25) {
      ctx.beginPath();
      ctx.moveTo(mg.left, toY(y));
      ctx.lineTo(mg.left + pW, toY(y));
      ctx.stroke();
    }

    // 数据点 + 平滑连线
    const points = data.map(function(d, i) { return { x: toX(i), y: toY(d.y) }; });
    const smoothPts = smoothToBezier(points, 0.3);

    ctx.strokeStyle = opts.lineColor || '#6366f1';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (smoothPts.length > 0) {
      ctx.moveTo(smoothPts[0].x, smoothPts[0].y);
      smoothPts.forEach(function(p) {
        if (p.cp1x !== undefined) {
          ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cp2x, p.cp2y, p.x, p.y);
        } else {
          ctx.lineTo(p.x, p.y);
        }
      });
    }
    ctx.stroke();

    // 数据点圆圈
    data.forEach(function(d, i) {
      var x = toX(i);
      var y = toY(d.y);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = opts.lineColor || '#6366f1';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // 坐标轴
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mg.left, mg.top);
    ctx.lineTo(mg.left, mg.top + pH);
    ctx.lineTo(mg.left + pW, mg.top + pH);
    ctx.stroke();

    // Y轴刻度（0%, 25%, 50%, 75%, 100%）
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (var y2 = 0; y2 <= 1; y2 += 0.25) {
      ctx.fillText((y2 * 100).toFixed(0) + '%', mg.left - 6, toY(y2) + 4);
    }

    ctx.fillStyle = '#374151';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel || '试次', W / 2, H - 8);
    ctx.save();
    ctx.translate(14, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel || '正确率', 0, 0);
    ctx.restore();
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(opts.title || '正确率趋势', W / 2, 18);
  }

  // ==================== 2. 热力图 ====================

  function drawHeatmap(canvas, data, opts) {
    opts = opts || {};
    const { ctx, W, H } = setupCanvas(canvas);
    const mg = { top: 50, right: 80, bottom: 60, left: 80 };
    const pW = W - mg.left - mg.right;
    const pH = H - mg.top - mg.bottom;

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, H);

    if (!data || !data.matrix || data.matrix.length === 0) {
      ctx.fillStyle = '#999';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', W / 2, H / 2);
      return;
    }

    var rows = data.matrix.length;
    var cols = data.matrix[0].length;
    var cellW = pW / cols;
    var cellH = pH / rows;

    // Y 轴固定 [0, 1]
    var minVal = 0, maxVal = 1;

    function valueToColor(val) {
      var t = maxVal === minVal ? 0.5 : (val - minVal) / (maxVal - minVal);
      if (t < 0.5) {
        var s = t * 2;
        return 'rgb(' + Math.round(255 * s) + ',' + Math.round(255 * s) + ',255)';
      } else {
        var s2 = (t - 0.5) * 2;
        return 'rgb(255,' + Math.round(255 * (1 - s2)) + ',' + Math.round(255 * (1 - s2)) + ')';
      }
    }

    // 绘制单元格
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var x = mg.left + c * cellW;
        var y = mg.top + r * cellH;
        var val = data.matrix[r][c];
        ctx.fillStyle = valueToColor(val);
        ctx.fillRect(x, y, cellW, cellH);
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, cellW, cellH);
        ctx.fillStyle = val > 0.7 ? '#fff' : '#000';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((val * 100).toFixed(0) + '%', x + cellW / 2, y + cellH / 2);
      }
    }

    // Y 轴标签
    ctx.fillStyle = '#374151';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var r2 = 0; r2 < rows; r2++) {
      var y2 = mg.top + r2 * cellH + cellH / 2;
      ctx.fillText(data.yLabels[r2] || '', mg.left - 5, y2);
    }

    // X 轴标签
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var c2 = 0; c2 < cols; c2++) {
      var x2 = mg.left + c2 * cellW + cellW / 2;
      ctx.fillText(data.xLabels[c2] || '', x2, mg.top + pH + 8);
    }

    ctx.fillStyle = '#374151';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel || '', W / 2, H - 8);
    ctx.save();
    ctx.translate(14, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel || '', 0, 0);
    ctx.restore();
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(opts.title || '热力图', W / 2, 18);
  }

  // ==================== 3. 面积图 ====================

  function drawAreaChart(canvas, data, opts) {
    opts = opts || {};
    const { ctx, W, H } = setupCanvas(canvas);
    const mg = { top: 50, right: 30, bottom: 50, left: 55 };
    const pW = W - mg.left - mg.right;
    const pH = H - mg.top - mg.bottom;

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, H);

    if (!data || !data.single || !data.dual) {
      ctx.fillStyle = '#999';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', W / 2, H / 2);
      return;
    }

    var allX = data.single.x.concat(data.dual.x);
    var xMin = Math.min.apply(null, allX);
    var xMax = Math.max.apply(null, allX);
    // Y 轴固定 [0, 1]
    var yMin = 0, yMax = 1;

    function toX(x) { return mg.left + (x - xMin) / (xMax - xMin) * pW; }
    function toY(y) { return mg.top + pH - (y - yMin) / (yMax - yMin) * pH; }

    // 网格（Y 轴固定 0-1）
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (var y = 0; y <= 1; y += 0.25) {
      ctx.beginPath();
      ctx.moveTo(mg.left, toY(y));
      ctx.lineTo(mg.left + pW, toY(y));
      ctx.stroke();
    }

    // single 面积（蓝色）
    ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
    ctx.beginPath();
    ctx.moveTo(toX(data.single.x[0]), toY(0));
    data.single.x.forEach(function(x, i) {
      ctx.lineTo(toX(x), toY(data.single.y[i]));
    });
    ctx.lineTo(toX(data.single.x[data.single.x.length - 1]), toY(0));
    ctx.closePath();
    ctx.fill();

    // dual 面积（红色）
    ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.beginPath();
    ctx.moveTo(toX(data.dual.x[0]), toY(0));
    data.dual.x.forEach(function(x, i) {
      ctx.lineTo(toX(x), toY(data.dual.y[i]));
    });
    ctx.lineTo(toX(data.dual.x[data.dual.x.length - 1]), toY(0));
    ctx.closePath();
    ctx.fill();

    // 线条（平滑）
    function drawSmoothLine(points, color) {
      var smooth = smoothToBezier(points, 0.3);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (smooth.length > 0) {
        ctx.moveTo(smooth[0].x, smooth[0].y);
        smooth.forEach(function(p) {
          if (p.cp1x !== undefined) {
            ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cp2x, p.cp2y, p.x, p.y);
          } else {
            ctx.lineTo(p.x, p.y);
          }
        });
      }
      ctx.stroke();
    }

    var singlePts = data.single.x.map(function(x, i) { return { x: toX(x), y: toY(data.single.y[i]) }; });
    drawSmoothLine(singlePts, '#6366f1');

    var dualPts = data.dual.x.map(function(x, i) { return { x: toX(x), y: toY(data.dual.y[i]) }; });
    drawSmoothLine(dualPts, '#ef4444');

    // 坐标轴
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mg.left, mg.top);
    ctx.lineTo(mg.left, mg.top + pH);
    ctx.lineTo(mg.left + pW, mg.top + pH);
    ctx.stroke();

    // Y 轴刻度（0%, 25%, 50%, 75%, 100%）
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (var y2 = 0; y2 <= 1; y2 += 0.25) {
      ctx.fillText((y2 * 100).toFixed(0) + '%', mg.left - 6, toY(y2) + 4);
    }

    ctx.fillStyle = '#374151';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel || 'SNR (dB)', W / 2, H - 8);
    ctx.save();
    ctx.translate(14, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel || '正确率', 0, 0);
    ctx.restore();
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(opts.title || '干扰损失对比', W / 2, 18);

    // 图例
    var legX = mg.left + 10;
    var legY = mg.top + 12;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(legX, legY - 12, 160, 40);
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.strokeRect(legX, legY - 12, 160, 40);

    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(legX + 8, legY);
    ctx.lineTo(legX + 30, legY);
    ctx.stroke();
    ctx.fillStyle = '#374151';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('单说话人', legX + 36, legY + 4);

    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(legX + 8, legY + 18);
    ctx.lineTo(legX + 30, legY + 18);
    ctx.stroke();
    ctx.fillText('双说话人', legX + 36, legY + 22);
  }

  // ==================== 4. 噪音阈值拟合图 (S型) ====================

  function drawPsychometric(canvas, fitResult, rawData, opts) {
    opts = opts || {};
    const { ctx, W, H } = setupCanvas(canvas);
    const mg = { top: 50, right: 100, bottom: 55, left: 60 };
    const pW = W - mg.left - mg.right;
    const pH = H - mg.top - mg.bottom;

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, H);

    if (!fitResult || !rawData || rawData.length === 0) {
      ctx.fillStyle = '#999'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('暂无数据', W / 2, H / 2);
      return;
    }

    const xs = rawData.map(function(d) { return d.x; });
    const xMin = Math.min.apply(null, xs) - 1;
    const xMax = Math.max.apply(null, xs) + 1;
    const yMin = 0, yMax = 1;

    function toX(x) { return mg.left + (x - xMin) / (xMax - xMin) * pW; }
    function toY(y) { return mg.top + pH - (y - yMin) / (yMax - yMin) * pH; }

    // 网格
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
    for (var y = 0; y <= 1; y += 0.25) {
      ctx.beginPath(); ctx.moveTo(mg.left, toY(y)); ctx.lineTo(mg.left + pW, toY(y)); ctx.stroke();
    }
    var xStep = getNiceStep(xMin, xMax, 6);
    for (var x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
      ctx.beginPath(); ctx.moveTo(toX(x), mg.top); ctx.lineTo(toX(x), mg.top + pH); ctx.stroke();
    }

    // 阈值线 Y = criterion (默认 0.75)
    // thresholdLine 可以是 0-1 之间的值（如 0.75）或百分比（如 75）
    var critY = 0.75;
    if (opts.thresholdLine !== undefined) {
      critY = opts.thresholdLine;
      if (critY > 1) critY = critY / 100; // 如果是百分比，转换为小数
    }
    ctx.strokeStyle = '#10b981'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 5]);
    ctx.beginPath(); ctx.moveTo(mg.left, toY(critY)); ctx.lineTo(mg.left + pW, toY(critY)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#10b981'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText((critY * 100).toFixed(0) + '% 标准', mg.left + pW + 5, toY(critY) - 3);

    // 拟合曲线（200 点采样 + 平滑）
    var curvePts = [];
    for (var i = 0; i <= 200; i++) {
      var xv = xMin + (xMax - xMin) * (i / 200);
      var yv = psychFunc(xv, fitResult.alpha, fitResult.beta, fitResult.gamma || 0.25, fitResult.lambda || 0.02);
      curvePts.push({ x: toX(xv), y: toY(yv) });
    }
    var smoothPts = smoothToBezier(curvePts, 0.3);

    ctx.strokeStyle = opts.lineColor || '#6366f1'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (smoothPts.length > 0) {
      ctx.moveTo(smoothPts[0].x, smoothPts[0].y);
      for (var j = 0; j < smoothPts.length; j++) {
        var p = smoothPts[j];
        if (p.cp1x !== undefined) {
          ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cp2x, p.cp2y, p.x, p.y);
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
    }
    ctx.stroke();

    // 阈值点（曲线与 criterion 交点）
    if (fitResult.threshold !== null && fitResult.threshold !== undefined) {
      var tx = fitResult.threshold;
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(toX(tx), toY(critY)); ctx.lineTo(toX(tx), mg.top + pH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(toX(tx), toY(critY), 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#ef4444'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      var unit = opts.xLabel && opts.xLabel.indexOf('dB') >= 0 ? ' dB' : (opts.xLabel && opts.xLabel.indexOf('ms') >= 0 ? ' ms' : '');
      ctx.fillText('Threshold: ' + tx.toFixed(1) + unit, toX(tx), toY(critY) - 12);
    }

    // 原始数据点
    rawData.forEach(function(d) {
      var cx = toX(d.x);
      var cy = toY(d.k / d.n);
      var r = Math.max(4, Math.min(12, Math.sqrt(d.n || 20) * 1.8));
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.8)'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      // 误差棒
      var p2 = d.k / d.n;
      var se = Math.sqrt(p2 * (1 - p2) / d.n);
      var ciH = Math.min(p2 + 1.96 * se, 1), ciL = Math.max(p2 - 1.96 * se, 0);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, toY(ciH)); ctx.lineTo(cx, toY(ciL)); ctx.stroke();
    });

    // 坐标轴
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mg.left, mg.top); ctx.lineTo(mg.left, mg.top + pH); ctx.lineTo(mg.left + pW, mg.top + pH); ctx.stroke();

    // 刻度
    ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    for (var x2 = Math.ceil(xMin / xStep) * xStep; x2 <= xMax; x2 += xStep) {
      ctx.fillText(x2.toFixed(xStep < 1 ? 1 : 0), toX(x2), mg.top + pH + 16);
    }
    ctx.textAlign = 'right';
    for (var y2 = 0; y2 <= 1; y2 += 0.25) {
      ctx.fillText((y2 * 100).toFixed(0) + '%', mg.left - 6, toY(y2) + 4);
    }

    // 轴标签
    ctx.fillStyle = '#374151'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel || 'SNR (dB)', mg.left + pW / 2, H - 8);
    ctx.save(); ctx.translate(14, mg.top + pH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel || '正确率', 0, 0); ctx.restore();

    // 标题
    ctx.fillStyle = '#111827'; ctx.font = 'bold 14px sans-serif';
    ctx.fillText(opts.title || '心理测量函数', mg.left + pW / 2, 20);

    // R²
    if (fitResult.r2 !== undefined) {
      var bx = mg.left + pW - 80;
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(bx, mg.top + 4, 76, 20);
      ctx.fillStyle = '#6366f1'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
      ctx.fillText('R\u00B2 = ' + fitResult.r2.toFixed(2), bx + 4, mg.top + 18);
    }
  }

  // ==================== 5. 双条件 S 型曲线（视觉增益） ====================

  function drawDualPsychometric(canvas, fitClear, fitBlur, opts) {
    opts = opts || {};
    const { ctx, W, H } = setupCanvas(canvas);
    const mg = { top: 50, right: 30, bottom: 55, left: 60 };
    const pW = W - mg.left - mg.right;
    const pH = H - mg.top - mg.bottom;

    ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, W, H);

    if (!fitClear || !fitBlur) {
      ctx.fillStyle = '#999'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('暂无数据', W / 2, H / 2); return;
    }

    var allData = (fitClear.data || []).concat(fitBlur.data || []);
    var xs = allData.map(function(d) { return d.x; });
    var xMin = Math.min.apply(null, xs) - 1;
    var xMax = Math.max.apply(null, xs) + 1;

    function toX(x) { return mg.left + (x - xMin) / (xMax - xMin) * pW; }
    function toY(y) { return mg.top + pH - y * pH; }

    // 网格
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
    for (var y = 0; y <= 1; y += 0.25) {
      ctx.beginPath(); ctx.moveTo(mg.left, toY(y)); ctx.lineTo(mg.left + pW, toY(y)); ctx.stroke();
    }

    // 阈值线 Y=0.75
    ctx.strokeStyle = '#10b981'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 5]);
    ctx.beginPath(); ctx.moveTo(mg.left, toY(0.75)); ctx.lineTo(mg.left + pW, toY(0.75)); ctx.stroke();
    ctx.setLineDash([]);

    // 绘制单条曲线
    function drawOne(fit, color) {
      var pts = [];
      for (var i = 0; i <= 200; i++) {
        var xv = xMin + (xMax - xMin) * (i / 200);
        var yv = psychFunc(xv, fit.alpha, fit.beta, fit.gamma || 0.25, fit.lambda || 0.02);
        pts.push({ x: toX(xv), y: toY(yv) });
      }
      var smooth = smoothToBezier(pts, 0.3);
      ctx.strokeStyle = color; ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (smooth.length > 0) {
        ctx.moveTo(smooth[0].x, smooth[0].y);
        smooth.forEach(function(p) {
          if (p.cp1x) ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cp2x, p.cp2y, p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
      }
      ctx.stroke();
    }

    drawOne(fitClear, '#3b82f6');
    drawOne(fitBlur, '#ef4444');

    // 视觉增益箭头
    if (fitClear.threshold !== null && fitBlur.threshold !== null) {
      var gain = Math.abs(fitClear.threshold - fitBlur.threshold);
      var x1 = fitClear.threshold, x2 = fitBlur.threshold;
      ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(toX(x1), toY(0.75)); ctx.lineTo(toX(x2), toY(0.75)); ctx.stroke();
      // 箭头
      var dir = x2 > x1 ? 1 : -1;
      ctx.fillStyle = '#8b5cf6';
      ctx.beginPath();
      ctx.moveTo(toX(x2) + dir * 8, toY(0.75));
      ctx.lineTo(toX(x2) - dir * 4, toY(0.75) - 5);
      ctx.lineTo(toX(x2) - dir * 4, toY(0.75) + 5);
      ctx.fill();
      // 标签
      ctx.fillStyle = '#7c3aed'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Visual Gain = ' + gain.toFixed(1) + ' dB', (toX(x1) + toX(x2)) / 2, toY(0.75) - 12);
    }

    // 坐标轴
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mg.left, mg.top); ctx.lineTo(mg.left, mg.top + pH); ctx.lineTo(mg.left + pW, mg.top + pH); ctx.stroke();

    // 刻度
    var xStep = getNiceStep(xMin, xMax, 6);
    ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    for (var x3 = Math.ceil(xMin / xStep) * xStep; x3 <= xMax; x3 += xStep) {
      ctx.fillText(x3.toFixed(xStep < 1 ? 1 : 0), toX(x3), mg.top + pH + 16);
    }

    // 图例
    var legX = mg.left + 10, legY = mg.top + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(legX, legY, 140, 36);
    ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1; ctx.strokeRect(legX, legY, 140, 36);
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(legX + 8, legY + 12); ctx.lineTo(legX + 28, legY + 12); ctx.stroke();
    ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(opts.label1 || '清晰', legX + 34, legY + 16);
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath(); ctx.moveTo(legX + 8, legY + 26); ctx.lineTo(legX + 28, legY + 26); ctx.stroke();
    ctx.fillText(opts.label2 || '模糊', legX + 34, legY + 30);

    // 标题
    ctx.fillStyle = '#111827'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(opts.title || '清晰/模糊 心理测量函数', mg.left + pW / 2, 20);
  }

  // ==================== 6. SOA 整合时窗（倒 U 型） ====================

  function drawIntegrationWindow(canvas, fitResult, opts) {
    opts = opts || {};
    const { ctx, W, H } = setupCanvas(canvas);
    const mg = { top: 50, right: 30, bottom: 60, left: 60 };
    const pW = W - mg.left - mg.right;
    const pH = H - mg.top - mg.bottom;

    ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, W, H);

    if (!fitResult || !fitResult.data || fitResult.data.length === 0) {
      ctx.fillStyle = '#999'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('暂无数据', W / 2, H / 2); return;
    }

    var data = fitResult.data;
    var xs = data.map(function(d) { return d.x; });
    var xMin = Math.min.apply(null, xs) - 20;
    var xMax = Math.max.apply(null, xs) + 20;

    function toX(x) { return mg.left + (x - xMin) / (xMax - xMin) * pW; }
    function toY(y) { return mg.top + pH - y * pH; }

    // 网格
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
    for (var y = 0; y <= 1; y += 0.25) {
      ctx.beginPath(); ctx.moveTo(mg.left, toY(y)); ctx.lineTo(mg.left + pW, toY(y)); ctx.stroke();
    }

    // 整合时窗阴影区域
    var lowerSOA = opts.lowerSOA || (fitResult.visualLeadWindow ? -fitResult.visualLeadWindow : -150);
    var upperSOA = opts.upperSOA || (fitResult.audioLeadWindow || 80);
    var windowWidth = opts.window || (upperSOA - lowerSOA);

    ctx.fillStyle = 'rgba(128, 0, 128, 0.1)';
    ctx.beginPath();
    ctx.moveTo(toX(lowerSOA), toY(0));
    for (var i = 0; i <= 100; i++) {
      var xv = lowerSOA + (upperSOA - lowerSOA) * (i / 100);
      var yv = estimateY(data, xv);
      ctx.lineTo(toX(xv), toY(yv));
    }
    ctx.lineTo(toX(upperSOA), toY(0));
    ctx.closePath();
    ctx.fill();

    // 阴影标签
    ctx.fillStyle = 'rgba(128, 0, 128, 0.7)'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('整合时窗宽度: ' + windowWidth + ' ms', (toX(lowerSOA) + toX(upperSOA)) / 2, toY(0.5) - 8);

    // 拟合曲线（倒U型）
    var curvePts = [];
    for (var j = 0; j <= 200; j++) {
      var xv2 = xMin + (xMax - xMin) * (j / 200);
      var yv2 = estimateY(data, xv2);
      curvePts.push({ x: toX(xv2), y: toY(yv2) });
    }
    var smoothPts = smoothToBezier(curvePts, 0.3);

    ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (smoothPts.length > 0) {
      ctx.moveTo(smoothPts[0].x, smoothPts[0].y);
      smoothPts.forEach(function(p) {
        if (p.cp1x) ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cp2x, p.cp2y, p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
    }
    ctx.stroke();

    // 数据点
    data.forEach(function(d) {
      var cx = toX(d.x);
      var cy = toY(d.k / d.n);
      var r = Math.max(3, Math.min(8, Math.sqrt(d.n || 20) * 1.5));
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(139, 92, 246, 0.8)'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    });

    // 坐标轴（X=0 居中）
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mg.left, mg.top); ctx.lineTo(mg.left, mg.top + pH); ctx.lineTo(mg.left + pW, mg.top + pH); ctx.stroke();

    // X轴刻度
    var xStep = getNiceStep(xMin, xMax, 8);
    ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    for (var x4 = Math.ceil(xMin / xStep) * xStep; x4 <= xMax; x4 += xStep) {
      ctx.fillText(x4 + 'ms', toX(x4), mg.top + pH + 16);
    }

    // Y轴刻度
    ctx.textAlign = 'right';
    for (var y2 = 0; y2 <= 1; y2 += 0.25) {
      ctx.fillText((y2 * 100).toFixed(0) + '%', mg.left - 6, toY(y2) + 4);
    }

    // 0 线
    ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(toX(0), mg.top); ctx.lineTo(toX(0), mg.top + pH); ctx.stroke();
    ctx.setLineDash([]);

    // 标题
    ctx.fillStyle = '#111827'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(opts.title || 'SOA 多感官整合时窗', mg.left + pW / 2, 20);
  }

  function estimateY(data, x) {
    if (data.length === 0) return 0;
    var sorted = data.slice().sort(function(a, b) { return a.x - b.x; });
    if (x <= sorted[0].x) return sorted[0].k / sorted[0].n;
    if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].k / sorted[sorted.length - 1].n;
    for (var i = 0; i < sorted.length - 1; i++) {
      if (x >= sorted[i].x && x <= sorted[i + 1].x) {
        var t = (x - sorted[i].x) / (sorted[i + 1].x - sorted[i].x);
        return (sorted[i].k / sorted[i].n) * (1 - t) + (sorted[i + 1].k / sorted[i + 1].n) * t;
      }
    }
    return 0;
  }

  // ==================== 7. 干扰抑制成本（双 Grid） ====================

  function drawInterferenceCost(canvas, fitSingle, fitDual, opts) {
    opts = opts || {};
    const { ctx, W, H } = setupCanvas(canvas);
    var gridW = (W - 90) / 2;
    var mg = { top: 50, bottom: 55, left: 60 };
    var pH = H - mg.top - mg.bottom;

    ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, W, H);

    if (!fitSingle || !fitDual) {
      ctx.fillStyle = '#999'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('暂无数据', W / 2, H / 2); return;
    }

    var leftX = 30;
    var rightX = leftX + gridW;

    var allData = (fitSingle.data || []).concat(fitDual.data || []);
    var xs = allData.map(function(d) { return d.x; });
    var xMin = Math.min.apply(null, xs) - 1;
    var xMax = Math.max.apply(null, xs) + 1;

    function toX1(x) { return leftX + (x - xMin) / (xMax - xMin) * gridW; }
    function toY(y) { return mg.top + pH - y * pH; }

    // 网格
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
    for (var y = 0; y <= 1; y += 0.25) {
      ctx.beginPath(); ctx.moveTo(leftX, toY(y)); ctx.lineTo(rightX, toY(y)); ctx.stroke();
    }

    // 阈值线
    ctx.strokeStyle = '#10b981'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 5]);
    ctx.beginPath(); ctx.moveTo(leftX, toY(0.75)); ctx.lineTo(rightX, toY(0.75)); ctx.stroke();
    ctx.setLineDash([]);

    // 绘制曲线
    function drawOne(fit, color) {
      var pts = [];
      for (var i = 0; i <= 150; i++) {
        var xv = xMin + (xMax - xMin) * (i / 150);
        var yv = psychFunc(xv, fit.alpha, fit.beta, fit.gamma || 0.25, fit.lambda || 0.02);
        pts.push({ x: toX1(xv), y: toY(yv) });
      }
      var smooth = smoothToBezier(pts, 0.3);
      ctx.strokeStyle = color; ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (smooth.length > 0) {
        ctx.moveTo(smooth[0].x, smooth[0].y);
        smooth.forEach(function(p) {
          if (p.cp1x) ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cp2x, p.cp2y, p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
      }
      ctx.stroke();
    }

    drawOne(fitSingle, '#6b7280');
    drawOne(fitDual, '#7c3aed');

    // 坐标轴
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(leftX, mg.top); ctx.lineTo(leftX, mg.top + pH); ctx.lineTo(rightX, mg.top + pH); ctx.stroke();

    // 右侧 Grid：阈值柱状图
    var barLeft = rightX + 30;
    var barRight = barLeft + gridW - 30;
    var barW = (barRight - barLeft) / 3;

    var singleThresh = fitSingle.threshold || -4.5;
    var dualThresh = fitDual.threshold || -2.4;
    var cost = opts.cost || Math.abs(singleThresh - dualThresh);

    var barMin = Math.min(singleThresh, dualThresh) - 1;
    var barMax = 0;
    function toBarY(v) { return mg.top + pH - (v - barMin) / (barMax - barMin) * pH; }

    // Single 柱子
    ctx.fillStyle = 'rgba(107, 114, 128, 0.6)';
    ctx.fillRect(barLeft + barW * 0.5, toBarY(singleThresh), barW * 0.8, mg.top + pH - toBarY(singleThresh));
    ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 1.5;
    ctx.strokeRect(barLeft + barW * 0.5, toBarY(singleThresh), barW * 0.8, mg.top + pH - toBarY(singleThresh));

    ctx.fillStyle = '#374151'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Single', barLeft + barW * 0.9, mg.top + pH + 16);
    ctx.fillText(singleThresh.toFixed(1), barLeft + barW * 0.9, toBarY(singleThresh) - 6);

    // Dual 柱子
    ctx.fillStyle = 'rgba(124, 58, 237, 0.6)';
    ctx.fillRect(barLeft + barW * 1.8, toBarY(dualThresh), barW * 0.8, mg.top + pH - toBarY(dualThresh));
    ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.5;
    ctx.strokeRect(barLeft + barW * 1.8, toBarY(dualThresh), barW * 0.8, mg.top + pH - toBarY(dualThresh));

    ctx.fillText('Dual', barLeft + barW * 2.2, mg.top + pH + 16);
    ctx.fillText(dualThresh.toFixed(1), barLeft + barW * 2.2, toBarY(dualThresh) - 6);

    // 大括号 + 成本标签
    var braceX = barLeft + barW * 2.6 + 10;
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(braceX, toBarY(singleThresh));
    ctx.lineTo(braceX + 15, toBarY(singleThresh));
    ctx.lineTo(braceX + 15, toBarY(dualThresh));
    ctx.lineTo(braceX, toBarY(dualThresh));
    ctx.stroke();

    ctx.fillStyle = '#ef4444'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('Interference Cost: +' + cost.toFixed(1) + ' dB', braceX + 20, (toBarY(singleThresh) + toBarY(dualThresh)) / 2 + 4);

    // 图例（左侧）
    var legX = leftX + 10, legY = mg.top + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(legX, legY, 120, 36);
    ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1; ctx.strokeRect(legX, legY, 120, 36);
    ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(legX + 8, legY + 12); ctx.lineTo(legX + 28, legY + 12); ctx.stroke();
    ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('单任务', legX + 34, legY + 16);
    ctx.strokeStyle = '#7c3aed';
    ctx.beginPath(); ctx.moveTo(legX + 8, legY + 26); ctx.lineTo(legX + 28, legY + 26); ctx.stroke();
    ctx.fillText('双任务', legX + 34, legY + 30);

    // 标题
    ctx.fillStyle = '#111827'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(opts.title || '干扰抑制成本', mg.left + (W - mg.left) / 2, 20);
  }

  return {
    drawTrendLine: drawTrendLine,
    drawHeatmap: drawHeatmap,
    drawAreaChart: drawAreaChart,
    drawPsychometric: drawPsychometric,
    drawDualPsychometric: drawDualPsychometric,
    drawIntegrationWindow: drawIntegrationWindow,
    drawInterferenceCost: drawInterferenceCost
  };
})();
