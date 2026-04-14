/**
 * Floor-Simplification — 楼层精简
 * SillyTavern 扩展主入口
 *
 * 职责：
 *   1. 在 SillyTavern 扩展设置面板注册插件 UI
 *   2. 动态加载各功能子模块（HTML + JS）
 *   3. 从 manifest.json 读取并展示版本号
 */
jQuery(() => {
    console.log('[简单盒子] 开始加载扩展...');
    // ── 常量 ──────────────────────────────────────────────────────────────────
    const EXTENSION_NAME = 'simple-box';
    const BASE_URL = `scripts/extensions/third-party/${EXTENSION_NAME}`;
    let extensionVersion = 'v1.0.0';
    // ── 版本管理 ──────────────────────────────────────────────────────────────
    async function loadVersionFromManifest() {
        try {
            const res = await fetch(`${BASE_URL}/manifest.json`);
            if (res.ok) {
                const manifest = await res.json();
                extensionVersion = `v${manifest.version}`;
            }
        }
        catch (_a) {
            console.log('[简单盒子] 无法读取 manifest 版本信息');
        }
        renderVersionDisplay();
    }
    function renderVersionDisplay() {
        const el = document.querySelector('.fs-version-display');
        if (el)
            el.textContent = `版本: ${extensionVersion}`;
    }
    // ── 子模块加载器 ──────────────────────────────────────────────────────────
    /**
     * 动态加载一个功能子模块：
     *   先将其 index.html 注入到指定容器，
     *   再以 <script> 标签异步加载其 index.js。
     *
     * @param featureFolder - 功能子文件夹名称（相对于插件根目录）
     * @param containerId   - 注入 HTML 的目标元素 id
     */
    async function loadFeatureModule(featureFolder, containerId) {
        const htmlUrl = `${BASE_URL}/${featureFolder}/index.html`;
        const jsUrl = `${BASE_URL}/${featureFolder}/index.js`;
        try {
            const res = await fetch(htmlUrl);
            if (!res.ok)
                throw new Error(`HTTP ${res.status} — ${htmlUrl}`);
            const html = await res.text();
            const container = document.getElementById(containerId);
            if (!container)
                throw new Error(`找不到容器元素 #${containerId}`);
            container.innerHTML = html;
            console.log(`[简单盒子] 已注入 ${featureFolder}/index.html`);
            // 注入对应的 JavaScript
            const script = document.createElement('script');
            script.src = jsUrl;
            script.onload = () => console.log(`[简单盒子] ${featureFolder}/index.js 加载完成`);
            script.onerror = () => console.error(`[简单盒子] ${featureFolder}/index.js 加载失败`);
            document.head.appendChild(script);
        }
        catch (err) {
            console.error(`[简单盒子] 加载子模块 "${featureFolder}" 失败:`, err);
            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = `
                    <p style="color: #dc3545; padding: 12px; font-size: 12px;">
                        <i class="fa-solid fa-circle-exclamation"></i>
                        加载失败: ${err.message}
                    </p>`;
            }
        }
    }
    // ── 面板 HTML ─────────────────────────────────────────────────────────────
    const panelHTML = `
        <div class="fs-panel">
            <div class="fs-header-row">
                <span class="fs-version-display">版本: ${extensionVersion}</span>
            </div>
            <div class="fs-tab-bar">
                <button class="fs-tab-btn fs-tab-active" data-tab="fs-floor-hide-content">
                    <i class="fa-solid fa-eye-slash"></i> 隐藏楼层
                </button>
                <button class="fs-tab-btn" data-tab="fs-summary-content">
                    <i class="fa-solid fa-scroll"></i> 总结
                </button>
            </div>
            <div class="fs-content-area" id="fs-floor-hide-content">
                <div style="text-align: center; padding: 20px; color: var(--SmartThemeTextColor); opacity: 0.6;">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <p style="margin: 8px 0 0; font-size: 12px;">正在加载隐藏楼层...</p>
                </div>
            </div>
            <div class="fs-content-area" id="fs-summary-content" style="display:none">
                <div style="text-align: center; padding: 20px; color: var(--SmartThemeTextColor); opacity: 0.6;">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <p style="margin: 8px 0 0; font-size: 12px;">正在加载总结...</p>
                </div>
            </div>
        </div>
    `;
    // ── 注册到 SillyTavern 扩展设置面板 ──────────────────────────────────────
    // SillyTavern 推荐在 jQuery ready + 延迟后再操作 #extensions_settings，
    // 以确保宿主 DOM 已完全渲染完毕。
    setTimeout(() => {
        $('#extensions_settings').append(`
            <div id="simple-box-settings">
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>简单盒子</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        ${panelHTML}
                    </div>
                </div>
            </div>
        `);
        console.log('[简单盒子] 扩展面板已挂载');
        // Tab 切换逻辑
        document.querySelectorAll('.fs-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.getAttribute('data-tab');
                if (!tabId)
                    return;
                document.querySelectorAll('.fs-tab-btn').forEach(b => {
                    b.classList.toggle('fs-tab-active', b === btn);
                });
                document.querySelectorAll('.fs-content-area').forEach(area => {
                    area.style.display = area.id === tabId ? '' : 'none';
                });
            });
        });
        // 版本读取
        setTimeout(() => {
            loadVersionFromManifest();
        }, 300);
        // 加载「隐藏楼层」功能子模块
        setTimeout(() => {
            loadFeatureModule('隐藏楼层', 'fs-floor-hide-content');
        }, 500);
        // 加载「总结」功能子模块
        setTimeout(() => {
            loadFeatureModule('总结', 'fs-summary-content');
        }, 700);
    }, 2000);
});
