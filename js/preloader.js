/**
 * @fileOverview 实验材料预加载模块
 * 功能：
 * 1. 预加载所有视频、音频文件到浏览器缓存
 * 2. 显示缓存进度 UI（横幅提示 + 进度条）
 * 3. 实验前检查预加载状态，未完成时提示用户等待
 * 4. 支持公网环境，防止实验过程中卡顿
 */

const Preloader = (function () {
  'use strict';

  // ==================== 配置 ====================
  const VIDEO_FILES = [
    'assets/video/M8_ba.mp4',
    'assets/video/M8_da.mp4',
    'assets/video/M8_ga.mp4'
  ];

  const AUDIO_FILES = [
    'assets/audio/M8_ba_A.mp4',
    'assets/audio/M8_da_A.mp4',
    'assets/audio/M8_ga_A.mp4',
    'assets/audio/white_noise.wav'
  ];

  // ==================== 状态 ====================
  let totalFiles = 0;
  let loadedFiles = 0;
  let failedFiles = 0;
  let isPreloading = false;
  let isComplete = false;
  let preloadPromise = null;

  // ==================== 创建 UI ====================

  /**
   * 创建预加载进度 UI（横幅）
   * 显示在页面顶部，不阻塞用户操作
   */
  function createPreloadBanner() {
    // 如果已存在，不重复创建
    if (document.getElementById('preloadBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'preloadBanner';
    banner.className = 'preload-banner hidden';
    banner.innerHTML = `
      <div class="preload-content">
        <div class="preload-icon">⏳</div>
        <div class="preload-text">
          <div class="preload-title">正在缓存实验材料...</div>
          <div class="preload-detail">
            <span id="preloadProgress">0</span> / <span id="preloadTotal">0</span> 个文件
            (<span id="preloadPercent">0</span>%)
          </div>
        </div>
        <div class="preload-bar-container">
          <div class="preload-bar" id="preloadBar"></div>
        </div>
        <div class="preload-status" id="preloadStatus"></div>
      </div>
    `;

    // 添加样式
    if (!document.getElementById('preloadStyles')) {
      const style = document.createElement('style');
      style.id = 'preloadStyles';
      style.textContent = `
        .preload-banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 9999;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 12px 20px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          transition: transform 0.3s ease, opacity 0.3s ease;
          transform: translateY(-100%);
          opacity: 0;
        }
        .preload-banner.visible {
          transform: translateY(0);
          opacity: 1;
        }
        .preload-banner.hidden {
          display: block;
        }
        .preload-banner.complete {
          background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
        }
        .preload-content {
          max-width: 600px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .preload-icon {
          font-size: 24px;
          animation: preloadSpin 1.5s linear infinite;
        }
        @keyframes preloadSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .preload-text {
          flex: 1;
        }
        .preload-title {
          font-weight: 600;
          font-size: 14px;
        }
        .preload-detail {
          font-size: 12px;
          opacity: 0.9;
        }
        .preload-bar-container {
          width: 120px;
          height: 6px;
          background: rgba(255,255,255,0.3);
          border-radius: 3px;
          overflow: hidden;
        }
        .preload-bar {
          height: 100%;
          width: 0%;
          background: white;
          border-radius: 3px;
          transition: width 0.3s ease;
        }
        .preload-status {
          font-size: 12px;
          min-width: 60px;
          text-align: right;
        }
        .preload-banner.complete .preload-icon {
          animation: none;
        }
      `;
      document.head.appendChild(style);
    }

    document.body.prepend(banner);
  }

  /**
   * 显示预加载横幅
   */
  function showBanner() {
    const banner = document.getElementById('preloadBanner');
    if (banner) {
      banner.classList.remove('hidden');
      // 触发动画
      requestAnimationFrame(() => {
        banner.classList.add('visible');
      });
    }
  }

  /**
   * 隐藏预加载横幅
   */
  function hideBanner() {
    const banner = document.getElementById('preloadBanner');
    if (banner) {
      banner.classList.remove('visible');
      setTimeout(() => {
        banner.classList.add('hidden');
      }, 300);
    }
  }

  /**
   * 更新进度 UI
   */
  function updateProgress() {
    const progressEl = document.getElementById('preloadProgress');
    const totalEl = document.getElementById('preloadTotal');
    const percentEl = document.getElementById('preloadPercent');
    const barEl = document.getElementById('preloadBar');
    const statusEl = document.getElementById('preloadStatus');

    const percent = totalFiles > 0 ? Math.round((loadedFiles / totalFiles) * 100) : 0;

    if (progressEl) progressEl.textContent = loadedFiles;
    if (totalEl) totalEl.textContent = totalFiles;
    if (percentEl) percentEl.textContent = percent;
    if (barEl) barEl.style.width = percent + '%';

    if (statusEl) {
      if (failedFiles > 0) {
        statusEl.textContent = `${failedFiles} 失败`;
        statusEl.style.color = '#ffcccc';
      } else if (loadedFiles >= totalFiles && totalFiles > 0) {
        statusEl.textContent = '完成!';
      } else {
        statusEl.textContent = '';
      }
    }

    // 全部完成
    if (loadedFiles + failedFiles >= totalFiles && totalFiles > 0) {
      isComplete = true;
      isPreloading = false;

      const banner = document.getElementById('preloadBanner');
      if (banner) {
        banner.classList.add('complete');
        const icon = banner.querySelector('.preload-icon');
        if (icon) icon.textContent = '✅';
        const title = banner.querySelector('.preload-title');
        if (title) {
          title.textContent = failedFiles > 0
            ? `缓存完成（${failedFiles} 个文件失败）`
            : '✅ 实验材料已缓存，可以开始实验！';
        }

        // 3秒后自动隐藏
        setTimeout(hideBanner, 3000);
      }
    }
  }

  // ==================== 预加载逻辑 ====================

  /**
   * 预加载单个文件（使用 fetch + blob 缓存）
   * @param {string} url - 文件 URL
   * @returns {Promise<void>}
   */
  async function preloadFile(url) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'force-cache',
        mode: 'cors'
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // 对于视频/音频，读取完整内容以触发浏览器缓存
      if (url.match(/\.(mp4|wav)$/i)) {
        await response.blob();
      } else {
        await response.text();
      }

      loadedFiles++;
      console.log(`[Preloader] 已加载: ${url} (${loadedFiles}/${totalFiles})`);
    } catch (err) {
      failedFiles++;
      console.warn(`[Preloader] 加载失败: ${url}`, err.message);
    } finally {
      updateProgress();
    }
  }

  /**
   * 预加载视频文件（使用 video 元素）
   * @param {string} url - 视频 URL
   * @returns {Promise<void>}
   */
  function preloadVideo(url) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.src = url;
      video.muted = true;
      video.playsInline = true;

      const cleanup = () => {
        video.removeAttribute('src');
        video.load();
        video.remove();
      };

      video.addEventListener('canplaythrough', () => {
        loadedFiles++;
        console.log(`[Preloader] 视频已缓存: ${url} (${loadedFiles}/${totalFiles})`);
        cleanup();
        updateProgress();
        resolve();
      }, { once: true });

      video.addEventListener('error', () => {
        failedFiles++;
        console.warn(`[Preloader] 视频缓存失败: ${url}`);
        cleanup();
        updateProgress();
        resolve(); // 不阻塞，继续加载其他文件
      }, { once: true });

      video.load();
    });
  }

  /**
   * 开始预加载所有材料
   * @returns {Promise<void>}
   */
  function startPreload() {
    if (isPreloading) return preloadPromise;
    if (isComplete) return Promise.resolve();

    isPreloading = true;
    totalFiles = VIDEO_FILES.length + AUDIO_FILES.length;
    loadedFiles = 0;
    failedFiles = 0;

    createPreloadBanner();
    showBanner();

    updateProgress();

    preloadPromise = (async () => {
      console.log(`[Preloader] 开始预加载 ${totalFiles} 个文件...`);

      // 先加载音频（较小），再加载视频
      const audioPromises = AUDIO_FILES.map(url => preloadFile(url));
      await Promise.allSettled(audioPromises);

      const videoPromises = VIDEO_FILES.map(url => preloadVideo(url));
      await Promise.allSettled(videoPromises);

      console.log(`[Preloader] 预加载完成: ${loadedFiles} 成功, ${failedFiles} 失败`);
    })();

    return preloadPromise;
  }

  // ==================== 公共 API ====================

  /**
   * 检查预加载是否完成
   * @returns {boolean}
   */
  function isReady() {
    return isComplete && failedFiles === 0;
  }

  /**
   * 获取预加载状态
   * @returns {{ total: number, loaded: number, failed: number, complete: boolean, percent: number }}
   */
  function getStatus() {
    return {
      total: totalFiles,
      loaded: loadedFiles,
      failed: failedFiles,
      complete: isComplete,
      percent: totalFiles > 0 ? Math.round((loadedFiles / totalFiles) * 100) : 0
    };
  }

  /**
   * 等待预加载完成（用于实验前检查）
   * @param {number} [timeout=30000] - 超时时间（毫秒）
   * @returns {Promise<boolean>} 是否成功完成
   */
  function waitForReady(timeout = 30000) {
    if (isReady()) return Promise.resolve(true);

    return new Promise((resolve) => {
      const startTime = Date.now();

      const check = () => {
        if (isReady()) {
          resolve(true);
          return;
        }

        if (Date.now() - startTime > timeout) {
          console.warn('[Preloader] 等待预加载超时');
          resolve(false);
          return;
        }

        setTimeout(check, 500);
      };

      // 如果还没开始预加载，先开始
      if (!isPreloading && !isComplete) {
        startPreload();
      }

      check();
    });
  }

  /**
   * 显示缓存提示（在快速开始页面）
   * @param {string} [containerId] - 容器 ID，不传则创建浮动提示
   */
  function showCacheHint(containerId) {
    const status = getStatus();

    const hintHTML = `
      <div id="cacheHint" class="cache-hint ${status.complete ? 'cache-hint-ready' : ''}">
        <div class="cache-hint-icon">${status.complete ? '✅' : '⏳'}</div>
        <div class="cache-hint-text">
          ${status.complete
            ? '<strong>实验材料已缓存</strong>，可以开始实验！'
            : `<strong>首次访问，正在缓存实验材料...</strong><br>
               <span class="cache-hint-detail">${status.loaded}/${status.total} 文件 (${status.percent}%)</span>`
          }
        </div>
        ${!status.complete ? `
        <button onclick="Preloader.startPreload()" class="cache-hint-btn">
          立即缓存
        </button>
        ` : ''}
      </div>
    `;

    // 添加样式
    if (!document.getElementById('cacheHintStyles')) {
      const style = document.createElement('style');
      style.id = 'cacheHintStyles';
      style.textContent = `
        .cache-hint {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: #fff3cd;
          border: 1px solid #ffecb5;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 14px;
          color: #856404;
        }
        .cache-hint-ready {
          background: #d4edda;
          border-color: #c3e6cb;
          color: #155724;
        }
        .cache-hint-icon {
          font-size: 20px;
        }
        .cache-hint-text {
          flex: 1;
          line-height: 1.4;
        }
        .cache-hint-detail {
          font-size: 12px;
          opacity: 0.8;
        }
        .cache-hint-btn {
          padding: 6px 12px;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }
        .cache-hint-btn:hover {
          background: #0056b3;
        }
      `;
      document.head.appendChild(style);
    }

    if (containerId) {
      const container = document.getElementById(containerId);
      if (container) {
        // 移除旧的
        const old = document.getElementById('cacheHint');
        if (old) old.remove();
        container.prepend(createElementFromHTML(hintHTML));
      }
    } else {
      // 浮动提示
      const old = document.getElementById('cacheHint');
      if (old) old.remove();
      document.body.insertAdjacentHTML('afterbegin', hintHTML);
    }
  }

  /**
   * 从 HTML 字符串创建元素
   */
  function createElementFromHTML(htmlString) {
    const div = document.createElement('div');
    div.innerHTML = htmlString.trim();
    return div.firstChild;
  }

  // 自动开始预加载（页面加载后）
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        // 延迟 1 秒后自动开始，不阻塞页面渲染
        setTimeout(startPreload, 1000);
      });
    } else {
      setTimeout(startPreload, 1000);
    }
  }

  return {
    startPreload,
    isReady,
    getStatus,
    waitForReady,
    showCacheHint,
    showBanner,
    hideBanner
  };
})();
