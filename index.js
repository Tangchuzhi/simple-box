/**
 * Floor-Simplification — 楼层精简
 * 由 index.ts 编译生成，请勿直接修改此文件。
 * 修改请编辑 index.ts 后执行 npm run build。
 */
jQuery(() => {
    console.log('[简单盒子] 开始加载扩展...');

    const EXTENSION_NAME = 'simple-box';
    const BASE_URL = `scripts/extensions/third-party/${EXTENSION_NAME}`;

    let extensionVersion = 'v1.0.0';

    async function loadVersionFromManifest() {
        try {
            const res = await fetch(`${BASE_URL}/manifest.json`);
            if (res.ok) {
                const manifest = await res.json();
                extensionVersion = `v${manifest.version}`;
            }
        } catch {
            console.log('[简单盒子] 无法读取 manifest 版本信息');
        }
        renderVersionDisplay();
    }

    function renderVersionDisplay() {
        const el = document.querySelector('.fs-version-display');
        if (el) el.textContent = `版本: ${extensionVersion}`;
    }

    async function loadFeatureModule(featureFolder, containerId) {
        const htmlUrl = `${BASE_URL}/${featureFolder}/index.html`;
        const jsUrl   = `${BASE_URL}/${featureFolder}/index.js`;

        try {
            const res = await fetch(htmlUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status} — ${htmlUrl}`);

            const html = await res.text();
            const container = document.getElementById(containerId);
            if (!container) throw new Error(`找不到容器元素 #${containerId}`);

            container.innerHTML = html;
            console.log(`[简单盒子] 已注入 ${featureFolder}/index.html`);

            const script = document.createElement('script');
            script.src = jsUrl;
            script.onload  = () => console.log(`[简单盒子] ${featureFolder}/index.js 加载完成`);
            script.onerror = () => console.error(`[简单盒子] ${featureFolder}/index.js 加载失败`);
            document.head.appendChild(script);

        } catch (err) {
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

    const panelHTML = `
        <div class="fs-panel">
            <div class="fs-header-row">
                <span class="fs-version-display">版本: ${extensionVersion}</span>
            </div>
            <div class="fs-content-area" id="fs-floor-hide-content">
                <div style="text-align: center; padding: 20px; color: var(--SmartThemeTextColor); opacity: 0.6;">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <p style="margin: 8px 0 0; font-size: 12px;">正在加载隐藏楼层...</p>
                </div>
            </div>
        </div>
    `;

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

        setTimeout(() => {
            loadVersionFromManifest();
        }, 300);

        setTimeout(() => {
            loadFeatureModule('隐藏楼层', 'fs-floor-hide-content');
        }, 500);

    }, 2000);
});
