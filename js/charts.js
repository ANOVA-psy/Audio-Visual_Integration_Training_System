/**
 * js/charts.js - 纯 Canvas 图表库
 * 所有图表使用原生 Canvas API 绘制，支持高清屏
 */

const Charts = (function() {
  'use strict';

  // ==================== 通用工具 ====================

  function setupCanvas(canvas, width, height) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return ctx;
  }

  // ==================== 1. 趋势折线图 ====================

  function drawTrendLine(canvas, data, opts) {
    opts = opts || {};
    const W = canvas.clientWidth || 600;
    const H = canvas.clientHeight || 280;
    const ctx = setupCanvas(canvas, W, H);
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

    var attempts = data.map(function(d) { return d.attempt; });
    var values = data.map(function(d) { return d.goldMetric; });
    var xMin = Math.min.apply(null, attempts) - 0.5;
    var xMax = Math.max.apply(null, attempts) + 0.5;
    var yMin = Math.min.apply(null, values) - 1;
    var yMax = Math.max.apply(null, values) + 1;

    function toX(x) { return mg.left + (x - xMin) / (xMax - xMin) * pW; }
    function toY(y) { return mg.top + pH - (y - yMin) / (yMax - yMin) * pH; }

    // 网格线
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (var y = Math.ceil(yMin); y <= Math.floor(yMax); y++) {
      ctx.beginPath();
      ctx.moveTo(mg.left, toY(y));
      ctx.lineTo(mg.left + pW, toY(y));
      ctx.stroke();
    }

    // 80% 参考线
    if (opts.thresholdLine !== undefined) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(mg.left, toY(opts.thresholdLine));
      ctx.lineTo(mg.left + pW, toY(opts.thresholdLine));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 数据点 + 连线
    ctx.strokeStyle = opts.lineColor || '#6366f1';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    data.forEach(function(d, i) {
      var x = toX(d.attempt);
      var y = toY(d.goldMetric);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 数据点圆圈
    data.forEach(function(d) {
      var x = toX(d.attempt);
      var y = toY(d.goldMetric);
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

    ctx.fillStyle = '#374151';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel || 'Attempt', W / 2, H - 8);
    ctx.save();
    ctx.translate(14, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel || 'Gold Metric', 0, 0);
    ctx.restore();
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(opts.title || '趋势图', W / 2, 18);
  }

  // ==================== 2. 热力图 ====================

  function drawHeatmap(canvas, data, opts) {
    opts = opts || {};
    const W = canvas.clientWidth || 600;
    const H = canvas.clientHeight || 400;
    const ctx = setupCanvas(canvas, W, H);
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

    var allVals = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        allVals.push(data.matrix[r][c]);
      }
    }
    var minVal = Math.min.apply(null, allVals);
    var maxVal = Math.max.apply(null, allVals);

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
    for (var r = 0; r < rows; r++) {
      var y = mg.top + r * cellH + cellH / 2;
      ctx.fillText(data.yLabels[r] || '', mg.left - 5, y);
    }

    // X 轴标签
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var c = 0; c < cols; c++) {
      var x = mg.left + c * cellW + cellW / 2;
      ctx.fillText(data.xLabels[c] || '', x, mg.top + pH + 8);
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
    const W = canvas.clientWidth || 600;
    const H = canvas.clientHeight || 280;
    const ctx = setupCanvas(canvas, W, H);
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
    var allY = data.single.y.concat(data.dual.y);
    var xMin = Math.min.apply(null, allX);
    var xMax = Math.max.apply(null, allX);
    var yMin = 0;
    var yMax = Math.max.apply(null, allY) * 1.1;

    function toX(x) { return mg.left + (x - xMin) / (xMax - xMin) * pW; }
    function toY(y) { return mg.top + pH - (y - yMin) / (yMax - yMin) * pH; }

    // 网格
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

    // 线条
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.single.x.forEach(function(x, i) {
      if (i === 0) ctx.moveTo(toX(x), toY(data.single.y[i]));
      else ctx.lineTo(toX(x), toY(data.single.y[i]));
    });
    ctx.stroke();

    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    data.dual.x.forEach(function(x, i) {
      if (i === 0) ctx.moveTo(toX(x), toY(data.dual.y[i]));
      else ctx.lineTo(toX(x), toY(data.dual.y[i]));
    });
    ctx.stroke();

    // 坐标轴
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mg.left, mg.top);
    ctx.lineTo(mg.left, mg.top + pH);
    ctx.lineTo(mg.left + pW, mg.top + pH);
    ctx.stroke();

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

  return {
    drawTrendLine: drawTrendLine,
    drawHeatmap: drawHeatmap,
    drawAreaChart: drawAreaChart
  };
})();
