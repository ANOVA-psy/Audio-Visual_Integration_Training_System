/**
 * 结果分析页 ECharts 渲染模块
 * 对外暴露 ResultCharts.render(domId, func, data) → echartsInstance
 *
 * 图表规范（每张图都满足）：
 *   1. Y 轴正确率范围固定 [0, 1]
 *   2. S 型 / 倒 U 型曲线采用 200 点采样实现平滑拟合
 *   3. 心理物理基准正确率 criterion = 0.75，使用 markLine 虚线高亮
 */
const ResultCharts = (function () {
  'use strict';

  const CRITERION = 0.75;
  const SAMPLE_N  = 200;

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                            */
  /* ------------------------------------------------------------------ */

  // Logistic 心理物理函数：γ + (1 - γ - λ) / (1 + exp(-β(x-α)))
  function logistic(x, alpha, beta, gamma, lambda) {
    return gamma + (1 - gamma - lambda) / (1 + Math.exp(-beta * (x - alpha)));
  }

  // 在 [xMin, xMax] 取 SAMPLE_N 个点拟合曲线
  function sampleCurve(fit, xMin, xMax) {
    const gamma  = (fit.gamma  != null) ? fit.gamma  : 0.25;
    const lambda = (fit.lambda != null) ? fit.lambda : 0.02;
    const beta   = (fit.beta   != null) ? fit.beta   : 1;
    const alpha  = (fit.alpha  != null) ? fit.alpha  : 0;
    const out = [];
    const step = (xMax - xMin) / (SAMPLE_N - 1);
    for (let i = 0; i < SAMPLE_N; i++) {
      const x = xMin + step * i;
      let y = logistic(x, alpha, beta, gamma, lambda);
      if (!isFinite(y)) y = 0;
      out.push([x, Math.max(0, Math.min(1, y))]);
    }
    return out;
  }

  // 倒 U 型时窗曲线：用高斯分布近似
  // 假定 fit.data 是 [{x, k, n}]，先求归一化正确率
  function sampleInvertedU(fitData, xMin, xMax) {
    // 拟合一个高斯：μ = 最大点位置，σ 由半高宽估计
    const pts = fitData.map(d => ({
      x: d.x,
      y: d.n > 0 ? d.k / d.n : 0
    }));
    if (pts.length === 0) return [];

    // 找峰
    let peak = pts[0];
    pts.forEach(p => { if (p.y > peak.y) peak = p; });
    const mu = peak.x;
    const A  = peak.y;

    // σ 估计：找正确率 >= A/2 的最远点距离峰的距离
    let sigma = 100;
    const half = A * 0.5;
    let maxDist = 0;
    pts.forEach(p => {
      if (p.y >= half) {
        const d = Math.abs(p.x - mu);
        if (d > maxDist) maxDist = d;
      }
    });
    if (maxDist > 0) sigma = maxDist / Math.sqrt(2 * Math.log(2)); // 半高全宽公式
    if (!isFinite(sigma) || sigma <= 0) sigma = 100;

    const out = [];
    const step = (xMax - xMin) / (SAMPLE_N - 1);
    for (let i = 0; i < SAMPLE_N; i++) {
      const x = xMin + step * i;
      const y = A * Math.exp(-((x - mu) * (x - mu)) / (2 * sigma * sigma));
      out.push([x, Math.max(0, Math.min(1, y))]);
    }
    return out;
  }

  // 通用 Y 轴定义
  function yAxisDef(name) {
    return {
      name: name || '正确率',
      min: 0,
      max: 1,
      interval: 0.25,
      axisLabel: { formatter: v => (v * 100).toFixed(0) + '%' },
      splitLine: { lineStyle: { color: '#eee' } }
    };
  }

  /* ------------------------------------------------------------------ */
  /* 图 1：功能一 噪音阈值拟合图                                          */
  /* ------------------------------------------------------------------ */
  function renderFunc1(dom, fit) {
    if (!fit || !fit.data) {
      dom.innerHTML = '<div class="text-center py-20 text-gray-400">无足够数据生成阈值拟合图</div>';
      return null;
    }
    const chart = echarts.init(dom);
    const xs = fit.data.map(d => d.x);
    const xMin = Math.min(...xs) - 1;
    const xMax = Math.max(...xs) + 1;
    const curve = sampleCurve(fit, xMin, xMax);

    // 散点：大小由 n 决定
    const scatter = fit.data.map(d => ({
      value: [d.x, d.y],
      symbolSize: Math.max(8, Math.min(28, Math.sqrt(d.n || 20) * 4))
    }));

    const threshold = (fit.threshold != null) ? +fit.threshold : null;
    const r2        = (fit.r2 != null) ? +fit.r2 : null;

    chart.setOption({
      title: {
        text: '功能一：噪音阈值拟合图',
        left: 'center',
        textStyle: { fontSize: 16 },
        subtext: r2 != null ? `R² = ${r2.toFixed(2)}` : '',
        subtextStyle: { color: '#3b82f6', fontWeight: 'bold' }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (p) => p.map(it => `${it.seriesName}<br/>SNR: ${it.value[0].toFixed(1)} dB<br/>正确率: ${(it.value[1]*100).toFixed(0)}%`).join('<br/>')
      },
      grid: { left: 60, right: 40, top: 80, bottom: 60 },
      xAxis: {
        type: 'value',
        name: 'SNR (dB)',
        nameLocation: 'middle',
        nameGap: 28,
        min: xMin,
        max: xMax
      },
      yAxis: yAxisDef('正确率'),
      series: [
        {
          name: '原始数据',
          type: 'scatter',
          data: scatter,
          itemStyle: { color: '#6366f1' },
          z: 3
        },
        {
          name: 'S 型拟合曲线',
          type: 'line',
          data: curve,
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#6366f1', width: 3 },
          z: 2,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#ef4444', type: 'dashed', width: 2 },
            label: { show: false },
            data: ([
              { yAxis: CRITERION, name: 'Criterion 0.75' },
              threshold != null ? { xAxis: threshold } : null,
              threshold != null ? {
                xAxis: threshold,
                label: {
                  show: true,
                  formatter: `Threshold: ${threshold.toFixed(1)} dB`,
                  position: 'insideEndTop',
                  color: '#dc2626',
                  fontWeight: 'bold',
                  backgroundColor: '#fef2f2',
                  padding: [4, 8],
                  borderRadius: 4
                }
              } : null
            ]).filter(Boolean)
          }
        }
      ]
    });
    return chart;
  }

  /* ------------------------------------------------------------------ */
  /* 图 2：功能二 视觉增益对比图                                          */
  /* ------------------------------------------------------------------ */
  function renderFunc2(dom, fit) {
    if (!fit || !fit.fitClear || !fit.fitBlur) {
      dom.innerHTML = '<div class="text-center py-20 text-gray-400">无足够数据生成视觉增益对比图</div>';
      return null;
    }
    const chart = echarts.init(dom);
    const allXs = [].concat(
      (fit.fitClear.data || []).map(d => d.x),
      (fit.fitBlur.data  || []).map(d => d.x)
    );
    const xMin = allXs.length ? Math.min(...allXs) - 1 : -10;
    const xMax = allXs.length ? Math.max(...allXs) + 1 : 5;
    const curveClear = sampleCurve(fit.fitClear, xMin, xMax);
    const curveBlur  = sampleCurve(fit.fitBlur,  xMin, xMax);
    const thrClear = fit.fitClear.threshold;
    const thrBlur  = fit.fitBlur.threshold;
    const gain     = (fit.gain != null) ? +fit.gain : (thrBlur != null && thrClear != null ? (thrBlur - thrClear) : null);

    const markLineData = [
      { yAxis: CRITERION, name: 'Criterion 0.75',
        lineStyle: { color: '#ef4444', type: 'dashed', width: 2 } }
    ];
    if (thrClear != null) markLineData.push({ xAxis: thrClear, lineStyle: { color: '#3b82f6', type: 'dashed' } });
    if (thrBlur  != null) markLineData.push({ xAxis: thrBlur,  lineStyle: { color: '#ef4444', type: 'dashed' } });

    // gain 双向箭头：在 (thrClear, 0.75) ↔ (thrBlur, 0.75)
    const gainArrow = (thrClear != null && thrBlur != null) ? [{
      type: 'line',
      shape: {}, // 由 coord 系统给
      style: { stroke: '#10b981', lineWidth: 3 }
    }] : [];

    chart.setOption({
      title: {
        text: '功能二：模糊度 / 视觉增益对比图',
        left: 'center',
        textStyle: { fontSize: 16 }
      },
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: { top: 30, data: ['清晰口型', '模糊口型', '原始 · 清晰', '原始 · 模糊'] },
      grid: { left: 60, right: 40, top: 80, bottom: 60 },
      xAxis: {
        type: 'value',
        name: 'SNR (dB)',
        nameLocation: 'middle',
        nameGap: 28,
        min: xMin,
        max: xMax
      },
      yAxis: yAxisDef('正确率'),
      series: [
        {
          name: '清晰口型', type: 'line', data: curveClear, smooth: true, showSymbol: false,
          lineStyle: { color: '#3b82f6', width: 3 },
          markLine: {
            silent: true, symbol: 'none', data: markLineData
          }
        },
        {
          name: '模糊口型', type: 'line', data: curveBlur, smooth: true, showSymbol: false,
          lineStyle: { color: '#ef4444', width: 3 }
        },
        {
          name: '原始 · 清晰', type: 'scatter',
          data: (fit.fitClear.data || []).map(d => [d.x, d.y]),
          itemStyle: { color: '#3b82f6' }, symbolSize: 10
        },
        {
          name: '原始 · 模糊', type: 'scatter',
          data: (fit.fitBlur.data || []).map(d => [d.x, d.y]),
          itemStyle: { color: '#ef4444' }, symbolSize: 10
        },
        // 用 markLine + markPoint 模拟带文字的横向箭头线段
        (thrClear != null && thrBlur != null && gain != null) ? {
          name: 'Visual Gain', type: 'line', data: [],
          markLine: {
            silent: true,
            symbol: ['arrow', 'arrow'],
            label: {
              show: true,
              formatter: `Visual Gain = ${gain.toFixed(1)} dB`,
              position: 'middle',
              color: '#065f46',
              backgroundColor: '#d1fae5',
              borderColor: '#10b981',
              borderWidth: 1,
              padding: [4, 8],
              borderRadius: 4,
              fontWeight: 'bold'
            },
            lineStyle: { color: '#10b981', width: 3, type: 'solid' },
            data: [[
              { coord: [thrClear, CRITERION], symbolSize: 12 },
              { coord: [thrBlur,  CRITERION], symbolSize: 12 }
            ]]
          }
        } : { name: '_', type: 'line', data: [] }
      ]
    });
    return chart;
  }

  /* ------------------------------------------------------------------ */
  /* 图 3：功能三 SOA 整合时窗图                                          */
  /* ------------------------------------------------------------------ */
  function renderFunc3(dom, fit) {
    if (!fit || !fit.fit || !fit.fit.data) {
      dom.innerHTML = '<div class="text-center py-20 text-gray-400">无足够数据生成 SOA 整合时窗图</div>';
      return null;
    }
    const chart = echarts.init(dom);
    const fitData = fit.fit.data;
    const xs = fitData.map(d => d.x);
    const xMin = Math.min(...xs, -300);
    const xMax = Math.max(...xs, 300);

    // 倒 U 曲线（高斯近似）
    const curve = sampleInvertedU(fitData, xMin, xMax);

    // 散点：n、k 转 y
    const scatter = fitData.map(d => ({
      value: [d.x, d.n > 0 ? d.k / d.n : 0],
      symbolSize: Math.max(8, Math.min(28, Math.sqrt(d.n || 20) * 4))
    }));

    const lower = fit.lowerSOA;
    const upper = fit.upperSOA;
    const windowW = fit.window;

    chart.setOption({
      title: {
        text: '功能三：SOA 多感官整合时窗',
        left: 'center',
        textStyle: { fontSize: 16 },
        subtext: '负值：视觉领先  ←  0  →  听觉领先（正值）',
        subtextStyle: { color: '#6b7280' }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (p) => p.map(it => `${it.seriesName}<br/>SOA: ${it.value[0].toFixed(0)} ms<br/>正确率: ${(it.value[1]*100).toFixed(0)}%`).join('<br/>')
      },
      grid: { left: 60, right: 40, top: 80, bottom: 70 },
      xAxis: {
        type: 'value',
        name: 'SOA (ms)',
        nameLocation: 'middle',
        nameGap: 30,
        min: xMin,
        max: xMax,
        axisLine: { onZero: false },
        splitLine: { show: true, lineStyle: { color: '#eee' } }
      },
      yAxis: yAxisDef('正确率'),
      series: [
        {
          name: '原始数据', type: 'scatter', data: scatter,
          itemStyle: { color: '#f59e0b' }, z: 3
        },
        {
          name: '倒 U 型拟合', type: 'line', data: curve,
          smooth: true, showSymbol: false,
          lineStyle: { color: '#f59e0b', width: 3 },
          z: 2,
          markArea: (lower != null && upper != null) ? {
            silent: true,
            itemStyle: { color: 'rgba(128, 0, 128, 0.12)' },
            label: {
              show: true,
              position: 'top',
              formatter: windowW != null ? `整合时窗宽度: ${(+windowW).toFixed(0)} ms` : '整合时窗',
              color: '#7e22ce',
              fontWeight: 'bold',
              fontSize: 14
            },
            data: [[{ xAxis: lower }, { xAxis: upper }]]
          } : undefined,
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { color: '#ef4444', type: 'dashed', width: 2 },
            data: [
              { yAxis: CRITERION, name: 'Criterion 0.75' },
              { xAxis: 0, lineStyle: { color: '#9ca3af', type: 'solid', width: 1 } }
            ]
          }
        }
      ]
    });
    return chart;
  }

  /* ------------------------------------------------------------------ */
  /* 图 4：功能四 双人注意干扰抑制成本图（双 Grid）                        */
  /* ------------------------------------------------------------------ */
  function renderFunc4(dom, fit) {
    if (!fit || !fit.fitSingle || !fit.fitDual) {
      dom.innerHTML = '<div class="text-center py-20 text-gray-400">无足够数据生成干扰成本图</div>';
      return null;
    }
    const chart = echarts.init(dom);
    const allXs = [].concat(
      (fit.fitSingle.data || []).map(d => d.x),
      (fit.fitDual.data   || []).map(d => d.x)
    );
    const xMin = allXs.length ? Math.min(...allXs) - 1 : -8;
    const xMax = allXs.length ? Math.max(...allXs) + 1 : 2;
    const curveSingle = sampleCurve(fit.fitSingle, xMin, xMax);
    const curveDual   = sampleCurve(fit.fitDual,   xMin, xMax);

    const thrSingle = fit.singleThreshold != null ? +fit.singleThreshold : fit.fitSingle.threshold;
    const thrDual   = fit.dualThreshold   != null ? +fit.dualThreshold   : fit.fitDual.threshold;
    const cost      = fit.cost != null ? +fit.cost : (thrDual != null && thrSingle != null ? thrDual - thrSingle : null);

    chart.setOption({
      title: [
        { text: '功能四：双任务干扰抑制成本', left: 'center', textStyle: { fontSize: 16 } },
        { text: '心理物理拟合', left: '22%', top: 36, textStyle: { fontSize: 12, color: '#6b7280', fontWeight: 'normal' } },
        { text: '单 / 双任务阈值对比', left: '70%', top: 36, textStyle: { fontSize: 12, color: '#6b7280', fontWeight: 'normal' } }
      ],
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: { top: 30, data: ['单任务 (Single)', '双任务 (Dual)'] },
      grid: [
        { left: '6%',  right: '54%', top: 80, bottom: 60 },
        { left: '54%', right: '6%',  top: 80, bottom: 60 }
      ],
      xAxis: [
        {
          gridIndex: 0,
          type: 'value', name: 'SNR (dB)', nameLocation: 'middle', nameGap: 28,
          min: xMin, max: xMax
        },
        {
          gridIndex: 1,
          type: 'category',
          data: ['Single', 'Dual'],
          axisLabel: { fontSize: 14, fontWeight: 'bold' }
        }
      ],
      yAxis: [
        Object.assign({}, yAxisDef('正确率'), { gridIndex: 0 }),
        {
          gridIndex: 1, type: 'value', name: '阈值 (dB)',
          axisLabel: { formatter: v => v.toFixed(1) }
        }
      ],
      series: [
        // 左 grid：S 型曲线
        {
          name: '单任务 (Single)', type: 'line',
          xAxisIndex: 0, yAxisIndex: 0,
          data: curveSingle, smooth: true, showSymbol: false,
          lineStyle: { color: '#9ca3af', width: 3 },
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { color: '#ef4444', type: 'dashed', width: 2 },
            data: [{ yAxis: CRITERION, name: 'Criterion 0.75' }]
          }
        },
        {
          name: '双任务 (Dual)', type: 'line',
          xAxisIndex: 0, yAxisIndex: 0,
          data: curveDual, smooth: true, showSymbol: false,
          lineStyle: { color: '#a855f7', width: 3 }
        },
        {
          name: '_scatter_s', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0,
          data: (fit.fitSingle.data || []).map(d => [d.x, d.y]),
          itemStyle: { color: '#6b7280' }, symbolSize: 8
        },
        {
          name: '_scatter_d', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0,
          data: (fit.fitDual.data || []).map(d => [d.x, d.y]),
          itemStyle: { color: '#a855f7' }, symbolSize: 8
        },
        // 右 grid：柱状图
        {
          name: '_bar', type: 'bar',
          xAxisIndex: 1, yAxisIndex: 1,
          barWidth: '45%',
          data: [
            { value: thrSingle != null ? +thrSingle.toFixed(2) : 0, itemStyle: { color: '#9ca3af' } },
            { value: thrDual   != null ? +thrDual.toFixed(2)   : 0, itemStyle: { color: '#a855f7' } }
          ],
          label: {
            show: true, position: 'top',
            formatter: (p) => p.value.toFixed(1) + ' dB',
            fontWeight: 'bold'
          },
          markLine: (cost != null && thrSingle != null && thrDual != null) ? {
            silent: true,
            symbol: ['none','none'],
            lineStyle: { color: '#dc2626', width: 2 },
            label: {
              show: true,
              formatter: `Interference Cost: +${cost.toFixed(1)} dB`,
              position: 'middle',
              color: '#fff',
              backgroundColor: '#dc2626',
              borderRadius: 4,
              padding: [4, 10],
              fontWeight: 'bold'
            },
            data: [[
              { coord: ['Single', thrSingle] },
              { coord: ['Dual',   thrDual]   }
            ]]
          } : undefined
        }
      ]
    });
    return chart;
  }

  /* ------------------------------------------------------------------ */
  /* 总入口                                                              */
  /* ------------------------------------------------------------------ */
  function render(domId, func, data) {
    const dom = (typeof domId === 'string') ? document.getElementById(domId) : domId;
    if (!dom) return null;
    dom.innerHTML = ''; // 清空旧内容
    if (typeof echarts === 'undefined') {
      dom.innerHTML = '<div class="text-center py-20 text-red-400">ECharts 加载失败</div>';
      return null;
    }
    const fit = data.psychometricFit || {};
    switch (func) {
      case 1: return renderFunc1(dom, fit);
      case 2: return renderFunc2(dom, fit);
      case 3: return renderFunc3(dom, fit);
      case 4: return renderFunc4(dom, fit);
      default:
        dom.innerHTML = '<div class="text-center py-20 text-gray-400">不支持的功能编号</div>';
        return null;
    }
  }

  return { render };
})();
