/**
 * 楼层精简 — 功能模块（编译输出）
 * 由 楼层精简/index.ts 编译生成，请勿直接修改此文件。
 * 修改请编辑 楼层精简/index.ts 后执行 npm run build。
 *
 * 模式 A：视觉隐藏（CSS）+ /hide 命令
 * 模式 B：仅执行 /hide 命令，视觉保留
 */
(function () {
    'use strict';

    if (window.self !== window.top) return;

    const INIT_FLAG = '__fs_floor_hide_loaded__';
    if (window[INIT_FLAG]) {
        console.log('[隐藏楼层] 模块已存在，跳过重复初始化');
        return;
    }
    window[INIT_FLAG] = true;

    const LOG_PREFIX       = '[隐藏楼层]';
    const EVENT_NS         = 'FloorSimplification_';
    const MODE_STORAGE_KEY = 'fs_hide_mode';
    const STYLE_ID         = 'fs-hide-styles';

    let currentMode = 'A'; // 'A' | 'B'

    // ── 斜杠命令执行器 ────────────────────────────────────────────────────────

    function callSlashCommand(command) {
        const textarea   = document.querySelector('#send_textarea');
        const sendButton = document.querySelector('#send_but');

        if (!textarea || !sendButton) {
            const msg = '找不到 SillyTavern 输入框或发送按钮，请确认页面已完全加载。';
            console.error(`${LOG_PREFIX} ${msg}`);
            if (typeof toastr !== 'undefined') toastr.error(msg);
            return;
        }

        textarea.value = command;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        sendButton.click();

        console.log(`${LOG_PREFIX} 已执行命令: ${command}`);
    }

    // ── 核心功能 ──────────────────────────────────────────────────────────────

    function hideFloors(start, end) {
        if (!isValidRange(start, end)) return;
        if (start > end) { const t = start; start = end; end = t; }

        callSlashCommand(`/hide ${start}-${end}`);

        if (typeof toastr !== 'undefined') {
            toastr.success(`已发送隐藏 ${buildRangeLabel(start, end)} 的请求。`, '隐藏楼层', { timeOut: 2500 });
        }
    }

    function unhideFloors(start, end) {
        if (!isValidRange(start, end)) return;
        if (start > end) { const t = start; start = end; end = t; }

        callSlashCommand(`/unhide ${start}-${end}`);

        if (typeof toastr !== 'undefined') {
            toastr.success(`已发送显示 ${buildRangeLabel(start, end)} 的请求。`, '隐藏楼层', { timeOut: 2500 });
        }
    }

    function showAllFloors() {
        callSlashCommand('/unhide 0-{{lastMessageId}}');

        if (typeof toastr !== 'undefined') {
            toastr.success('已发送显示全部楼层的请求。', '隐藏楼层', { timeOut: 2500 });
        }
    }

    // ── 辅助函数 ──────────────────────────────────────────────────────────────

    function isValidRange(start, end) {
        if (isNaN(start) || isNaN(end) || start < 0 || end < 0) {
            if (typeof toastr !== 'undefined') {
                toastr.error('请输入有效的楼层号（大于等于 0 的整数）。', '隐藏楼层');
            }
            return false;
        }
        return true;
    }

    function buildRangeLabel(start, end) {
        if (start === 0 && end === 0) return '开场白';
        if (start === 0)              return `开场白和楼层 1–${end}`;
        if (start === end)            return `楼层 ${start}`;
        return `楼层 ${start}–${end}`;
    }

    function readFloorInputs() {
        const startEl = document.getElementById('fs-start-floor');
        const endEl   = document.getElementById('fs-end-floor');
        return {
            start: startEl ? parseInt(startEl.value, 10) : NaN,
            end:   endEl   ? parseInt(endEl.value,   10) : NaN,
        };
    }

    // ── 视图层隐藏样式 ────────────────────────────────────────────────────────

    function injectHideStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .mes[is_system="true"] {
                display: none !important;
            }
            .mes[is_system="true"] + .mes {
                margin-top: 0;
            }
        `;
        document.head.appendChild(style);
        console.log(`${LOG_PREFIX} 已注入隐藏样式（模式 A）`);
    }

    function removeHideStyles() {
        const el = document.getElementById(STYLE_ID);
        if (el) {
            el.remove();
            console.log(`${LOG_PREFIX} 已移除隐藏样式（模式 B）`);
        }
    }

    // ── 模式管理 ──────────────────────────────────────────────────────────────

    function initModeSelector() {
        // 读取上次保存的模式，默认 A
        const saved = localStorage.getItem(MODE_STORAGE_KEY);
        currentMode = (saved === 'A' || saved === 'B') ? saved : 'A';

        // 设置 Radio 选中状态
        const radio = document.querySelector(`input[name="fs-hide-mode"][value="${currentMode}"]`);
        if (radio) radio.checked = true;

        // 根据当前模式应用或移除 CSS
        currentMode === 'A' ? injectHideStyles() : removeHideStyles();

        // 监听模式切换
        document.querySelectorAll('input[name="fs-hide-mode"]').forEach(function (r) {
            r.addEventListener('change', onModeChange);
        });

        console.log(`${LOG_PREFIX} 当前隐藏模式: ${currentMode}`);
    }

    function onModeChange() {
        const newMode = this.value;
        if (newMode === currentMode) return;

        currentMode = newMode;
        localStorage.setItem(MODE_STORAGE_KEY, newMode);

        if (newMode === 'A') {
            injectHideStyles();
            if (typeof toastr !== 'undefined') {
                toastr.info('已切换至模式 A：视觉+指令隐藏', '隐藏楼层', { timeOut: 2000 });
            }
        } else {
            removeHideStyles();
            if (typeof toastr !== 'undefined') {
                toastr.info('已切换至模式 B：仅指令隐藏', '隐藏楼层', { timeOut: 2000 });
            }
        }

        console.log(`${LOG_PREFIX} 隐藏模式已切换为: ${newMode}`);
    }

    // ── 事件监听 ──────────────────────────────────────────────────────────────

    document.addEventListener(`${EVENT_NS}hide`, function () {
        const { start, end } = readFloorInputs();
        hideFloors(start, end);
    });

    document.addEventListener(`${EVENT_NS}unhide`, function () {
        const { start, end } = readFloorInputs();
        unhideFloors(start, end);
    });

    document.addEventListener(`${EVENT_NS}showAll`, function () {
        showAllFloors();
    });

    // ── 初始化 ────────────────────────────────────────────────────────────────

    function tryInit(retry) {
        retry = retry || 0;
        try {
            if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
                throw new Error('SillyTavern 上下文尚未就绪');
            }
            SillyTavern.getContext();

            initModeSelector();
            console.log(`${LOG_PREFIX} 模块初始化完成。`);
        } catch (err) {
            if (retry < 20) {
                setTimeout(function () { tryInit(retry + 1); }, 250);
            } else {
                console.error(`${LOG_PREFIX} 初始化失败（已重试 20 次）:`, err);
                if (typeof toastr !== 'undefined') {
                    toastr.error('隐藏楼层模块初始化失败，请检查控制台。', '隐藏楼层');
                }
            }
        }
    }

    tryInit();

})();
