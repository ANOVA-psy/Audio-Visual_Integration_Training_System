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

    const phase = metadata.phase || 'train';

    // 计算本次 attemptNumber：同组中已有的最大 attemptNumber + 1
    const sameGroup = allData.filter(d =>
      d.metadata && d.metadata.subjectId === (metadata.subjectId || 'S001') &&
      d.metadata.phase === phase &&
      d.metadata.func === (metadata.func || 1)
    );
    const maxAttempt = sameGroup.length > 0
      ? Math.max(...sameGroup.map(d => d.attemptNumber || 0))
      : 0;
    const attemptNumber = maxAttempt + 1;

    // 训练前/训练后：仅保留最新（旧的 active 标为 overwritten）
    // 训练中：保留所有次（按 attempt 顺序展示，不互相覆盖）
    if (phase === 'pre' || phase === 'post') {
      sameGroup.forEach(old => {
        if (old.status === 'active' || !old.status) {
          old.status = 'overwritten';
        }
      });
    }

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
        phase: phase,
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

    // 更新被覆盖记录的 overwrittenBy（仅 pre/post 才会有 overwritten）
    if (phase === 'pre' || phase === 'post') {
      sameGroup.forEach(old => {
        if (old.status === 'overwritten') {
          old.overwrittenBy = data.id;
        }
      });
    }

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
    const target = allData.find(d => d.id === id);
    const filtered = allData.filter(d => d.id !== id);

    // 训练中（train）阶段：删除后对同组其他记录按时间重新编号 attemptNumber
    if (target && target.metadata && target.metadata.phase === 'train') {
      const groupKey = target.groupKey;
      const sameGroup = filtered
        .filter(d => d.groupKey === groupKey)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      sameGroup.forEach((d, idx) => {
        const newAttempt = idx + 1;
        d.attemptNumber = newAttempt;
        if (d.metadata) d.metadata.attemptNumber = newAttempt;
      });
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    // ★ 同步删除服务器端记录（避免下次 loadData 时"复活"已删数据）
    deleteFromServer([id]).catch(e => console.warn('[DataManager] 服务器删除失败：', e));

    if (typeof UIHelper !== 'undefined') {
      UIHelper.showNotification('数据已删除', 'success');
    }
  }

  function clearAllData() {
    // 先收集 id（用于删除服务器端记录）
    const allData = getAllData();
    const ids = allData.map(d => d.id).filter(Boolean);
    localStorage.removeItem(STORAGE_KEY);
    // ★ 标记"用户已主动清空"，阻止 history.html 的 DOMContentLoaded 自动 loadData
    try { localStorage.setItem('historyClearedAt', String(Date.now())); } catch (e) {}
    // ★ 同步删除服务器端所有记录
    if (ids.length > 0) {
      deleteFromServer(ids).catch(e => console.warn('[DataManager] 服务器批量删除失败：', e));
    }
    if (typeof UIHelper !== 'undefined') {
      UIHelper.showNotification('所有数据已清空（本地 + 服务器）', 'warning');
    }
  }

  /**
   * 高层"清空全部记录"入口（含二次确认 + UI 自动刷新）
   * 含：本地 localStorage 清空 + 服务器 experiment_history.json 全删
   */
  function clearAllDataConfirm() {
    const allData = getAllData();
    const localCount = allData.length;
    const msg = localCount > 0
      ? `确定要彻底清空全部 ${localCount} 条本地记录及对应的服务器记录吗？\n\n此操作会：\n• 删除本地 localStorage 中所有记录\n• 删除服务器 experiment_history.json 中对应记录\n• 阻止下次刷新页面时自动从服务器恢复\n\n此操作不可撤销！`
      : '本地无记录。是否仍然清空服务器端 experiment_history.json？';

    const ok = (typeof UIHelper !== 'undefined' && UIHelper.showConfirm)
      ? null
      : window.confirm(msg);

    const doClear = async () => {
      // 1. 即使本地为空，也尝试拉一遍服务器数据后再删（确保废旧数据清理彻底）
      let serverIds = [];
      if (localCount === 0) {
        try {
          const base = getUploadURL();
          const resp = await fetch(`${base}/api/data`, { cache: 'no-cache' });
          if (resp.ok) {
            const serverData = await resp.json();
            if (Array.isArray(serverData)) {
              serverIds = serverData.map(d => d && d.id).filter(Boolean);
            }
          }
        } catch (e) {
          console.warn('[DataManager] 清空时拉取服务器列表失败：', e);
        }
      }
      const localIds = allData.map(d => d.id).filter(Boolean);
      const idsToDelete = Array.from(new Set([...localIds, ...serverIds]));

      // 2. 本地清空
      localStorage.removeItem(STORAGE_KEY);
      try { localStorage.setItem('historyClearedAt', String(Date.now())); } catch (e) {}

      // 3. 服务器删除
      if (idsToDelete.length > 0) {
        const result = await deleteFromServer(idsToDelete);
        if (typeof UIHelper !== 'undefined') {
          UIHelper.showNotification(
            `已清空：本地 ${localIds.length} 条 + 服务器 ${result.ok}/${idsToDelete.length} 条`,
            'warning'
          );
        }
      } else {
        if (typeof UIHelper !== 'undefined') UIHelper.showNotification('本地与服务器均无记录', 'info');
      }

      // 4. 刷新 UI
      const hc = document.getElementById('historyContent');
      if (hc) hc.innerHTML = generateHistoryHTML();
      if (typeof window.renderAllHistoryCharts === 'function') window.renderAllHistoryCharts();
      if (typeof window.updateStorageInfo === 'function') window.updateStorageInfo();
    };

    if (typeof UIHelper !== 'undefined' && UIHelper.showConfirm) {
      UIHelper.showConfirm(msg, doClear);
    } else if (ok) {
      doClear();
    }
  }


  /**
   * 调服务器 DELETE /api/data/:id 删除指定 ids 的服务器记录
   * 失败不抛出（仅 console.warn），以保证本地删除一定成功
   * @param {string[]} ids
   * @returns {Promise<{ok:number, fail:number}>}
   */
  async function deleteFromServer(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return { ok: 0, fail: 0 };
    const base = getUploadURL();
    let ok = 0, fail = 0;
    await Promise.all(ids.map(async id => {
      try {
        const resp = await fetch(`${base}/api/data/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (resp.ok) ok++;
        else fail++;
      } catch (e) {
        fail++;
      }
    }));
    console.log(`[DataManager] 服务器删除：${ok} 成功 / ${fail} 失败 / 共 ${ids.length}`);
    return { ok, fail };
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
        <div class="mb-4 border rounded-xl bg-white shadow-sm" data-subject="${subjectId}">
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
            <!-- 历史成绩折线图（4 个功能同图，百分制） -->
            <div class="mb-4">
              <div class="text-sm font-semibold text-gray-600 mb-2">📈 历史成绩趋势（按时间）</div>
              <div id="historyChart_${subjectId}" style="width:100%;height:300px;" class="border border-gray-100 rounded-lg bg-gray-50"></div>
              <div class="text-xs text-gray-400 mt-1">规则：训练前/后每功能仅显示最新一次；训练中按 #1、#2… 顺序展示。每次成绩按百分制显示（满分 100）。可在表格中切换"显示"。</div>
            </div>

            <table class="w-full text-sm">
              <thead class="bg-gray-100">
                <tr>
                  <th class="p-2 text-left"><input type="checkbox" id="cb_head_${subjectId}"
                         onchange="DataManager.onHeadCheckboxChange('${subjectId}')"
                         class="w-4 h-4 cursor-pointer"></th>
                  <th class="p-2 text-left">显示</th>
                  <th class="p-2 text-left">Attempt</th>
                  <th class="p-2 text-left">日期</th>
                  <th class="p-2 text-left">阶段</th>
                  <th class="p-2 text-left">功能</th>
                  <th class="p-2 text-left">试次数</th>
                  <th class="p-2 text-left">正确率</th>
                  <th class="p-2 text-left">得分</th>
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
          ? '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">显示中</span>'
          : '<span class="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">已覆盖</span>';

        // 得分（百分制）：使用 AdaptiveEngine 单项映射
        let scoreVal = '--';
        try {
          if (typeof AdaptiveEngine !== 'undefined' && AdaptiveEngine.scoreRecord) {
            const s = AdaptiveEngine.scoreRecord(d);
            if (typeof s === 'number') scoreVal = s + ' / 100';
          }
        } catch (e) {}

        html += `
          <tr class="border-t hover:bg-gray-50">
            <td class="p-2">
              <input type="checkbox" id="${cbId}" data-id="${d.id}" data-subject="${subjectId}"
                     onchange="DataManager.onRecordCheckboxChange('${subjectId}')"
                     class="w-4 h-4 cursor-pointer record-cb">
            </td>
            <td class="p-2">
              <input type="checkbox" ${isActive ? 'checked' : ''}
                     onchange="DataManager.toggleRecordVisibility('${d.id}')"
                     title="勾选则在折线图中显示，取消则标记为已覆盖"
                     class="w-4 h-4 cursor-pointer">
            </td>
            <td class="p-2 font-mono">#${d.attemptNumber || 1}</td>
            <td class="p-2">${d.metadata.date}</td>
            <td class="p-2">${phaseNames[d.metadata.phase] || d.metadata.phase}</td>
            <td class="p-2">${funcNames[d.metadata.func] || d.metadata.func}</td>
            <td class="p-2">${d.metadata.totalTrials}</td>
            <td class="p-2">${d.metadata.accuracy}%</td>
            <td class="p-2 font-mono text-xs">${scoreVal}</td>
            <td class="p-2">${statusBadge}</td>
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
      if (typeof UIHelper !== 'undefined') UIHelper.showNotification('请先选择要删除的记录', 'warning');
      return;
    }
    if (typeof UIHelper !== 'undefined') {
      UIHelper.showConfirm(`确定要删除选中的 ${ids.length} 条记录吗？此操作不可撤销（同时清除本地与服务器记录）。`, () => {
        const allData = getAllData();
        // 找出受影响的 train 组（含被删 id 的 train 阶段 groupKey 集合）
        const affectedTrainGroups = new Set();
        allData.forEach(d => {
          if (ids.includes(d.id) && d.metadata && d.metadata.phase === 'train') {
            affectedTrainGroups.add(d.groupKey);
          }
        });
        const filtered = allData.filter(d => !ids.includes(d.id));

        // 对受影响的 train 组重新编号
        affectedTrainGroups.forEach(gk => {
          const sameGroup = filtered
            .filter(d => d.groupKey === gk)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          sameGroup.forEach((d, idx) => {
            const newAttempt = idx + 1;
            d.attemptNumber = newAttempt;
            if (d.metadata) d.metadata.attemptNumber = newAttempt;
          });
        });

        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        // ★ 同步删除服务器端记录
        deleteFromServer(ids).catch(e => console.warn('[DataManager] 服务器批量删除失败：', e));
        // ★ 删完后若本地为空 → 设置"已清空"标记，阻止 DOMContentLoaded 重新拉取
        if (filtered.length === 0) {
          try { localStorage.setItem('historyClearedAt', String(Date.now())); } catch (e) {}
        }

        if (typeof UIHelper !== 'undefined') UIHelper.showNotification(`已删除 ${ids.length} 条记录（本地 + 服务器）`, 'success');
        // 刷新页面
        const hc = document.getElementById('historyContent');
        if (hc) hc.innerHTML = generateHistoryHTML();
        if (typeof window.renderAllHistoryCharts === 'function') window.renderAllHistoryCharts();
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
    // 跳转到 result.html 结果页面，并传递记录 ID
    window.location.href = `result.html?id=${id}`;
  }

  function deleteDataConfirm(id) {
    if (typeof UIHelper !== 'undefined') {
      UIHelper.showConfirm('确定要删除这条记录吗？此操作不可撤销。', () => {
        deleteData(id);
        const hc = document.getElementById('historyContent');
        if (hc) hc.innerHTML = generateHistoryHTML();
        if (typeof window.renderAllHistoryCharts === 'function') window.renderAllHistoryCharts();
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
        if (typeof window.renderAllHistoryCharts === 'function') window.renderAllHistoryCharts();
      });
    }
  }

  /**
   * 切换某条记录在历史折线图中的可见性
   * 通过翻转 status (active ↔ overwritten) 实现：
   *   - active     → 显示在折线图中
   *   - overwritten → 从折线图中隐藏
   * 不弹确认框，直接切换并重绘
   * @param {string} recordId
   */
  function toggleRecordVisibility(recordId) {
    const allData = getAllData();
    const target = allData.find(d => d.id === recordId);
    if (!target) return;

    if (target.status === 'overwritten') {
      // 想恢复显示：把同组所有 active 标记为 overwritten，再把自己设为 active
      allData.forEach(d => {
        if (d.groupKey === target.groupKey && (d.status === 'active' || !d.status)) {
          d.status = 'overwritten';
          d.overwrittenBy = recordId;
        }
      });
      target.status = 'active';
      target.overwrittenBy = null;
    } else {
      // 当前是 active → 标记为 overwritten 隐藏
      target.status = 'overwritten';
      target.overwrittenBy = null;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));

    const hc = document.getElementById('historyContent');
    if (hc) hc.innerHTML = generateHistoryHTML();
    if (typeof window.renderAllHistoryCharts === 'function') window.renderAllHistoryCharts();
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
     ------------------------------------------------------------------
     每行 = (subjectId, phase) 一个组合（共最多 3 行/被试：pre/train/post）
     列：
       基本信息：subjectId, gender, age, phase
       功能一（抗干扰）：    f1_threshold(dB), f1_score
       功能二（视觉整合）：  f2_threshold_clear(dB), f2_threshold_blur(dB), f2_gain(dB), f2_score
       功能三（异步校准）：  f3_lowerSOA(ms), f3_upperSOA(ms), f3_window(ms), f3_score
       功能四（注意定位）：  f4_singleThreshold(dB), f4_dualThreshold(dB), f4_cost(dB), f4_score
       综合 AVIS：         avis_auditory, avis_visual, avis_integration, avis_attention, avis_total
     ================================================================== */

  function exportSubjectInfoCSV() {
    const allData = getAllData();
    if (allData.length === 0) {
      if (typeof UIHelper !== 'undefined') UIHelper.showNotification('没有数据可导出', 'warning');
      return;
    }

    // 仅保留 active（或无 status）的记录作为代表性指标来源
    const activeData = allData.filter(d => d.status === 'active' || !d.status);

    // 取每个 (subject, phase, func) 最新一条记录（按时间戳降序）
    const groupMap = {};  // key = subjectId|phase|func → latest record
    activeData.forEach(d => {
      const sid   = (d.metadata && d.metadata.subjectId) || 'Unknown';
      const phase = (d.metadata && d.metadata.phase) || 'train';
      const func  = (d.metadata && d.metadata.func)  || 1;
      const key   = `${sid}|${phase}|${func}`;
      const ts    = new Date(d.timestamp || 0).getTime();
      if (!groupMap[key] || ts > groupMap[key]._ts) {
        groupMap[key] = Object.assign({}, d, { _ts: ts });
      }
    });

    // 聚合为 (subject, phase) 行，并把 4 个功能拼到一行
    const rowMap = {};  // key = subjectId|phase
    Object.values(groupMap).forEach(rec => {
      const sid   = rec.metadata.subjectId || 'Unknown';
      const phase = rec.metadata.phase || 'train';
      const func  = rec.metadata.func || 1;
      const rk    = `${sid}|${phase}`;
      if (!rowMap[rk]) {
        rowMap[rk] = {
          subjectId: sid,
          gender:    rec.metadata.gender || '',
          age:       rec.metadata.age || '',
          phase:     phase,
          // 各功能记录占位
          func1: null, func2: null, func3: null, func4: null
        };
      }
      rowMap[rk]['func' + func] = rec;
    });

    // 工具：安全数字格式化
    const fmt = (v, digits) => {
      if (v == null || !isFinite(v)) return '';
      return digits != null ? (+v).toFixed(digits) : (+v).toFixed(2);
    };
    // 工具：取 psychometricFit 优先；否则 metadata.threshold 兜底
    const getFit = r => (r && r.psychometricFit) ? r.psychometricFit : {};

    // 评分（依赖 AdaptiveEngine 暴露的全局对象）
    const hasScorer = (typeof AdaptiveEngine !== 'undefined');
    const scoreRec  = r => {
      if (!hasScorer || !r) return '';
      const s = AdaptiveEngine.scoreRecord(r);
      return (typeof s === 'number' && isFinite(s)) ? s : '';
    };

    // CSV 表头
    const headers = [
      'subjectId', 'gender', 'age', 'phase',
      'f1_threshold(dB)', 'f1_score',
      'f2_threshold_clear(dB)', 'f2_threshold_blur(dB)', 'f2_gain(dB)', 'f2_score',
      'f3_lowerSOA(ms)', 'f3_upperSOA(ms)', 'f3_window(ms)', 'f3_score',
      'f4_singleThreshold(dB)', 'f4_dualThreshold(dB)', 'f4_cost(dB)', 'f4_score',
      'avis_auditory', 'avis_visual', 'avis_integration', 'avis_attention', 'avis_total'
    ];
    const genderMap = { male: '男', female: '女' };
    const phaseMap  = { pre: '前测', train: '训练', post: '后测' };

    // 排序：subjectId 升序 → phase 顺序 (pre/train/post)
    const phaseOrder = { pre: 1, train: 2, post: 3 };
    const rows = Object.values(rowMap).sort((a, b) => {
      if (a.subjectId !== b.subjectId) return a.subjectId.localeCompare(b.subjectId);
      return (phaseOrder[a.phase] || 9) - (phaseOrder[b.phase] || 9);
    });

    // 拼装数据行
    let csv = headers.join(',') + '\n';
    rows.forEach(row => {
      const r1 = row.func1, r2 = row.func2, r3 = row.func3, r4 = row.func4;
      const f1 = getFit(r1), f2 = getFit(r2), f3 = getFit(r3), f4 = getFit(r4);

      // 功能一指标
      const f1Threshold = (f1.threshold != null) ? f1.threshold
                        : (r1 && r1.metadata && r1.metadata.threshold);
      // 功能二指标
      const f2ThClear = (f2.fitClear && f2.fitClear.threshold != null)
                        ? f2.fitClear.threshold : null;
      const f2ThBlur  = (f2.fitBlur && f2.fitBlur.threshold != null)
                        ? f2.fitBlur.threshold : null;
      const f2Gain    = (f2.gain != null) ? f2.gain
                        : (f2ThClear != null && f2ThBlur != null ? f2ThBlur - f2ThClear : null);
      // 功能三指标
      const f3Lower = (f3.lowerSOA != null) ? f3.lowerSOA : null;
      const f3Upper = (f3.upperSOA != null) ? f3.upperSOA : null;
      const f3Win   = (f3.window != null) ? f3.window
                      : (f3Lower != null && f3Upper != null ? f3Upper - f3Lower : null);
      // 功能四指标
      const f4Single = (f4.singleThreshold != null) ? f4.singleThreshold : null;
      const f4Dual   = (f4.dualThreshold != null) ? f4.dualThreshold
                       : (r4 && r4.metadata && r4.metadata.threshold);
      const f4Cost   = (f4.cost != null) ? f4.cost
                       : (f4Single != null && f4Dual != null ? f4Dual - f4Single : null);

      // 综合 AVIS（仅当 4 个功能都有数据时计算才有意义；否则按可用项算）
      let avis = { auditory: '', visual: '', integration: '', attention: '', total: '' };
      if (hasScorer) {
        const evalResults = {};
        if (f1.threshold != null || f1Threshold != null)
          evalResults.func1 = { threshold: (f1.threshold != null ? f1.threshold : f1Threshold) };
        if (f2Gain != null)
          evalResults.func2 = { fitClear: { threshold: f2ThClear }, gain: f2Gain };
        if (f3Win != null)
          evalResults.func3 = { lowerSOA: f3Lower, upperSOA: f3Upper, window: f3Win };
        if (f4Cost != null || f4Dual != null)
          evalResults.func4 = { dualThreshold: f4Dual, cost: f4Cost };
        if (Object.keys(evalResults).length > 0) {
          avis = AdaptiveEngine.calculateCognitiveScore(evalResults);
        }
      }

      const cells = [
        row.subjectId,
        genderMap[row.gender] || row.gender,
        row.age,
        phaseMap[row.phase] || row.phase,
        // F1
        fmt(f1Threshold, 2), scoreRec(r1),
        // F2
        fmt(f2ThClear, 2), fmt(f2ThBlur, 2), fmt(f2Gain, 2), scoreRec(r2),
        // F3
        fmt(f3Lower, 1), fmt(f3Upper, 1), fmt(f3Win, 1), scoreRec(r3),
        // F4
        fmt(f4Single, 2), fmt(f4Dual, 2), fmt(f4Cost, 2), scoreRec(r4),
        // AVIS
        avis.auditory, avis.visual, avis.integration, avis.attention, avis.total
      ];
      // 防御 CSV 注入：单元格中含 , " \n 时双引号包裹
      csv += cells.map(c => {
        const s = (c == null) ? '' : String(c);
        return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',') + '\n';
    });

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const dateStr = new Date().toISOString().split('T')[0];
    downloadBlob(blob, `subject_info_${dateStr}.csv`);
    if (typeof UIHelper !== 'undefined') {
      UIHelper.showNotification(`被试信息 CSV 已导出（${rows.length} 行）`, 'success');
    }
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
    clearAllDataConfirm,
    deleteFromServer,
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
    toggleRecordVisibility,
    checkStorageQuota,
    loadData,
    exportSubjectInfoCSV,
    exportSelectedWithFormat,
    _doExportSelected,

    // 加载历史记录结果供查看
    loadResultFromHistory
  };
})();
