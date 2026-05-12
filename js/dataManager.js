/**
 * 数据管理模块
 * 负责：数据记录、存储、导出（JSON/CSV）、历史记录查看
 */

const DataManager = (function() {
  'use strict';
  
  const STORAGE_KEY = 'audioVisualTrainingData';
  
  /**
   * 保存实验数据
   * @param {Object} metadata - 元数据（被试ID、阶段、功能等）
   * @param {Array} results - 试次结果数组
   * @returns {string} - 保存的唯一ID
   */
  function saveExperimentData(metadata, results) {
    const data = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      metadata: {
        subjectId: metadata.subjectId || 'S001',
        date: metadata.date || UIHelper.formatDate(),
        phase: metadata.phase || 'train', // pre/train/post
        func: metadata.func || 1, // 1-4
        snrMode: metadata.snrMode || 'adaptive',
        threshold: extractThresholdFromMetadata(metadata),
        totalTrials: results.length,
        accuracy: results.length > 0 ? 
          Math.round(results.filter(r => r.correct).length / results.length * 100) : 0,
        avgRT: results.filter(r => r.rt < 10000).length > 0 ?
          Math.round(results.filter(r => r.rt < 10000).reduce((a, b) => a + b.rt, 0) / 
          results.filter(r => r.rt < 10000).length) : 0
      },
      psychometricFit: metadata.fitResult || null,
      rawEventLog: metadata.eventLog || null,
      results: results
    };
    
    // 保存到localStorage
    const allData = getAllData();
    allData.push(data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
    
    UIHelper.showNotification('数据已保存', 'success');
    return data.id;
  }
  
  /**
   * 获取所有保存的数据
   * @returns {Array} - 所有实验数据
   */
  function getAllData() {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  }
  
  /**
   * 根据被试ID获取数据
   * @param {string} subjectId - 被试ID
   * @returns {Array} - 该被试的所有数据
   */
  function getDataBySubject(subjectId) {
    const allData = getAllData();
    return allData.filter(d => d.metadata.subjectId === subjectId);
  }
  
  /**
   * 根据被试ID和功能模块获取数据
   * @param {string} subjectId - 被测ID
   * @param {number} func - 功能模块（1-4）
   * @returns {Array} - 符合条件的数据
   */
  function getDataBySubjectAndFunc(subjectId, func) {
    const allData = getAllData();
    return allData.filter(d => 
      d.metadata.subjectId === subjectId && d.metadata.func === func
    );
  }
  
  /**
   * 删除数据
   * @param {string} id - 数据ID
   */
  function deleteData(id) {
    const allData = getAllData();
    const filtered = allData.filter(d => d.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    UIHelper.showNotification('数据已删除', 'success');
  }
  
  /**
   * 清空所有数据
   */
  function clearAllData() {
    localStorage.removeItem(STORAGE_KEY);
    UIHelper.showNotification('所有数据已清空', 'warning');
  }
  
  /**
   * 导出数据为JSON文件
   * @param {string} subjectId - 被测ID（可选，不提供则导出所有）
   */
  function exportToJSON(subjectId = null) {
    const data = subjectId ? getDataBySubject(subjectId) : getAllData();
    
    if (data.length === 0) {
      UIHelper.showNotification('没有数据可导出', 'warning');
      return;
    }
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `training_data_${subjectId || 'all'}_${Date.now()}.json`);
    
    UIHelper.showNotification('JSON文件已导出', 'success');
  }
  
  /**
   * 导出数据为CSV文件
   * @param {string} subjectId - 被试ID（可选）
   * @param {number} func - 功能模块（可选）
   */
  function exportToCSV(subjectId = null, func = null) {
    let data = subjectId ? getDataBySubject(subjectId) : getAllData();
    
    if (func) {
      data = data.filter(d => d.metadata.func === func);
    }
    
    if (data.length === 0) {
      UIHelper.showNotification('没有数据可导出', 'warning');
      return;
    }
    
    // CSV表头
    const headers = ['subjectId', 'date', 'phase', 'func', 'trial', 'snr', 'blur', 'soa', 'att', 'correct', 'rt', 'choice', 'timestamp'];
    
    // 构建CSV内容
    let csv = headers.join(',') + '\n';
    
    data.forEach(d => {
      d.results.forEach(r => {
        const row = [
          d.metadata.subjectId,
          d.metadata.date,
          d.metadata.phase,
          d.metadata.func,
          r.trial,
          r.snr,
          r.blur,
          r.soa,
          r.att,
          r.correct ? 'TRUE' : 'FALSE',
          r.rt,
          r.choice,
          r.timestamp
        ];
        csv += row.join(',') + '\n';
      });
    });
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `training_data_${subjectId || 'all'}_${func || 'all'}_${Date.now()}.csv`);
    
    UIHelper.showNotification('CSV文件已导出', 'success');
  }
  
  /**
   * 生成历史记录HTML
   * @returns {string} - HTML字符串
   */
  function generateHistoryHTML() {
    const allData = getAllData();
    
    if (allData.length === 0) {
      return '<div class="text-center py-8 text-gray-400">暂无历史记录</div>';
    }
    
    // 按被试ID分组
    const grouped = {};
    allData.forEach(d => {
      const sid = d.metadata.subjectId;
      if (!grouped[sid]) grouped[sid] = [];
      grouped[sid].push(d);
    });
    
    let html = '';
    
    Object.keys(grouped).sort().forEach(subjectId => {
      const records = grouped[subjectId];
      
      html += `
        <div class="mb-6 p-4 bg-white rounded-xl shadow">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-bold text-lg text-gray-800">被试 ${subjectId}</h3>
            <button onclick="DataManager.exportBySubject('${subjectId}')" 
                    class="px-3 py-1 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">
              导出该被试数据
            </button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-100">
                <tr>
                  <th class="p-2 text-left">日期</th>
                  <th class="p-2 text-left">阶段</th>
                  <th class="p-2 text-left">功能</th>
                  <th class="p-2 text-left">试次数</th>
                  <th class="p-2 text-left">正确率</th>
                  <th class="p-2 text-left">阈值</th>
                  <th class="p-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
      `;
      
      records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).forEach(d => {
        const phaseNames = { pre: '训练前', train: '训练中', post: '训练后' };
        const funcNames = { 1: '功能一', 2: '功能二', 3: '功能三', 4: '功能四' };
        
        html += `
          <tr class="border-t">
            <td class="p-2">${d.metadata.date}</td>
            <td class="p-2">${phaseNames[d.metadata.phase] || d.metadata.phase}</td>
            <td class="p-2">${funcNames[d.metadata.func] || d.metadata.func}</td>
            <td class="p-2">${d.metadata.totalTrials}</td>
            <td class="p-2">${d.metadata.accuracy}%</td>
            <td class="p-2">${d.metadata.threshold !== null ? d.metadata.threshold.toFixed(1) + ' dB' : '--'}</td>
            <td class="p-2">
              <button onclick="DataManager.viewDetail('${d.id}')" 
                      class="text-blue-500 hover:underline mr-2">查看</button>
              <button onclick="DataManager.deleteDataConfirm('${d.id}')" 
                      class="text-red-500 hover:underline">删除</button>
            </td>
          </tr>
        `;
      });
      
      html += `
              </tbody>
            </table>
          </div>
        </div>
      `;
    });
    
    return html;
  }
  
  /**
   * 查看数据详情（弹窗展示试次详情 + 阈值）
   * @param {string} id - 数据ID
   */
  function viewDetail(id) {
    const allData = getAllData();
    const data = allData.find(d => d.id === id);
    
    if (!data) {
      UIHelper.showNotification('数据不存在', 'error');
      return;
    }
    
    const phaseNames = { pre: '训练前测试', train: '训练中', post: '训练后测试' };
    const funcNames = { 1: '功能一（抗干扰）', 2: '功能二（视觉整合）', 3: '功能三（异步校准）', 4: '功能四（注意定位）' };
    const func = data.metadata.func;
    
    // 构建详情弹窗
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
    modal.style.cssText = 'max-height: 100vh; overflow-y: auto;';
    
    // 试次表格
    let tableHTML = '';
    if (data.results && data.results.length > 0) {
      let headerHTML = '<th class="p-2 text-left text-xs">试次</th><th class="p-2 text-left text-xs">SNR</th>';
      if (func === 2 || func === 3) headerHTML += '<th class="p-2 text-left text-xs">模糊度</th>';
      if (func === 3) headerHTML += '<th class="p-2 text-left text-xs">SOA</th>';
      if (func === 4) headerHTML += '<th class="p-2 text-left text-xs">注意</th>';
      headerHTML += '<th class="p-2 text-left text-xs">结果</th><th class="p-2 text-left text-xs">RT</th>';
      
      let rowsHTML = '';
      data.results.forEach(r => {
        const badge = r.correct
          ? '<span class="px-1 py-0.5 bg-green-100 text-green-700 rounded text-xs">OK</span>'
          : '<span class="px-1 py-0.5 bg-red-100 text-red-600 rounded text-xs">X</span>';
        
        rowsHTML += `<tr class="border-t"><td class="p-1 text-xs">${r.trial}</td><td class="p-1 text-xs">${r.snr}</td>`;
        if (func === 2 || func === 3) rowsHTML += `<td class="p-1 text-xs">${r.blur || 0}%</td>`;
        if (func === 3) rowsHTML += `<td class="p-1 text-xs">${r.soa || 0}ms</td>`;
        if (func === 4) rowsHTML += `<td class="p-1 text-xs">${r.attention === 'dual' ? '双' : '单'}</td>`;
        rowsHTML += `<td class="p-1">${badge}</td><td class="p-1 text-xs">${r.rt < 10000 ? r.rt + 'ms' : '--'}</td></tr>`;
      });
      
      tableHTML = `
        <div class="overflow-x-auto max-h-48 mt-3">
          <table class="w-full text-xs">
            <thead class="bg-gray-100 sticky top-0"><tr>${headerHTML}</tr></thead>
            <tbody>${rowsHTML}</tbody>
          </table>
        </div>`;
    } else {
      tableHTML = '<div class="text-center text-gray-400 py-4">无试次数据</div>';
    }
    
    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-gray-800">📊 实验详情</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <div class="bg-blue-50 p-2 rounded-lg text-center">
            <div class="text-xs text-gray-500">被试</div>
            <div class="font-bold text-blue-600">${data.metadata.subjectId}</div>
          </div>
          <div class="bg-green-50 p-2 rounded-lg text-center">
            <div class="text-xs text-gray-500">${funcNames[func] || '功能' + func}</div>
            <div class="font-bold text-green-600">${data.metadata.accuracy}%</div>
          </div>
          <div class="bg-orange-50 p-2 rounded-lg text-center">
            <div class="text-xs text-gray-500">平均RT</div>
            <div class="font-bold text-orange-600">${data.metadata.avgRT}ms</div>
          </div>
          <div class="bg-purple-50 p-2 rounded-lg text-center">
            <div class="text-xs text-gray-500">阈值</div>
            <div class="font-bold text-purple-600">${data.metadata.threshold !== null ? data.metadata.threshold + (func === 1 ? ' dB' : func === 3 ? ' ms' : '%') : '--'}</div>
          </div>
        </div>
        
        <div class="text-xs text-gray-500 mb-2">${phaseNames[data.metadata.phase] || data.metadata.phase} · ${data.metadata.date} · ${data.metadata.totalTrials}试次</div>
        
        ${tableHTML}
        
        <div class="mt-4 text-right">
          <button onclick="this.closest('.fixed').remove()" class="px-6 py-2 bg-gray-200 rounded-xl hover:bg-gray-300 text-sm">关闭</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    // 点击背景关闭
    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.remove();
    });
  }
  
  /**
   * 删除数据确认（删除后立即刷新历史页面）
   * @param {string} id - 数据ID
   */
  function deleteDataConfirm(id) {
    UIHelper.showConfirm('确定要删除这条记录吗？此操作不可撤销。', () => {
      deleteData(id);
      // ★ 立即刷新历史记录页面
      if (typeof showHistory === 'function') {
        showHistory();
      }
    });
  }
  
  /**
   * 导出指定被试的数据
   * @param {string} subjectId - 被试ID
   */
  function exportBySubject(subjectId) {
    exportToJSON(subjectId);
    setTimeout(() => exportToCSV(subjectId), 500);
  }
  
  // 私有辅助函数
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  function extractThresholdFromMetadata(metadata) {
    if (!metadata) return null;
    if (metadata.threshold !== undefined && metadata.threshold !== null) {
      if (typeof metadata.threshold === 'number') return metadata.threshold;
    }
    return null;
  }
  
  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
  
  /**
   * 下载实验数据为JSON文件到本地（按被试ID/阶段/模块命名）
   * 文件名格式: data/{subjectId}/{phase}_func{N}_{date}.json
   * 
   * @param {Object} metadata - 元数据
   * @param {Array} results - 试次结果
   * @param {Object} fitResult - 心理物理拟合结果
   */
  function downloadToLocal(metadata, results, fitResult) {
    try {
      const phaseNames = { pre: 'pre', train: 'train', post: 'post' };
      const phase = phaseNames[metadata.phase] || metadata.phase;
      const func = metadata.func || 1;
      const subjectId = metadata.subjectId || 'S001';
      const date = metadata.date || formatDate();

      // 构建 JSON 数据
      const exportData = {
        experimentInfo: {
          subjectId: subjectId,
          phase: metadata.phase,
          func: func,
          funcName: ['', '抗干扰训练', '视觉整合训练', '异步校准训练', '注意定位训练'][func],
          date: date,
          timestamp: new Date().toISOString(),
          totalTrials: results.length,
          snrMode: metadata.snrMode
        },
        summary: {
          accuracy: metadata.accuracy,
          avgRT: metadata.avgRT,
          threshold: metadata.threshold
        },
        psychometricFit: fitResult ? {
          alpha: fitResult.alpha !== undefined ? parseFloat(fitResult.alpha.toFixed(4)) : undefined,
          beta: fitResult.beta !== undefined ? parseFloat(fitResult.beta.toFixed(4)) : undefined,
          gamma: fitResult.gamma || 0.25,
          lambda: fitResult.lambda || 0.02,
          threshold: fitResult.threshold !== undefined && fitResult.threshold !== null ? parseFloat(fitResult.threshold.toFixed(2)) : null,
          criterion: fitResult.criterion || 0.80,
          r2: fitResult.r2 !== undefined ? parseFloat(fitResult.r2.toFixed(4)) : undefined,
          nll: fitResult.nll
        } : null,
        rawEventLog: metadata.eventLog || null,
        trials: results
      };

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });

      // 文件名: data/{subjectId}/{phase}_func{N}_{date}.json
      const filename = `data/${subjectId}/${phase}_func${func}_${date}.json`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      console.log(`[DataManager] 文件已下载: ${filename}`);
    } catch (err) {
      console.error('[DataManager] 下载失败:', err);
    }
  }

  // 私有辅助函数
  function formatDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  // 公共API
  return {
    saveExperimentData,
    getAllData,
    getDataBySubject,
    getDataBySubjectAndFunc,
    deleteData,
    clearAllData,
    exportToJSON,
    exportToCSV,
    generateHistoryHTML,
    viewDetail,
    deleteDataConfirm,
    exportBySubject,
    downloadToLocal
  };
})();