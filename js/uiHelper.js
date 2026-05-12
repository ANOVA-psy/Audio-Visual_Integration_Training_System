/**
 * UI辅助函数模块
 * 负责通用的UI操作：屏幕切换、通知、加载状态等
 */

const UIHelper = (function() {
  'use strict';
  
  // 屏幕管理
  function showScreen(screenName) {
    const screenIds = ['menu', 'prep', 'generate', 'exp', 'results', 'history'];
    screenIds.forEach(id => {
      const el = document.getElementById(`screen_${id}`);
      if (el) {
        el.classList.toggle('active', id === screenName);
      }
    });
  }
  
  function hideAllScreens() {
    const screens = document.querySelectorAll('.screen');
    screens.forEach(s => s.classList.remove('active'));
  }
  
  // 通知消息
  function showNotification(message, type = 'info', duration = 3000) {
    const colors = {
      info: 'bg-blue-100 text-blue-700',
      success: 'bg-green-100 text-green-700',
      warning: 'bg-yellow-100 text-yellow-700',
      error: 'bg-red-100 text-red-700'
    };
    
    const notif = document.createElement('div');
    notif.className = `fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg ${colors[type]} transition-all duration-300`;
    notif.textContent = message;
    document.body.appendChild(notif);
    
    setTimeout(() => {
      notif.style.opacity = '0';
      setTimeout(() => notif.remove(), 300);
    }, duration);
  }
  
  // 加载状态
  function showLoading(message = '加载中...') {
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl p-8 text-center">
        <div class="text-4xl mb-4">⏳</div>
        <div class="text-lg font-bold text-gray-700">${message}</div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  
  function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.remove();
  }
  
  // 确认对话框
  function showConfirm(message, onConfirm, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="text-5xl mb-4">❓</div>
        <h3 class="text-lg font-bold text-gray-800 mb-2">确认操作</h3>
        <p class="text-gray-500 text-sm mb-6">${message}</p>
        <div class="flex gap-3 justify-center">
          <button id="confirmCancel" class="px-6 py-2 bg-gray-200 rounded-xl hover:bg-gray-300">取消</button>
          <button id="confirmOk" class="px-6 py-2 bg-red-500 text-white rounded-xl hover:bg-red-600">确认</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('confirmCancel').onclick = () => {
      modal.remove();
      if (onCancel) onCancel();
    };
    
    document.getElementById('confirmOk').onclick = () => {
      modal.remove();
      if (onConfirm) onConfirm();
    };
  }
  
  // 元素启用/禁用
  function setEnabled(elementId, enabled) {
    const el = document.getElementById(elementId);
    if (el) {
      el.disabled = !enabled;
      el.classList.toggle('opacity-50', !enabled);
    }
  }
  
  function setVisible(elementId, visible) {
    const el = document.getElementById(elementId);
    if (el) {
      el.classList.toggle('hidden', !visible);
    }
  }
  
  // 格式化时间
  function formatTime(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
  
  function formatDate(date = new Date()) {
    return date.toISOString().split('T')[0];
  }
  
  function formatDateTime(date = new Date()) {
    return date.toLocaleString('zh-CN');
  }
  
  // 导出公共API
  return {
    showScreen,
    hideAllScreens,
    showNotification,
    showLoading,
    hideLoading,
    showConfirm,
    setEnabled,
    setVisible,
    formatTime,
    formatDate,
    formatDateTime
  };
})();