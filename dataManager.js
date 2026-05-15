/**
 * 数据管理模块
 * 负责：数据记录、存储、导出（JSON/CSV）、历史记录查看
 * 升级版：支持按被试折叠、复选框批量操作、上传到服务器
 * 数据来源：优先服务端 /api/data，回退 localStorage
 */

const DataManager = (function () {
  'use strict';

  const STORAGE_KEY = 'audioVisualTrainingData';
  const UPLOAD_SERVER_URL = ''; // 留空则自动检测（ngrok 或 localhost）

  /* ==================================================================
     数据读取：优先从服务端 API，失败则回退 localStorage
     ================================================================== */

  /**
   * 从服务端 /api/data 获取数据，成功后缓存到 localStorage
   * @returns {Promise<Array|null>}
   */
  async function fetchFromServer() {
    try {
      const base = getUploadURL();
      const resp = await fetch(`${base}/api/data`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (Array.isArray(data)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return data;
      }
      throw new Error('Invalid data format');
    } catch (e) {
      console.warn('[DataManager] 服务端读取失败，使用本地缓存:', e.message);
      return null;
    }
  }

  /**
   * 获取所有数据：优先服务端（异步），回退 localStorage（同步）
   * 注意：history.html 初始化时应先调用 loadData()，再调用 generateHistoryHTML()
   * @returns {Array}
   */
  function getAllData() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  /**
   * 异步加载数据（供页面初始化调用）
   * @returns {Promise<Array>}
   */
  async function loadData() {
    const serverData = await fetchFromServer();
    if (serverData) return serverData;
    return getAllData();
  }

  /* ==================================================================
     基础 CRUD
     ================================================================== */

  function saveExperimentData(metadata, results) {
    // 尝试从全局 STATE 获取性别和年龄信息
    let gender = '';
    let age = '';
    try {
      if (typeof STATE !== 'undefined') {
        gender = STATE.gender || '';
        age = STATE.age || '';
      }
    } catch (e) {
      console.warn('[DataManager] 无法读取 STATE 中的性别/年龄信息', e);
    }

    const data = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      metadata: {
        subjectId: metadata.subjectId || 'S001',
        gender: gender,
        age: age,
        date: metadata.date || formatDate(),
        phase: metadata.phase || 'train',
        func: metadata.func || 1,
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

    // 先写 localStorage
    const allData = getAllData();
    allData.push(data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));

    // 尝试同步到服务端（静默失败）
    syncToServer(data);

    UIHelper.showNotification('数据已保存', 'success');
    return data.id;
  }

  /**
   * 将数据同步到服务端（静默失败，不阻塞主流程）
   */
  function syncToServer(record) {
    try {
      const base = getUploadURL();
      fetch(`${base}/api/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      }).catch(() => {});
    } catch (e) {
      // 静默失败
    }
  }

  function getDataBySubject(subjectId) {
    return getAllData().filter(d => d.metadata.subjectId === subjectId);
  }

  function getDataBySubjectAndFunc(subjectId, func) {
    return getAllData().filter(d =>
      d.metadata.subjectId === subjectId && d.metadata.func === func
    );
  }

  function deleteData(id) {
    const allData = getAllData();
    const filtered = allData.filter(d => d.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    UIHelper.showNotification('数据已删除', 'success');
  }

  function clearAllData() {
    localStorage.removeItem(STORAGE_KEY);
    UIHelper.showNotification('所有数据已清空', 'warning');
  }

  /* ==================================================================
     导出（JSON / CSV）
     ================================================================== */

  function exportToJSON(subjectId = null) {
    const data = subjectId ? getDataBySubject(subjectId) : getAllData();
    if (data.length === 0) { UIHelper.showNotification('没有数据可导出', 'warning'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const dateStr = new Date().toISOString().split('T')[0];
    const exportName = subjectId ? `${subjectId}_data_${dateStr}` : `all_data_${dateStr}`;
    downloadBlob(blob, `${exportName}.json`);
    UIHelper.showNotification('JSON文件已导出', 'success');
  }

  function exportToCSV(subjectId = null, func = null) {
    let data = subjectId ? getDataBySubject(subjectId) : getAllData();
    if (func) data = data.filter(d => d.metadata.func === func);
    if (data.length === 0) { UIHelper.showNotification('没有数据可导出', 'warning'); return; }

    const headers = ['subjectId', 'date', 'phase', 'func', 'trial', 'snr', 'blur', 'soa', 'att', 'correct', 'rt', 'choice', 'timestamp'];
    let csv = headers.join(',') + '\n';
    data.forEach(d => {
      d.results.forEach(r => {
        csv += [
          d.metadata.subjectId, d.metadata.date, d.metadata.phase, d.metadata.func,
          r.trial, r.snr, r.blur, r.soa, r.attention, r.correct ? 'TRUE' : 'FALSE',
          r.rt, r.choice, r.timestamp
        ].join(',') + '\n';
      });
    });

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const dateStr = new Date().toISOString().split('T')[0];
    const exportNameCSV = subjectId ? `${subjectId}_${func || 'all'}_${dateStr}` : `all_data_${dateStr}`;
    downloadBlob(blob, `${exportNameCSV}.csv`);
    UIHelper.showNotification('CSV文件已导出', 'success');
  }

  /**
   * 导出被试信息 CSV
   * 每行一个被试，包含：编号、性别、年龄、各功能各阶段的 gold metrics（阈值）
   */
  function exportSubjectInfoCSV() {
    const allData = getAllData();
    if (allData.length === 0) {
      UIHelper.showNotification('没有数据可导出', 'warning');
      return;
    }

    // 按被试分组，收集每个被试的各阶段、各功能的 gold metrics（threshold）
    const subjectMap = {};
    allData.forEach(d => {
      const sid = d.metadata.subjectId;
      const gender = d.metadata.gender || '';
      const age = d.metadata.age || '';
      if (!subjectMap[sid]) {
        subjectMap[sid] = { subjectId: sid, gender, age, records: [] };
      }
      // 如果有新的性别/年龄信息，更新
      if (gender && !subjectMap[sid].gender) subjectMap[sid].gender = gender;
      if (age && !subjectMap[sid].age) subjectMap[sid].age = age;
      subjectMap[sid].records.push(d);
    });

    // CSV 表头
    // 固定列：编号、性别、年龄
    // 动态列：每个 (phase, func) 组合的 threshold
    const phases = ['pre', 'train', 'post'];
    const funcs = [1, 2, 3, 4];
    const funcNames = { 1: '功能一', 2: '功能二', 3: '功能三', 4: '功能四' };
    const phaseNames = { pre: '训练前', train: '训练中', post: '训练后' };

    let headers = ['编号', '性别', '年龄'];
    phases.forEach(p => {
      funcs.forEach(f => {
        headers.push(`${phaseNames[p]}_${funcNames[f]}_阈值`);
      });
    });

    let csv = headers.join(',') + '\n';

    Object.keys(subjectMap).sort().forEach(sid => {
      const subj = subjectMap[sid];
      const genderText = subj.gender === 'male' ? '男' : (subj.gender === 'female' ? '女' : subj.gender || '');
      const row = [sid, genderText, subj.age || ''];
      phases.forEach(p => {
        funcs.forEach(f => {
          const rec = subj.records.find(r => r.metadata.phase === p && r.metadata.func === f);
          row.push(rec && rec.metadata.threshold !== null ? rec.metadata.threshold.toFixed(2) : '');
        });
      });
      csv += row.join(',') + '\n';
    });

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const dateStr = new Date().toISOString().split('T')[0];
    downloadBlob(blob, `被试信息_${dateStr}.csv`);
    UIHelper.showNotification('被试信息CSV已导出', 'success');
  }

  /* ==================================================================
     生成历史记录 HTML（折叠 + 复选框 + 性别年龄显示）
     ================================================================== */

  function generateHistoryHTML() {
    const allData = getAllData();
    if (allData.length === 0) {
      return '<div class="text-center py-8 text-gray-400">暂无历史记录</div>';
    }

    // 按被试分组
    const grouped = {};
    allData.forEach(d => {
      const sid = d.metadata.subjectId;
      if (!grouped[sid]) grouped[sid] = [];
      grouped[sid].push(d);
    });

    let html = '';

    Object.keys(grouped).sort().forEach(subjectId => {
      const records = grouped[subjectId];
      const subjectCbId = `cb_subject_${subjectId}`;
      const recordsDivId = `records_${subjectId}`;

      // 从该被试的第一条记录中获取性别和年龄信息
      const firstRecord = records[0] || {};
      const metadata = firstRecord.metadata || {};
      const genderText = metadata.gender === 'male' ? '男' : (metadata.gender === 'female' ? '女' : '');
      const ageText = metadata.age || '';
      const quickInfo = (genderText || ageText) ? ` (${[genderText, ageText ? ageText + '岁' : ''].filter(Boolean).join(', ')})` : '';

      html += `
        <div class="mb-4 border rounded-xl bg-white shadow-sm">
          <!-- 被试头部（可点击折叠） -->
          <div class="flex items-center justify-between p-4 bg-gray-50 rounded-t-xl cursor-pointer select-none"
               onclick="DataManager.toggleCollapse('${subjectId}')">
            <div class="flex items-center gap-3" onclick="event.stopPropagation()">
              <input type="checkbox" id="${subjectCbId}"
                     onchange="DataManager.onSubjectCheckboxChange('${subjectId}')"
                     class="w-5 h-5 cursor-pointer">
              <span class="font-bold text-lg text-gray-800">${subjectId}${quickInfo}</span>
              <span class="text-sm text-gray-400">（${records.length} 条记录）</span>
            </div>
            <div class="flex items-center gap-2" onclick="event.stopPropagation()">
              <span id="arrow_${subjectId}" class="text-gray-500 text-sm">▼</span>
            </div>
          </div>

          <!-- 该被试的记录表格（可折叠） -->
          <div id="${recordsDivId}" class="p-4">
            <table class="w-full text-sm">
              <thead class="bg-gray-100">
                <tr>
                  <th class="p-2 text-left"><input type="checkbox" id="cb_head_${subjectId}"
                         onchange="DataManager.onHeadCheckboxChange('${subjectId}')"
                         class="w-4 h-4 cursor-pointer"></th>
                  <th class="p-2 text-left">日期</th>
                  <th class="p-2 text-left">阶段</th>
                  <th class="p-2 text-left">功能</th>
                  <th class="p-2 text-left">试次数</th>
                  <th class="p-2 text-left">正确率</th>
                  <th class="p-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
      `;

      records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).forEach(d => {
        const phaseNames = { pre: '训练前', train: '训练阶段', post: '训练后' };
        const funcNames = { 1: '功能一', 2: '功能二', 3: '功能三', 4: '功能四' };
        const cbId = `cb_record_${d.id}`;

        html += `
          <tr class="border-t hover:bg-gray-50">
            <td class="p-2">
              <input type="checkbox" id="${cbId}" data-id="${d.id}" data-subject="${subjectId}"
                     onchange="DataManager.onRecordCheckboxChange('${subjectId}')"
                     class="w-4 h-4 cursor-pointer record-cb">
            </td>
            <td class="p-2">${d.metadata.date}</td>
            <td class="p-2">${phaseNames[d.metadata.phase] || d.metadata.phase}</td>
            <td class="p-2">${funcNames[d.metadata.func] || d.metadata.func}</td>
            <td class="p-2">${d.metadata.totalTrials}</td>
            <td class="p-2">${d.metadata.accuracy}%</td>
            <td class="p-2">
              <button onclick="DataManager.viewDetail('${d.id}')"
                      class="text-blue-500 hover:underline mr-2 text-xs">查看</button>
              <button onclick="DataManager.deleteDataConfirm('${d.id}')"
                      class="text-red-500 hover:underline text-xs">删除</button>
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

  /* ==================================================================
     折叠 / 复选框逻辑
     ================================================================== */

  function toggleCollapse(subjectId) {
    const div = document.getElementById(`records_${subjectId}`);
    const arrow = document.getElementById(`arrow_${subjectId}`);
    if (!div) return;
    if (div.style.display === 'none') {
      div.style.display = '';
      if (arrow) arrow.textContent = '▼';
    } else {
      div.style.display = 'none';
      if (arrow) arrow.textContent = '▶';
    }
  }

  function onSubjectCheckboxChange(subjectId) {
    const subCb = document.getElementById(`cb_subject_${subjectId}`);
    const checked = subCb ? subCb.checked : false;
    const headCb = document.getElementById(`cb_head_${subjectId}`);
    if (headCb) headCb.checked = checked;
    const allData = getAllData();
    allData.forEach(d => {
      if (d.metadata.subjectId === subjectId) {
        const cb = document.getElementById(`cb_record_${d.id}`);
        if (cb) cb.checked = checked;
      }
    });
  }

  function onHeadCheckboxChange(subjectId) {
    const headCb = document.getElementById(`cb_head_${subjectId}`);
    const checked = headCb ? headCb.checked : false;
    const subCb = document.getElementById(`cb_subject_${subjectId}`);
    if (subCb) subCb.checked = checked;
    const allData = getAllData();
    allData.forEach(d => {
      if (d.metadata.subjectId === subjectId) {
        const cb = document.getElementById(`cb_record_${d.id}`);
        if (cb) cb.checked = checked;
      }
    });
  }

  function onRecordCheckboxChange(subjectId) {
    const allData = getAllData();
    const subjectRecords = allData.filter(d => d.metadata.subjectId === subjectId);
    const total = subjectRecords.length;
    let checkedCount = 0;
    subjectRecords.forEach(d => {
      const cb = document.getElementById(`cb_record_${d.id}`);
      if (cb && cb.checked) checkedCount++;
    });
    const subCb = document.getElementById(`cb_subject_${subjectId}`);
    const headCb = document.getElementById(`cb_head_${subjectId}`);
    if (subCb) subCb.checked = (checkedCount === total);
    if (headCb) headCb.checked = (checkedCount === total);
    if (subCb && checkedCount > 0 && checkedCount < total) subCb.indeterminate = true;
    if (headCb && checkedCount > 0 && checkedCount < total) headCb.indeterminate = true;
  }

  function selectAll() {
    const allData = getAllData();
    const btn = document.getElementById('btnSelectAll');
    const currentlyAllSelected = btn ? btn.dataset.all === 'true' : false;

    allData.forEach(d => {
      const cb = document.getElementById(`cb_record_${d.id}`);
      if (cb) cb.checked = !currentlyAllSelected;
      const subCb = document.getElementById(`cb_subject_${d.metadata.subjectId}`);
      if (subCb) subCb.checked = !currentlyAllSelected;
      const headCb = document.getElementById(`cb_head_${d.metadata.subjectId}`);
      if (headCb) headCb.checked = !currentlyAllSelected;
    });

    if (btn) {
      btn.dataset.all = !currentlyAllSelected ? 'true' : 'false';
      btn.textContent = !currentlyAllSelected ? '取消全选' : '全选';
    }
  }

  function invertSelection() {
    const allData = getAllData();
    allData.forEach(d => {
      const cb = document.getElementById(`cb_record_${d.id}`);
      if (cb) cb.checked = !cb.checked;
    });
    // 同步被试复选框
    const grouped = {};
    allData.forEach(d => {
      const sid = d.metadata.subjectId;
      if (!grouped[sid]) grouped[sid] = [];
      grouped[sid].push(d);
    });
    Object.keys(grouped).forEach(sid => {
      onRecordCheckboxChange(sid);
    });
  }

  function getSelectedIds() {
    const ids = [];
    const allData = getAllData();
    allData.forEach(d => {
      const cb = document.getElementById(`cb_record_${d.id}`);
      if (cb && cb.checked) ids.push(d.id);
    });
    return ids;
  }

  /* ==================================================================
     批量删除
     ================================================================== */

  function batchDelete() {
    const ids = getSelectedIds();
    if (ids.length === 0) {
      UIHelper.showNotification('请先选择要删除的记录', 'warning');
      return;
    }
    UIHelper.showConfirm(`确定要删除选中的 ${ids.length} 条记录吗？此操作不可撤销。`, () => {
      const allData = getAllData();
      const filtered = allData.filter(d => !ids.includes(d.id));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      UIHelper.showNotification(`已删除 ${ids.length} 条记录`, 'success');
      const hc = document.getElementById('historyContent');
      if (hc) hc.innerHTML = generateHistoryHTML();
    });
  }

  /* ==================================================================
     导出选中记录（支持 JSON 或 CSV 格式选择）
     ================================================================== */

  /**
   * 弹窗让用户选择导出格式（JSON 或 CSV）
   */
  function exportSelectedWithFormat() {
    const ids = getSelectedIds();
    if (ids.length === 0) {
      UIHelper.showNotification('请先选择要导出的记录', 'warning');
      return;
    }

    // 创建格式选择弹窗
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 max-w-sm w-full">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-gray-800">选择导出格式</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div class="space-y-3 mb-4">
          <button onclick="DataManager._doExportSelected('json'); this.closest('.fixed').remove();"
                  class="w-full p-3 bg-blue-50 hover:bg-blue-100 rounded-xl text-blue-700 font-medium text-left">
            📄 导出为 JSON<br>
            <span class="text-xs text-gray-500">完整数据，含所有字段和试次详情</span>
          </button>
          <button onclick="DataManager._doExportSelected('csv'); this.closest('.fixed').remove();"
                  class="w-full p-3 bg-green-50 hover:bg-green-100 rounded-xl text-green-700 font-medium text-left">
            📊 导出为 CSV<br>
            <span class="text-xs text-gray-500">试次级数据，适合 Excel 分析</span>
          </button>
        </div>
        <button onclick="this.closest('.fixed').remove()"
                class="w-full px-4 py-2 bg-gray-200 rounded-xl hover:bg-gray-300 text-sm">取消</button>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  /**
   * 执行选中记录的导出（内部方法）
   */
  function _doExportSelected(format) {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    const allData = getAllData();
    const selectedData = allData.filter(d => ids.includes(d.id));

    if (format === 'csv') {
      // 导出为 CSV
      const headers = ['subjectId', 'date', 'phase', 'func', 'trial', 'snr', 'blur', 'soa', 'att', 'correct', 'rt', 'choice', 'timestamp'];
      let csv = headers.join(',') + '\n';
      selectedData.forEach(d => {
        d.results.forEach(r => {
          csv += [
            d.metadata.subjectId, d.metadata.date, d.metadata.phase, d.metadata.func,
            r.trial, r.snr, r.blur, r.soa, r.attention, r.correct ? 'TRUE' : 'FALSE',
            r.rt, r.choice, r.timestamp
          ].join(',') + '\n';
        });
      });
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      downloadBlob(blob, `选中记录_${ids.length}条_${Date.now()}.csv`);
    } else {
      // 导出为 JSON
      const blob = new Blob([JSON.stringify(selectedData, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `选中记录_${ids.length}条_${Date.now()}.json`);
    }
    UIHelper.showNotification(`已导出 ${ids.length} 条记录（${format.toUpperCase()}）`, 'success');
  }

  /**
   * 导出选中的试次记录为JSON（供旧按钮兼容）
   */
  function exportSelectedToJSON() {
    exportSelectedWithFormat();
  }

  /* ==================================================================
     上传到服务器（支持 ngrok）
     ================================================================== */

  function setUploadURL(url) {
    DataManager._uploadURL = url;
  }

  function getUploadURL() {
    if (DataManager._uploadURL) return DataManager._uploadURL;
    return 'http://localhost:3000';
  }

  function uploadSelected() {
    const ids = getSelectedIds();
    if (ids.length === 0) {
      UIHelper.showNotification('请先选择要上传的记录', 'warning');
      return;
    }

    const allData = getAllData();
    const selectedData = allData.filter(d => ids.includes(d.id));
    const statusDiv = document.getElementById('uploadStatus');
    if (statusDiv) {
      statusDiv.className = 'mb-4 p-3 rounded-lg text-sm bg-blue-50 text-blue-700';
      statusDiv.textContent = `正在上传 ${ids.length} 条记录...`;
      statusDiv.classList.remove('hidden');
    }

    let uploaded = 0;
    let failed = 0;
    const total = selectedData.length;

    const uploadNext = (index) => {
      if (index >= total) {
        if (statusDiv) {
          statusDiv.className = 'mb-4 p-3 rounded-lg text-sm ' +
            (failed === 0 ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700');
          statusDiv.textContent = failed === 0
            ? `✅ 全部 ${total} 条记录上传成功！`
            : `⚠️ 上传完成：${uploaded} 成功，${failed} 失败`;
        }
        return;
      }

      const record = selectedData[index];
      const dateStr = (record.metadata.date && record.metadata.date.includes('T'))
        ? record.metadata.date.split('T')[0]
        : (record.metadata.date || new Date().toISOString().split('T')[0]);
      const fileName = `${record.metadata.subjectId}_${record.metadata.phase}_func${record.metadata.func}_${dateStr}.json`;
      const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });

      fetch(`${getUploadURL()}/upload/file?filename=${encodeURIComponent(fileName)}`, {
        method: 'POST',
        body: blob
      })
        .then(resp => {
          if (resp.ok) { uploaded++; } else { failed++; }
        })
        .catch(() => { failed++; })
        .finally(() => {
          if (statusDiv) {
            statusDiv.textContent = `上传进度：${uploaded + failed} / ${total}（成功 ${uploaded}，失败 ${failed}）`;
          }
          uploadNext(index + 1);
        });
    };

    uploadNext(0);
  }

  /* ==================================================================
     查看详情（弹窗）
     ================================================================== */

  function viewDetail(id) {
    const allData = getAllData();
    const data = allData.find(d => d.id === id);
    if (!data) { UIHelper.showNotification('数据不存在', 'error'); return; }

    const phaseNames = { pre: '训练前测试', train: '训练阶段', post: '训练后测试' };
    const funcNames = { 1: '功能一（抗干扰）', 2: '功能二（视觉整合）', 3: '功能三（异步校准）', 4: '功能四（注意定位）' };
    const func = data.metadata.func;

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

    const genderText = data.metadata.gender === 'male' ? '男' : (data.metadata.gender === 'female' ? '女' : (data.metadata.gender || '未设置'));
    const ageText = data.metadata.age ? ` | ${data.metadata.age}岁` : '';

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
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
            <div class="text-xs text-gray-400">${genderText}${ageText}</div>
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
            <div class="font-bold text-purple-600">${data.metadata.threshold !== null ? data.metadata.threshold.toFixed(2) + (func === 1 ? ' dB' : func === 3 ? ' ms' : '%') : '--'}</div>
          </div>
        </div>
        <div class="text-xs text-gray-500 mb-2">${phaseNames[data.metadata.phase] || data.metadata.phase} · ${data.metadata.date} · ${data.metadata.totalTrials}试次</div>
        ${tableHTML}
        <div class="mt-4 text-right">
          <button onclick="this.closest('.fixed').remove()" class="px-6 py-2 bg-gray-200 rounded-xl hover:bg-gray-300 text-sm">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  function deleteDataConfirm(id) {
    UIHelper.showConfirm('确定要删除这条记录吗？此操作不可撤销。', () => {
      deleteData(id);
      const hc = document.getElementById('historyContent');
      if (hc) hc.innerHTML = generateHistoryHTML();
    });
  }

  function exportBySubject(subjectId) {
    exportToJSON(subjectId);
    setTimeout(() => exportToCSV(subjectId), 500);
  }

  /* ==================================================================
     辅助函数
     ================================================================== */

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

  function formatDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function downloadToLocal(metadata, results, fitResult) {
    try {
      const phaseNames = { pre: 'pre', train: 'train', post: 'post' };
      const phase = phaseNames[metadata.phase] || metadata.phase;
      const func = metadata.func || 1;
      const subjectId = metadata.subjectId || 'S001';
      const date = metadata.date || formatDate();

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

  /* ==================================================================
     公共 API
     ================================================================== */
  return {
    saveExperimentData,
    getAllData,
    getDataBySubject,
    getDataBySubjectAndFunc,
    deleteData,
    clearAllData,
    exportToJSON,
    exportToCSV,
    exportSubjectInfoCSV,
    generateHistoryHTML,
    viewDetail,
    deleteDataConfirm,
    exportBySubject,
    downloadToLocal,
    // 新增
    toggleCollapse,
    onSubjectCheckboxChange,
    onHeadCheckboxChange,
    onRecordCheckboxChange,
    selectAll,
    invertSelection,
    batchDelete,
    exportSelectedWithFormat,
    exportSelectedToJSON,
    uploadSelected,
    setUploadURL,
    getUploadURL,
    loadData,
    _doExportSelected
  };
})();

