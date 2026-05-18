/**
 * 数据管理模块
 * 负责：数据记录、存储、导出（JSON/CSV）、历史记录查看
 * 升级版：支持按被试折叠、复选框批量操作、上传到服务器
 */

const DataManager = (function () {
  'use strict';

  const STORAGE_KEY = 'audioVisualTrainingData';
  const UPLOAD_SERVER_URL = ''; // 留空则自动检测（ngrok 或 localhost）

  /* ==================================================================
     基础 CRUD
     ================================================================== */

  function saveExperimentData(metadata, results) {
    // 尝试从全局 STATE 获取性别和年龄信息
    let gender = '';
    let age = '';
    let currentAttempt = 1;
    try {
      if (typeof STATE !== 'undefined') {
        gender = STATE.gender || '';
        age = STATE.age || '';
        currentAttempt = STATE.currentAttempt || 1;
      }
    } catch (e) {
      console.warn('[DataManager] 无法读取 STATE 中的性别/年龄信息', e);
    }

    const allData = getAllData();

    // 生成 groupKey = subjectId_phase_func
    const groupKey = `${metadata.subjectId || 'S001'}_${(metadata.phase || 'train')}_func${metadata.func || 1}`;

    // 计算本次 attemptNumber：同组中已有的最大 attemptNumber + 1
    const sameGroup = allData.filter(d =>
      d.metadata && d.metadata.subjectId === (metadata.subjectId || 'S001') &&
      d.metadata.phase === (metadata.phase || 'train') &&
      d.metadata.func === (metadata.func || 1)
    );
    const maxAttempt = sameGroup.length > 0
      ? Math.max(...sameGroup.map(d => d.attemptNumber || 0))
      : 0;
    const attemptNumber = maxAttempt + 1;

    // 如果有旧的 active 记录，将其标记为 overwritten
    sameGroup.forEach(old => {
      if (old.status === 'active' || !old.status) {
        old.status = 'overwritten';
      }
    });

    const data = {
      id: generateId(),
      attemptNumber: attemptNumber,
      groupKey: groupKey,
      status: 'active',           // active | overwritten
      overwrittenBy: null,         // 覆盖它的新记录 ID
      previousAttemptId: null,      // 被它覆盖的旧记录 ID
      timestamp: new Date().toISOString(),
      metadata: {
        subjectId: metadata.subjectId || 'S001',
        gender: gender,
        age: age,
        date: metadata.date || formatDate(),
        phase: metadata.phase || 'train',
        func: metadata.func || 1,
        attemptNumber: attemptNumber,
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

    // 更新被覆盖记录的 overwrittenBy
    sameGroup.forEach(old => {
      if (old.status === 'overwritten') {
        old.overwrittenBy = data.id;
      }
    });

    allData.push(data);

    // 存储容量检查
    checkStorageQuota();

    localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));

    return data.id;
  }

  function getAllData() {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
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
    if (typeof UIHelper !== 'undefined') {
      UIHelper.showNotification('数据已删除', 'success');
    }
  }

  function clearAllData() {
    localStorage.removeItem(STORAGE_KEY);
    if (typeof UIHelper !== 'undefined') {
      UIHelper.showNotification('所有数据已清空', 'warning');
    }
  }

  /* ==================================================================
     导出（JSON / CSV）
     ================================================================== */

  function exportToJSON(subjectId = null) {
    const data = subjectId ? getDataBySubject(subjectId) : getAllData();
    if (data.length === 0) { 
      if (typeof UIHelper !== 'undefined') UIHelper.showNotification('没有数据可导出', 'warning'); 
      return; 
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const dateStr = new Date().toISOString().split('T')[0];
    const exportName = subjectId ? `${subjectId}_data_${dateStr}` : `all_data_${dateStr}`;
    downloadBlob(blob, `${exportName}.json`);
    if (typeof UIHelper !== 'undefined') UIHelper.showNotification('JSON文件已导出', 'success');
  }

  function exportToCSV(subjectId = null, func = null) {
    let data = subjectId ? getDataBySubject(subjectId) : getAllData();
    if (func) data = data.filter(d => d.metadata.func === func);
    if (data.length === 0) { 
      if (typeof UIHelper !== 'undefined') UIHelper.showNotification('没有数据可导出', 'warning'); 
      return; 
    }

    const headers = ['subjectId', 'date', 'phase', 'func', 'trial', 'snr', 'blur', 'soa', 'att', 'correct', 'rt', 'choice', 'timestamp'];
    let csv = headers.join(',') + '\n';
    data.forEach(d => {
      if (d.results && d.results.length > 0) {
        d.results.forEach(r => {
          csv += [
            d.metadata.subjectId, d.metadata.date, d.metadata.phase, d.metadata.func,
            r.trial, r.snr, r.blur, r.soa, r.attention, r.correct ? 'TRUE' : 'FALSE',
            r.rt, r.choice, r.timestamp
          ].join(',') + '\n';
        });
      }
    });

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const dateStr = new Date().toISOString().split('T')[0];
    const exportNameCSV = subjectId ? `${subjectId}_${func || 'all'}_${dateStr}` : `all_data_${dateStr}`;
    downloadBlob(blob, `${exportNameCSV}.csv`);
    if (typeof UIHelper !== 'undefined') UIHelper.showNotification('CSV文件已导出', 'success');
  }

  /* ==================================================================
     生成历史记录 HTML（折叠 + 复选框）
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
      let records = grouped[subjectId];
      // 按时间戳降序
      records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

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
                  <th class="p-2 text-left">Attempt</th>
                  <th class="p-2 text-left">日期</th>
                  <th class="p-2 text-left">阶段</th>
                  <th class="p-2 text-left">功能</th>
                  <th class="p-2 text-left">试次数</th>
                  <th class="p-2 text-left">正确率</th>
                  <th class="p-2 text-left">状态</th>
                  <th class="p-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
      `;

      records.forEach(d => {
        const phaseNames = { pre: '训练前', train: '训练阶段', post: '训练后' };
        const funcNames = { 1: '功能一', 2: '功能二', 3: '功能三', 4: '功能四' };
        const cbId = `cb_record_${d.id}`;
        const isActive = d.status === 'active' || !d.status;
        const statusBadge = isActive
          ? '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">当前</span>'
          : '<span class="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">已覆盖</span>';

        html += `
          <tr class="border-t hover:bg-gray-50">
            <td class="p-2">
              <input type="checkbox" id="${cbId}" data-id="${d.id}" data-subject="${subjectId}"
                     onchange="DataManager.onRecordCheckboxChange('${subjectId}')"
                     class="w-4 h-4 cursor-pointer record-cb">
            </td>
            <td class="p-2 font-mono">#${d.attemptNumber || 1}</td>
            <td class="p-2">${d.metadata.date}</td>
            <td class="p-2">${phaseNames[d.metadata.phase] || d.metadata.phase}</td>
            <td class="p-2">${funcNames[d.metadata.func] || d.metadata.func}</td>
            <td class="p-2">${d.metadata.totalTrials}</td>
            <td class="p-2">${d.metadata.accuracy}%</td>
            <td class="p-2">${statusBadge}</td>
            <td class="p-2">
              <button onclick="DataManager.viewDetail('${d.id}')"
                      class="text-blue-500 hover:underline mr-2 text-xs">查看</button>
              ${!isActive ? `<button onclick="DataManager.restoreAsCurrent('${d.id}')"
                      class="text-orange-500 hover:underline mr-2 text-xs">恢复为当前</button>` : ''}
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
      if (typeof UIHelper !== 'undefined') UIHelper.showNotification('请先选择要删除的记录', 'warning');
      return;
    }
    if (typeof UIHelper !== 'undefined') {
      UIHelper.showConfirm(`确定要删除选中的 ${ids.length} 条记录吗？此操作不可撤销。`, () => {
        const allData = getAllData();
        const filtered = allData.filter(d => !ids.includes(d.id));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        if (typeof UIHelper !== 'undefined') UIHelper.showNotification(`已删除 ${ids.length} 条记录`, 'success');
        // 刷新页面
        const hc = document.getElementById('historyContent');
        if (hc) hc.innerHTML = generateHistoryHTML();
      });
    }
  }

  /* ==================================================================
     批量下载（选择性下载）
     ================================================================== */

  function batchDownload() {
    const ids = getSelectedIds();
    if (ids.length === 0) {
      if (typeof UIHelper !== 'undefined') UIHelper.showNotification('请先选择要下载的记录', 'warning');
      return;
    }
    const allData = getAllData();
    const selectedData = allData.filter(d => ids.includes(d.id));
    const blob = new Blob([JSON.stringify(selectedData, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `selected_data_${ids.length}records_${Date.now()}.json`);
    if (typeof UIHelper !== 'undefined') UIHelper.showNotification(`已导出 ${ids.length} 条记录`, 'success');
  }

  function exportSelectedToJSON() {
    batchDownload();
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
      if (typeof UIHelper !== 'undefined') UIHelper.showNotification('请先选择要上传的记录', 'warning');
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
          if (resp.ok) {
            uploaded++;
          } else {
            failed++;
          }
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
     查看详情（跳转到结果分析页面）
     ================================================================== */

  function viewDetail(id) {
    // 跳转到 index.html 的结果页面，并传递记录 ID
    window.location.href = `index.html?viewResult=${id}`;
  }

  function deleteDataConfirm(id) {
    if (typeof UIHelper !== 'undefined') {
      UIHelper.showConfirm('确定要删除这条记录吗？此操作不可撤销。', () => {
        deleteData(id);
        const hc = document.getElementById('historyContent');
        if (hc) hc.innerHTML = generateHistoryHTML();
      });
    }
  }

  function exportBySubject(subjectId) {
    exportToJSON(subjectId);
    setTimeout(() => exportToCSV(subjectId), 500);
  }

  /* ==================================================================
     存储容量检查
     ================================================================== */

  function checkStorageQuota() {
    try {
      const data = localStorage.getItem(STORAGE_KEY) || '';
      const bytes = new Blob([data]).size;
      const mb = bytes / (1024 * 1024);
      if (mb > 3.6) { // 4MB 的 90%
        if (typeof UIHelper !== 'undefined') {
          UIHelper.showNotification(
            '⚠️ 本地存储已使用 ' + mb.toFixed(1) + 'MB（接近 4MB 上限），请及时导出数据',
            'warning',
            8000
          );
        }
      }
    } catch(e) { /* 忽略 */ }
  }

  /* ==================================================================
     恢复为当前版本
     ================================================================== */

  function restoreAsCurrent(recordId) {
    if (typeof UIHelper !== 'undefined') {
      UIHelper.showConfirm('确定要将此版本恢复为"当前"版本吗？当前版本将被标记为"已覆盖"。', () => {
        const allData = getAllData();
        const target = allData.find(d => d.id === recordId);
        if (!target) return;

        // 找到同组的 active 记录，标记为 overwritten
        allData.forEach(d => {
          if (d.groupKey === target.groupKey && (d.status === 'active' || !d.status)) {
            d.status = 'overwritten';
            d.overwrittenBy = recordId;
          }
        });

        // 恢复目标为 active
        target.status = 'active';
        target.overwrittenBy = null;

        localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
        if (typeof UIHelper !== 'undefined') UIHelper.showNotification('已恢复为当前版本', 'success');

        const hc = document.getElementById('historyContent');
        if (hc) hc.innerHTML = generateHistoryHTML();
      });
    }
  }

  /* ==================================================================
     服务器数据加载
     ================================================================== */

  async function loadData() {
    try {
      const base = getUploadURL();
      const resp = await fetch(`${base}/api/data`, { cache: 'no-cache' });
      if (resp.ok) {
        const serverData = await resp.json();
        if (Array.isArray(serverData) && serverData.length > 0) {
          const validServerData = serverData.filter(d => d && d.metadata && d.metadata.subjectId);
          if (validServerData.length > 0) {
            // 合并服务器数据和本地数据（服务器数据优先）
            const localData = getAllData();
            const mergedMap = new Map();

            // 先放本地数据
            localData.forEach(d => {
              if (d && d.id) mergedMap.set(d.id, d);
            });

            // 服务器数据覆盖本地（按 ID 合并）
            validServerData.forEach(d => {
              if (d && d.id) mergedMap.set(d.id, d);
            });

            const mergedData = Array.from(mergedMap.values());
            localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedData));
            console.log(`[DataManager] 已合并数据：本地 ${localData.length} 条，服务器 ${validServerData.length} 条，合并后 ${mergedData.length} 条`);
            return mergedData;
          }
        }
      }
    } catch (e) {
      console.warn('[DataManager] 服务器加载失败，使用本地数据', e);
    }
    const localData = getAllData();
    console.log(`[DataManager] 使用本地数据，共 ${localData.length} 条记录`);
    return localData;
  }

  /* ==================================================================
     加载历史记录结果（供查看）
     ================================================================== */
  function loadResultFromHistory(recordId) {
    const allData = getAllData();
    const record = allData.find(d => d.id === recordId);
    if (!record) {
      console.warn('[DataManager] 未找到记录:', recordId);
      return null;
    }
    return record;
  }

  /* ==================================================================
     导出被试信息 CSV
     ================================================================== */

  function exportSubjectInfoCSV() {
    const allData = getAllData();
    if (allData.length === 0) {
      if (typeof UIHelper !== 'undefined') UIHelper.showNotification('没有数据可导出', 'warning');
      return;
    }

    // 按被试聚合
    const subjects = {};
    allData.forEach(d => {
      const sid = d.metadata && d.metadata.subjectId ? d.metadata.subjectId : 'Unknown';
      if (!subjects[sid]) {
        subjects[sid] = {
          subjectId: sid,
          gender: (d.metadata && d.metadata.gender) || '',
          age: (d.metadata && d.metadata.age) || '',
          thresholds: {}  // key = "phase_func"
        };
      }
      const phase = d.metadata.phase || 'train';
      const func = d.metadata.func || 1;
      const key = `${phase}_func${func}`;
      // 只取 active 状态的阈值
      if (d.status === 'active' || !d.status) {
        if (d.metadata && d.metadata.threshold !== undefined && d.metadata.threshold !== null) {
          subjects[sid].thresholds[key] = d.metadata.threshold;
        }
      }
    });

    // CSV 表头
    const headers = ['subjectId', 'gender', 'age',
      'pre_func1', 'pre_func2', 'pre_func3', 'pre_func4',
      'train_func1', 'train_func2', 'train_func3', 'train_func4',
      'post_func1', 'post_func2', 'post_func3', 'post_func4'
    ];
    const genderMap = { male: '男', female: '女' };

    let csv = headers.join(',') + '\n';
    Object.values(subjects).forEach(s => {
      const row = [
        s.subjectId,
        genderMap[s.gender] || s.gender,
        s.age,
        s.thresholds['pre_func1'] != null ? s.thresholds['pre_func1'] : '',
        s.thresholds['pre_func2'] != null ? s.thresholds['pre_func2'] : '',
        s.thresholds['pre_func3'] != null ? s.thresholds['pre_func3'] : '',
        s.thresholds['pre_func4'] != null ? s.thresholds['pre_func4'] : '',
        s.thresholds['train_func1'] != null ? s.thresholds['train_func1'] : '',
        s.thresholds['train_func2'] != null ? s.thresholds['train_func2'] : '',
        s.thresholds['train_func3'] != null ? s.thresholds['train_func3'] : '',
        s.thresholds['train_func4'] != null ? s.thresholds['train_func4'] : '',
        s.thresholds['post_func1'] != null ? s.thresholds['post_func1'] : '',
        s.thresholds['post_func2'] != null ? s.thresholds['post_func2'] : '',
        s.thresholds['post_func3'] != null ? s.thresholds['post_func3'] : '',
        s.thresholds['post_func4'] != null ? s.thresholds['post_func4'] : ''
      ];
      csv += row.join(',') + '\n';
    });

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const dateStr = new Date().toISOString().split('T')[0];
    downloadBlob(blob, `subject_info_${dateStr}.csv`);
    if (typeof UIHelper !== 'undefined') UIHelper.showNotification('被试信息 CSV 已导出', 'success');
  }

  /* ==================================================================
     导出选中记录（格式选择弹窗）
     ================================================================== */

  function exportSelectedWithFormat() {
    const ids = getSelectedIds();
    if (ids.length === 0) {
      if (typeof UIHelper !== 'undefined') UIHelper.showNotification('请先选择要导出的记录', 'warning');
      return;
    }
    // 创建弹窗
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    overlay.id = 'exportFormatPopup';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 class="text-lg font-bold text-gray-800 mb-4">选择导出格式</h3>
        <p class="text-sm text-gray-500 mb-6">将导出 <span class="font-bold text-blue-600">${ids.length}</span> 条选中记录</p>
        <div class="flex flex-col gap-3">
          <button onclick="DataManager._doExportSelected('json')"
                  class="px-4 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors text-sm font-medium">
            📄 导出为 JSON
          </button>
          <button onclick="DataManager._doExportSelected('csv')"
                  class="px-4 py-3 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-colors text-sm font-medium">
            📊 导出为 CSV（试次明细）
          </button>
          <button onclick="document.getElementById('exportFormatPopup').remove()"
                  class="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition-colors text-sm">
            取消
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  function _doExportSelected(format) {
    // 关闭弹窗
    const popup = document.getElementById('exportFormatPopup');
    if (popup) popup.remove();

    const ids = getSelectedIds();
    if (ids.length === 0) return;
    const allData = getAllData();
    const selectedData = allData.filter(d => ids.includes(d.id));

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(selectedData, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `selected_${ids.length}records_${Date.now()}.json`);
      if (typeof UIHelper !== 'undefined') UIHelper.showNotification(`已导出 ${ids.length} 条记录（JSON）`, 'success');
    } else if (format === 'csv') {
      const headers = ['subjectId', 'date', 'phase', 'func', 'trial', 'snr', 'blur', 'soa', 'att', 'correct', 'rt', 'choice', 'timestamp'];
      let csv = headers.join(',') + '\n';
      selectedData.forEach(d => {
        if (d.results && d.results.length > 0) {
          d.results.forEach(r => {
            csv += [
              d.metadata.subjectId, d.metadata.date, d.metadata.phase, d.metadata.func,
              r.trial, r.snr, r.blur, r.soa, r.attention, r.correct ? 'TRUE' : 'FALSE',
              r.rt, r.choice, r.timestamp
            ].join(',') + '\n';
          });
        }
      });
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      downloadBlob(blob, `selected_${ids.length}records_${Date.now()}.csv`);
      if (typeof UIHelper !== 'undefined') UIHelper.showNotification(`已导出 ${ids.length} 条记录（CSV）`, 'success');
    }
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
    generateHistoryHTML,
    viewDetail,
    deleteDataConfirm,
    exportBySubject,
    toggleCollapse,
    onSubjectCheckboxChange,
    onHeadCheckboxChange,
    onRecordCheckboxChange,
    selectAll,
    batchDelete,
    batchDownload,
    exportSelectedToJSON,
    uploadSelected,
    setUploadURL,
    getUploadURL,
    restoreAsCurrent,
    checkStorageQuota,
    loadData,
    exportSubjectInfoCSV,
    exportSelectedWithFormat,
    _doExportSelected,

    // 加载历史记录结果供查看
    loadResultFromHistory
  };
})();
