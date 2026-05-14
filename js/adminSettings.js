/**
 * @fileoverview 管理员设置管理模块
 *
 * 功能：
 * 1. 为每个被试、每个阶段、每个功能保存设置
 * 2. 设置存储到 localStorage
 * 3. 提供默认设置
 */

const AdminSettings = (function () {
  'use strict';

  const STORAGE_KEY = 'adminSettings_v3';

  // ==================== 读取 ====================
  function getAllSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('[AdminSettings] 读取失败', e);
      return {};
    }
  }

  function getSettings(subjectId, phase, func) {
    const all = getAllSettings();
    return all[subjectId + '_' + phase + '_' + func] || null;
  }

  function getSettingsBySubject(subjectId) {
    const all = getAllSettings();
    const result = {};
    Object.keys(all).forEach(function (key) {
      if (key.indexOf(subjectId + '_') === 0) result[key] = all[key];
    });
    return result;
  }

  // ==================== 写入 ====================
  function saveSettings(subjectId, phase, func, settings) {
    const all = getAllSettings();
    all[subjectId + '_' + phase + '_' + func] = {
      subjectId: subjectId,
      phase: phase,
      func: func,
      timestamp: new Date().toISOString(),
      settings: settings
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      console.log('[AdminSettings] 已保存', subjectId, phase, func, settings);
    } catch (e) {
      console.error('[AdminSettings] 保存失败', e);
    }
  }

  function deleteSettings(subjectId, phase, func) {
    const all = getAllSettings();
    delete all[subjectId + '_' + phase + '_' + func];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  function clearAllSettings() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // ==================== 默认设置 ====================
  function getDefaultSettings(func, phase) {
    var reps = (phase === 'train') ? 5 : 3;
    return {
      func: func,
      phase: phase,
      snrLevels:  [12, 9, 6, 3, 0, -3, -6, -9, -12, -18],
      blurLevels: [0, 10, 20, 30, 40, 50, 60],
      soaLevels:  [-300, -200, -100, 0, 100, 200, 300],
      attLevels:  ['single', 'dual'],
      repetitions: reps,
      snrMode: 'adaptive',
      orderState: { snr: 'random', blur: 'random', soa: 'random', att: 'random' }
    };
  }

  // ==================== UI 应用 ====================
  /**
   * 将设置对象应用到页面复选框和输入框
   * @param {Object} s - 设置对象
   */
  function applySettingsToUI(s) {
    if (!s) return;

    // SNR 复选框
    if (s.snrLevels) {
      document.querySelectorAll('.snr-lvl').forEach(function (cb) {
        cb.checked = s.snrLevels.indexOf(Number(cb.value)) >= 0;
      });
    }

    // 模糊度复选框
    if (s.blurLevels) {
      document.querySelectorAll('.blur-lvl').forEach(function (cb) {
        cb.checked = s.blurLevels.indexOf(Number(cb.value)) >= 0;
      });
    }

    // SOA 复选框
    if (s.soaLevels) {
      document.querySelectorAll('.soa-lvl').forEach(function (cb) {
        cb.checked = s.soaLevels.indexOf(Number(cb.value)) >= 0;
      });
    }

    // 注意条件复选框
    if (s.attLevels) {
      document.querySelectorAll('.att-lvl').forEach(function (cb) {
        cb.checked = s.attLevels.indexOf(cb.value) >= 0;
      });
    }

    // 重复次数
    var reps = s.repetitions || 3;
    var el;
    el = document.getElementById('snrReps');  if (el) el.value = reps;
    el = document.getElementById('blurReps'); if (el) el.value = reps;
    el = document.getElementById('soaReps');  if (el) el.value = reps;

    // SNR 模式
    var modeEl = document.getElementById('snrMode');
    if (modeEl && s.snrMode) modeEl.value = s.snrMode;

    // 顺序/随机 按钮状态恢复
    var orders = s.orderState || s.order || {};
    var varTypes = ['snr', 'blur', 'soa', 'att'];
    var colorMap = { snr:'blue', blur:'purple', soa:'orange', att:'green' };
    varTypes.forEach(function(vt) {
      var mode = (typeof orders === 'string') ? orders : (orders[vt] || 'random');
      // 触发 setOrder 恢复按钮视觉（如果 setOrder 已定义）
      if (typeof window.setOrder === 'function' && window.setOrder.toString().indexOf('function() {}') === -1) {
        window.setOrder(vt, mode);
      } else {
        // setOrder 尚未实现，手动恢复按钮样式
        var btnR = document.getElementById(vt + 'OrderR');
        var btnS = document.getElementById(vt + 'OrderS');
        if (btnR && btnS) {
          var c = colorMap[vt] || 'blue';
          if (mode === 'random') {
            btnR.className = 'px-2 py-0.5 rounded bg-' + c + '-200 font-medium';
            btnS.className = 'px-2 py-0.5 rounded bg-gray-100';
          } else {
            btnR.className = 'px-2 py-0.5 rounded bg-gray-100';
            btnS.className = 'px-2 py-0.5 rounded bg-' + c + '-200 font-medium';
          }
        }
      }
    });
  }

  // ==================== 公共 API ====================
  return {
    getSettings:         getSettings,
    saveSettings:         saveSettings,
    getAllSettings:       getAllSettings,
    getSettingsBySubject: getSettingsBySubject,
    deleteSettings:       deleteSettings,
    clearAllSettings:     clearAllSettings,
    getDefaultSettings:   getDefaultSettings,
    applySettingsToUI:   applySettingsToUI
  };
})();
