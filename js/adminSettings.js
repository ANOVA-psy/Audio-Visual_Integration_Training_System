/**
 * @fileOverview 管理员设置管理模块
 *
 * 功能：
 * 1. 为每个被试保存/加载设置（合并到一个文件）
 * 2. 设置存储到 localStorage 和 config/settings 文件夹
 * 3. 提供默认设置和系统推荐配置
 * 4. 存储被试的性别和年龄信息
 */

const AdminSettings = (function () {
  'use strict';

  const STORAGE_KEY = 'adminSettings_v3';
  const CONFIG_DIR = 'config/settings';

  // ==================== 读取 ====================

  /**
   * 获取所有设置
   * @returns {Object} 所有设置，按 subjectId 组织
   */
  function getAllSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('[AdminSettings] 读取失败', e);
      return {};
    }
  }

  /**
   * 获取指定被试的所有设置（合并到一个对象中）
   * @param {string} subjectId - 被试编号
   * @returns {Object|null} 被试的设置对象，包含 gender, age, phases 等
   */
  function getSettingsBySubject(subjectId) {
    const all = getAllSettings();
    return all[subjectId] || null;
  }

  /**
   * 获取指定被试、阶段、功能的设置
   * @param {string} subjectId - 被试编号
   * @param {string} phase - 阶段（pre/train/post）
   * @param {number} func - 功能（1-4）
   * @returns {Object|null} 设置对象
   */
  function getSettings(subjectId, phase, func) {
    const subjectData = getSettingsBySubject(subjectId);
    if (!subjectData) return null;

    const key = `func${func}_${phase}`;
    return subjectData.phases ? subjectData.phases[key] || null : null;
  }

  // ==================== 写入 ====================

  /**
   * 保存设置（合并到被试的单个配置对象中）
   * @param {string} subjectId - 被试编号
   * @param {string} phase - 阶段（pre/train/post）
   * @param {number} func - 功能（1-4）
   * @param {Object} settings - 设置对象
   * @param {string} [gender] - 性别（可选）
   * @param {string} [age] - 年龄（可选）
   */
  function saveSettings(subjectId, phase, func, settings, gender, age) {
    const all = getAllSettings();

    // 获取或创建被试的配置对象
    if (!all[subjectId]) {
      all[subjectId] = {
        subjectId: subjectId,
        gender: gender || '',
        age: age || '',
        createdAt: new Date().toISOString(),
        phases: {}
      };
    }

    // 更新被试信息
    const subjectData = all[subjectId];
    if (gender !== undefined) subjectData.gender = gender;
    if (age !== undefined) subjectData.age = age;
    subjectData.updatedAt = new Date().toISOString();

    // 保存阶段+功能的设置
    const key = `func${func}_${phase}`;
    subjectData.phases[key] = {
      phase: phase,
      func: func,
      timestamp: new Date().toISOString(),
      settings: settings
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      console.log('[AdminSettings] 已保存到 localStorage', subjectId, phase, func, settings);
    } catch (e) {
      console.error('[AdminSettings] 保存到 localStorage 失败', e);
    }

    // 同时保存到 config 文件夹（通过服务器接口）
    saveSettingsToFile(subjectId);
  }

  /**
   * 保存设置到 config/settings 文件夹
   * 文件名格式：{subjectId}.json（单个文件包含该被试所有配置）
   */
  function saveSettingsToFile(subjectId) {
    const subjectData = getSettingsBySubject(subjectId);
    if (!subjectData) return;

    const filename = `${subjectId}.json`;

    // 使用 fetch API 保存到服务器
    fetch('/api/save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: filename, data: subjectData })
    }).then(response => {
      if (response.ok) {
        console.log('[AdminSettings] 已保存到文件', filename);
      } else {
        console.warn('[AdminSettings] 保存到文件失败，可能服务器未启动，仅保存到 localStorage');
      }
    }).catch(err => {
      console.warn('[AdminSettings] 保存到文件失败，可能服务器未启动，仅保存到 localStorage', err);
    });
  }

  /**
   * 从 config/settings 文件夹加载被试的设置
   * @param {string} subjectId - 被试编号
   * @returns {Promise<Object|null>} 被试的设置对象
   */
  function loadSettingsFromFile(subjectId) {
    const filename = `${subjectId}.json`;

    return fetch(`/api/load-config?filename=${filename}`)
      .then(response => {
        if (response.ok) return response.json();
        return null;
      })
      .catch(err => {
        console.warn('[AdminSettings] 从文件加载失败，可能服务器未启动', err);
        return null;
      });
  }

  function deleteSettings(subjectId, phase, func) {
    const all = getAllSettings();
    if (all[subjectId] && all[subjectId].phases) {
      const key = `func${func}_${phase}`;
      delete all[subjectId].phases[key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
  }

  function clearAllSettings() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // ==================== 最近被试 ====================

  /**
   * 获取最近更新/创建的被试信息
   * 从所有已保存的settings中按 updatedAt/createdAt 排序，返回最近的一个
   * @returns {{ subjectId: string, gender: string, age: string }|null}
   */
  function getLatestSubject() {
    const all = getAllSettings();
    const subjects = Object.values(all);

    if (subjects.length === 0) return null;

    // 按 updatedAt 降序排列，没有 updatedAt 的按 createdAt
    subjects.sort(function (a, b) {
      const timeA = a.updatedAt || a.createdAt || '';
      const timeB = b.updatedAt || b.createdAt || '';
      return timeB.localeCompare(timeA);
    });

    const latest = subjects[0];
    return {
      subjectId: latest.subjectId || '',
      gender:    latest.gender || '',
      age:       latest.age || ''
    };
  }

  // ==================== 预设配置（数据驱动，不依赖 UI） ====================

  /**
   * 从 Config.PRESET_CONFIGS 构造完整设置对象
   * 纯数据方法，不依赖任何 DOM 元素
   * @param {number} func - 功能（1-4）
   * @param {string} phase - 阶段（pre/train/post）
   * @returns {Object} 完整的设置对象
   */
  function getPresetSettings(func, phase) {
    // 边界：Config 未加载时使用硬编码回退
    if (typeof Config === 'undefined' || !Config.PRESET_CONFIGS) {
      console.warn('[AdminSettings] Config 未加载，使用硬编码回退');
      const reps = (phase === 'train') ? 5 : 3;
      return {
        func: func,
        phase: phase,
        snrLevels: [9, 6, 3, 0, -3, -6, -9],
        blurLevels: func === 2 ? [0, 4, 8, 12, 16, 20] : [0],
        soaLevels: func === 3 ? [-300, -200, -100, 0, 100, 200, 300] : [0],
        attLevels: func === 4 ? ['single', 'dual'] : ['single'],
        repetitions: reps,
        snrMode: 'adaptive',
        order: 'random',
        orderState: { snr: 'random', blur: 'random', soa: 'random', att: 'random' }
      };
    }

    const preset = Config.PRESET_CONFIGS[func];
    const config = (preset && preset[phase]) || (preset && preset['train']) || {};

    return {
      func: func,
      phase: phase,
      snrLevels: config.snrLevels || Config.SNR_DEFAULT.slice(),
      blurLevels: config.blurLevels || (func === 2 ? Config.BLUR_DEFAULT.slice() : [0]),
      soaLevels: config.soaLevels || (func === 3 ? Config.SOA_DEFAULT.slice() : [0]),
      attLevels: config.attLevels || (func === 4 ? ['single', 'dual'] : ['single']),
      repetitions: config.repetitions || (phase === 'train' ? 5 : Config.DEFAULT_REPETITIONS),
      snrMode: config.snrMode || 'adaptive',
      order: 'random',
      orderState: { snr: 'random', blur: 'random', soa: 'random', att: 'random' }
    };
  }

  // ==================== 默认设置 ====================

  function getDefaultSettings(func, phase) {
    return getPresetSettings(func, phase);
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
    const reps = s.repetitions || 3;
    let el;
    el = document.getElementById('snrReps'); if (el) el.value = reps;
    el = document.getElementById('blurReps'); if (el) el.value = reps;
    el = document.getElementById('soaReps'); if (el) el.value = reps;

    // SNR 模式
    const modeEl = document.getElementById('snrMode');
    if (modeEl && s.snrMode) modeEl.value = s.snrMode;

    // 顺序/随机 按钮状态恢复
    const orders = s.orderState || s.order || {};
    const varTypes = ['snr', 'blur', 'soa', 'att'];
    const colorMap = { snr: 'blue', blur: 'purple', soa: 'orange', att: 'green' };
    varTypes.forEach(function (vt) {
      const mode = (typeof orders === 'string') ? orders : (orders[vt] || 'seq');
      // 触发 setOrder 恢复按钮视觉（如果 setOrder 已定义）
      if (typeof window.setOrder === 'function' && window.setOrder.toString().indexOf('function() {}') === -1) {
        window.setOrder(vt, mode);
      } else {
        // setOrder 尚未实现，手动恢复按钮样式
        const btnR = document.getElementById(vt + 'OrderR');
        const btnS = document.getElementById(vt + 'OrderS');
        if (btnR && btnS) {
          const c = colorMap[vt] || 'blue';
          if (mode === 'seq') {
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

  // ==================== 应用系统推荐配置 ====================

  /**
   * 应用系统推荐配置（从 Config.PRESET_CONFIGS 读取）
   * 根据当前选择的功能和阶段，自动填充所有变量设置
   */
  function applyDefaultSettings() {
    // 检查 Config 对象是否加载
    if (typeof Config === 'undefined' || !Config.PRESET_CONFIGS) {
      if (typeof UIHelper !== 'undefined') {
        UIHelper.showNotification('配置对象未加载，请刷新页面', 'error');
      } else {
        alert('配置对象未加载，请刷新页面');
      }
      return;
    }

    // 获取当前功能和阶段（从全局 STATE，由 app.js 暴露）
    const func = (window.STATE && STATE.func) ? STATE.func : 1;
    const phase = (window.STATE && STATE.phase) ? STATE.phase : 'train';

    // 获取预设配置
    const preset = Config.PRESET_CONFIGS[func];
    if (!preset) {
      if (typeof UIHelper !== 'undefined') {
        UIHelper.showNotification(`功能 ${func} 暂无预设配置`, 'warning');
      }
      return;
    }

    const config = preset[phase] || preset['train'];  // 回退到训练阶段
    if (!config) {
      if (typeof UIHelper !== 'undefined') {
        UIHelper.showNotification(`功能 ${func} 的 ${phase} 阶段暂无预设`, 'warning');
      }
      return;
    }

    // ========== 1. SNR 设置 ==========
    if (config.snrLevels && Array.isArray(config.snrLevels)) {
      document.querySelectorAll('.snr-lvl').forEach(cb => cb.checked = false);

      // 根据预设选中对应的 SNR 级别
      config.snrLevels.forEach(value => {
        const cb = document.querySelector(`.snr-lvl[value="${value}"]`);
        if (cb) cb.checked = true;
      });

      // 设置 SNR 模式
      if (config.snrMode) {
        const snrModeEl = document.getElementById('snrMode');
        if (snrModeEl) snrModeEl.value = config.snrMode;
      }

      // 设置重复次数
      if (config.repetitions) {
        const snrRepsEl = document.getElementById('snrReps');
        if (snrRepsEl) snrRepsEl.value = config.repetitions;
      }

      // 显示 SNR 变量区域
      const varSNR = document.getElementById('varSNR');
      if (varSNR) varSNR.classList.remove('hidden');
    }

    // ========== 2. 模糊度设置（功能二）==========
    const varBlur = document.getElementById('varBlur');
    if (func === 2 && config.blurLevels && Array.isArray(config.blurLevels)) {
      // 显示模糊度区域
      if (varBlur) varBlur.classList.remove('hidden');

      // 取消所有模糊度复选框
      document.querySelectorAll('.blur-lvl').forEach(cb => cb.checked = false);

      // 根据预设选中对应的模糊度级别
      config.blurLevels.forEach(value => {
        const cb = document.querySelector(`.blur-lvl[value="${value}"]`);
        if (cb) cb.checked = true;
      });

      // 设置重复次数
      if (config.repetitions) {
        const blurRepsEl = document.getElementById('blurReps');
        if (blurRepsEl) blurRepsEl.value = config.repetitions;
      }
    } else {
      // 非功能二，隐藏模糊度区域
      if (varBlur) varBlur.classList.add('hidden');
    }

    // ========== 3. SOA 设置（功能三）==========
    const varSOA = document.getElementById('varSOA');
    if (func === 3 && config.soaLevels && Array.isArray(config.soaLevels)) {
      // 显示 SOA 区域
      if (varSOA) varSOA.classList.remove('hidden');

      // 取消所有 SOA 复选框
      document.querySelectorAll('.soa-lvl').forEach(cb => cb.checked = false);

      // 根据预设选中对应的 SOA 级别
      config.soaLevels.forEach(value => {
        const cb = document.querySelector(`.soa-lvl[value="${value}"]`);
        if (cb) cb.checked = true;
      });

      // 设置重复次数
      if (config.repetitions) {
        const soaRepsEl = document.getElementById('soaReps');
        if (soaRepsEl) soaRepsEl.value = config.repetitions;
      }
    } else {
      // 非功能三，隐藏 SOA 区域
      if (varSOA) varSOA.classList.add('hidden');
    }

    // ========== 4. 注意条件设置（功能四）==========
    const varAtt = document.getElementById('varAtt');
    if (func === 4 && config.attLevels && Array.isArray(config.attLevels)) {
      // 显示注意条件区域
      if (varAtt) varAtt.classList.remove('hidden');

      // 取消所有注意条件复选框
      document.querySelectorAll('.att-lvl').forEach(cb => cb.checked = false);

      // 根据预设选中对应的注意条件
      config.attLevels.forEach(value => {
        const cb = document.querySelector(`.att-lvl[value="${value}"]`);
        if (cb) cb.checked = true;
      });
    } else {
      // 非功能四，隐藏注意条件区域
      if (varAtt) varAtt.classList.add('hidden');
    }

    // ========== 5. 更新试次统计 ==========
    if (typeof updateTrialSummary === 'function') {
      updateTrialSummary();
    }

    // ========== 6. 显示成功通知 ==========
    const phaseNames = { pre: '训练前测试', train: '训练阶段', post: '训练后测试' };
    const funcNames = { 1: '功能一（抗干扰）', 2: '功能二（视觉整合）', 3: '功能三（异步校准）', 4: '功能四（注意定位）' };

    if (typeof UIHelper !== 'undefined') {
      UIHelper.showNotification(
        `已应用：${funcNames[func] || '未知功能'} · ${phaseNames[phase] || phase}`,
        'success'
      );
    }

    console.log(`[applyDefaultSettings] 已应用预设：功能${func} ${phase}阶段`, config);
  }

  // ==================== 公共 API ====================
  return {
    getSettings:         getSettings,
    saveSettings:         saveSettings,
    getAllSettings:       getAllSettings,
    getSettingsBySubject: getSettingsBySubject,
    getLatestSubject:    getLatestSubject,
    deleteSettings:       deleteSettings,
    clearAllSettings:     clearAllSettings,
    getDefaultSettings:   getDefaultSettings,
    getPresetSettings:    getPresetSettings,
    applySettingsToUI:   applySettingsToUI,
    loadSettingsFromFile: loadSettingsFromFile,
    applyDefaultSettings: applyDefaultSettings,
    saveSettingsToFile:   saveSettingsToFile
  };
})();
