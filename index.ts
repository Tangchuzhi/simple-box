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

    let extensionVersion = '读取中...';

    // ── 版本管理 ──────────────────────────────────────────────────────────────

    const GITHUB_MANIFEST_URL = 'https://raw.githubusercontent.com/Tangchuzhi/simple-box/main/manifest.json';

    let localVersion  = '';
    let remoteVersion = '';
    let versionPollTimer: ReturnType<typeof setInterval> | null = null;

    async function loadVersionFromManifest(): Promise<void> {
        try {
            const res = await fetch(`${BASE_URL}/manifest.json`);
            if (res.ok) {
                const manifest: { version: string } = await res.json();
                localVersion = manifest.version;
                extensionVersion = `v${localVersion}`;
            } else {
                extensionVersion = '读取失败';
                renderVersionDisplay();
                return;
            }
        } catch {
            console.log('[简单盒子] 无法读取 manifest 版本信息');
            extensionVersion = '读取失败';
            renderVersionDisplay();
            return;
        }

        try {
            const gh = await fetch(`${GITHUB_MANIFEST_URL}?_=${Date.now()}`);
            if (gh.ok) {
                const ghData: { version: string } = await gh.json();
                remoteVersion = ghData.version;
            }
        } catch {
            console.log('[简单盒子] 无法获取 GitHub 版本信息');
        }

        renderVersionDisplay();

        if (remoteVersion && remoteVersion !== localVersion) {
            startVersionPolling();
        }
    }

    function renderVersionDisplay(): void {
        const el = document.querySelector<HTMLElement>('.fs-version-display');
        const titleEl = document.querySelector<HTMLElement>('#simple-box-settings .inline-drawer-header b');
        if (remoteVersion && localVersion && remoteVersion !== localVersion) {
            if (el) {
                el.textContent = `v${localVersion} → v${remoteVersion} [点击更新]`;
                el.style.color = '#e67e22';
                el.style.cursor = 'pointer';
                el.title = '点击一键更新简单盒子';
                el.onclick = () => { performUpdate(); };
            }
            if (titleEl && !titleEl.querySelector('.sb-new-badge')) {
                const badge = document.createElement('span');
                badge.className = 'sb-new-badge';
                badge.textContent = '新';
                badge.style.cssText = 'background:#e67e22;color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:5px;vertical-align:middle;font-weight:normal;';
                titleEl.appendChild(badge);
            }
        } else {
            if (el) {
                el.textContent = `版本: ${extensionVersion}`;
                el.style.color = '';
                el.style.cursor = '';
                el.title = '';
                el.onclick = null;
            }
            titleEl?.querySelector('.sb-new-badge')?.remove();
        }
    }

    async function performUpdate(): Promise<void> {
        const el = document.querySelector<HTMLElement>('.fs-version-display');
        if (el) {
            el.textContent = '更新中...';
            el.style.cursor = 'default';
            el.style.color = '#27ae60';
            el.onclick = null;
        }
        if (versionPollTimer !== null) {
            clearInterval(versionPollTimer);
            versionPollTimer = null;
        }
        try {
            const scriptMod = await (Function('return import("/script.js")')() as Promise<any>);
            const headers = scriptMod.getRequestHeaders();
            const response = await fetch('/api/extensions/update', {
                method: 'POST',
                headers,
                body: JSON.stringify({ extensionName: EXTENSION_NAME, global: false }),
            });
            if (!response.ok) {
                const text = await response.text();
                if (typeof toastr !== 'undefined') toastr.error(text || response.statusText, '简单盒子更新失败', { timeOut: 5000 });
                if (el) {
                    el.textContent = `v${localVersion} → v${remoteVersion} [点击更新]`;
                    el.style.color = '#e67e22';
                    el.style.cursor = 'pointer';
                    el.onclick = () => { performUpdate(); };
                }
                startVersionPolling();
                return;
            }
            const data = await response.json();
            if (data.isUpToDate) {
                if (typeof toastr !== 'undefined') toastr.info('已是最新版本，无需更新', '简单盒子');
                if (el) { el.textContent = `版本: ${extensionVersion}`; el.style.color = ''; el.style.cursor = ''; el.onclick = null; }
            } else {
                if (typeof toastr !== 'undefined') toastr.success('更新成功，即将刷新...', '简单盒子');
                if (el) { el.textContent = '已更新，正在刷新...'; el.style.color = '#27ae60'; }
                setTimeout(() => location.reload(), 1500);
            }
        } catch (err) {
            console.error('[简单盒子] 更新失败:', err);
            if (typeof toastr !== 'undefined') toastr.error('更新失败，请查看控制台', '简单盒子');
            if (el) {
                el.textContent = `v${localVersion} → v${remoteVersion} [点击更新]`;
                el.style.color = '#e67e22';
                el.style.cursor = 'pointer';
                el.onclick = () => { performUpdate(); };
            }
            startVersionPolling();
        }
    }

    function startVersionPolling(): void {
        if (versionPollTimer !== null) return;
        versionPollTimer = setInterval(async () => {
            try {
                const res = await fetch(`${BASE_URL}/manifest.json?_=${Date.now()}`);
                if (!res.ok) return;
                const data: { version: string } = await res.json();
                if (data.version !== localVersion) {
                    clearInterval(versionPollTimer!);
                    versionPollTimer = null;
                    const el = document.querySelector<HTMLElement>('.fs-version-display');
                    if (el) {
                        el.textContent = '已更新，正在刷新...';
                        el.style.color = '#27ae60';
                        el.style.cursor = 'default';
                        el.onclick = null;
                    }
                    setTimeout(() => location.reload(), 1500);
                }
            } catch {
                // ignore
            }
        }, 8000);
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
    async function loadFeatureModule(featureFolder: string, containerId: string): Promise<void> {
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

            // 注入对应的 JavaScript
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
                        加载失败: ${(err as Error).message}
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
        document.querySelectorAll<HTMLElement>('.fs-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.getAttribute('data-tab');
                if (!tabId) return;

                document.querySelectorAll<HTMLElement>('.fs-tab-btn').forEach(b => {
                    b.classList.toggle('fs-tab-active', b === btn);
                });
                document.querySelectorAll<HTMLElement>('.fs-content-area').forEach(area => {
                    (area as HTMLElement).style.display = area.id === tabId ? '' : 'none';
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
