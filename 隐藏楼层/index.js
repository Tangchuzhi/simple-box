/**
 * 楼层精简 — 功能模块
 *
 * 职责：
 *   - 监听 UI 发出的自定义事件（FloorSimplification_*）
 *   - 通过操作 SillyTavern 的输入框/发送按钞执行 /hide、/unhide 斜杠命令
 *   - 模式 A：视觅隐藏（CSS）+ /hide 命令
 *   - 模式 B：仅执行 /hide 命令，视觅不隐藏
 *
 * 此文件以 IIFE 包裹，防止变量污染全局作用域。
 * 编译目标：ES2017，module: none（直接作为浏览器脚本运行）。
 */
(function () {
    'use strict';
    // 防止在 iframe 中重复执行（SillyTavern 可能嵌套 iframe）
    if (window.self !== window.top)
        return;
    // 防止重复初始化（脚本被多次注入时的保护）
    const INIT_FLAG = '__fs_floor_hide_loaded__';
    if (window[INIT_FLAG]) {
        console.log('[隐藏楼层] 模块已存在，跳过重复初始化');
        return;
    }
    window[INIT_FLAG] = true;
    const LOG_PREFIX = '[隐藏楼层]';
    const EVENT_NS = 'FloorSimplification_';
    const MODE_STORAGE_KEY = 'fs_hide_mode';
    let currentMode = 'A';
    // ── 斜杠命令执行器 ────────────────────────────────────────────────────────
    /**
     * 将指定的斜杠命令写入 SillyTavern 的发送输入框并触发发送，
     * 从而借用 ST 的内置命令解析器执行 /hide / /unhide 等命令。
     */
    function callSlashCommand(command) {
        const textarea = document.querySelector('#send_textarea');
        const sendButton = document.querySelector('#send_but');
        if (!textarea || !sendButton) {
            const msg = '找不到 SillyTavern 输入框或发送按钮，请确认页面已完全加载。';
            console.error(`${LOG_PREFIX} ${msg}`);
            if (typeof toastr !== 'undefined')
                toastr.error(msg);
            return;
        }
        // 将命令注入输入框，触发 input 事件让 ST 感知变化，再点击发送
        textarea.value = command;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        sendButton.click();
        console.log(`${LOG_PREFIX} 已执行命令: ${command}`);
    }
    // ── 核心功能 ──────────────────────────────────────────────────────────────
    /**
     * 隐藏指定范围的楼层
     * @param start - 起始楼层（含），0 代表开场白
     * @param end   - 结束楼层（含）
     */
    function hideFloors(start, end) {
        if (!isValidRange(start, end))
            return;
        if (start > end)
            [start, end] = [end, start];
        callSlashCommand(`/hide ${start}-${end}`);
        if (typeof toastr !== 'undefined') {
            toastr.success(`已发送隐藏 ${buildRangeLabel(start, end)} 的请求。`, '隐藏楼层', { timeOut: 2500 });
        }
    }
    /**
     * 取消隐藏指定范围的楼层
     * @param start - 起始楼层（含）
     * @param end   - 结束楼层（含）
     */
    function unhideFloors(start, end) {
        if (!isValidRange(start, end))
            return;
        if (start > end)
            [start, end] = [end, start];
        callSlashCommand(`/unhide ${start}-${end}`);
        if (typeof toastr !== 'undefined') {
            toastr.success(`已发送显示 ${buildRangeLabel(start, end)} 的请求。`, '隐藏楼层', { timeOut: 2500 });
        }
    }
    /**
     * 显示所有楼层（从 0 到最后一条消息）
     * 使用 SillyTavern 内置宏 {{lastMessageId}} 动态获取末尾楼层号。
     */
    function showAllFloors() {
        callSlashCommand('/unhide 0-{{lastMessageId}}');
        if (typeof toastr !== 'undefined') {
            toastr.success('已发送显示全部楼层的请求。', '隐藏楼层', { timeOut: 2500 });
        }
    }
    // ── 辅助函数 ──────────────────────────────────────────────────────────────
    /** 验证楼层号合法性，非法时弹出提示并返回 false */
    function isValidRange(start, end) {
        if (isNaN(start) || isNaN(end) || start < 0 || end < 0) {
            if (typeof toastr !== 'undefined') {
                toastr.error('请输入有效的楼层号（大于等于 0 的整数）。', '隐藏楼层');
            }
            return false;
        }
        return true;
    }
    /** 将楼层范围转换为可读的中文标签 */
    function buildRangeLabel(start, end) {
        if (start === 0 && end === 0)
            return '开场白';
        if (start === 0)
            return `开场白和楼层 1–${end}`;
        if (start === end)
            return `楼层 ${start}`;
        return `楼层 ${start}–${end}`;
    }
    /** 从 UI 输入框读取起始/结束楼层号 */
    function readFloorInputs() {
        const startEl = document.getElementById('fs-start-floor');
        const endEl = document.getElementById('fs-end-floor');
        return {
            start: startEl ? parseInt(startEl.value, 10) : NaN,
            end: endEl ? parseInt(endEl.value, 10) : NaN,
        };
    }
    // ── 视图层隐藏样式 ────────────────────────────────────────────────────────
    const STYLE_ID = 'fs-hide-styles';
    /**
     * 注入 CSS（模式 A）：将 is_system="true" 的消息元素从视图中移除。
     * /hide 命令给消息打上该标记；/unhide 移除该标记，CSS 自动恢复显示。
     */
    function injectHideStyles() {
        if (document.getElementById(STYLE_ID))
            return;
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
    /**
     * 移除 CSS（模式 B）：恢复 is_system="true" 消息的视觉显示。
     */
    function removeHideStyles() {
        const el = document.getElementById(STYLE_ID);
        if (el) {
            el.remove();
            console.log(`${LOG_PREFIX} 已移除隐藏样式（模式 B）`);
        }
    }
    // ── 模式管理 ──────────────────────────────────────────────────────────────
    /** 从 localStorage 恢复模式，初始化 Radio 状态并绑定变更监听 */
    function initModeSelector() {
        // 读取上次保存的模式，默认 A
        const saved = localStorage.getItem(MODE_STORAGE_KEY);
        currentMode = (saved === 'A' || saved === 'B') ? saved : 'A';
        // 设置 Radio 选中状态
        const radio = document.querySelector(`input[name="fs-hide-mode"][value="${currentMode}"]`);
        if (radio)
            radio.checked = true;
        // 根据当前模式应用或移除 CSS
        currentMode === 'A' ? injectHideStyles() : removeHideStyles();
        // 监听模式切换
        document.querySelectorAll('input[name="fs-hide-mode"]').forEach(r => {
            r.addEventListener('change', onModeChange);
        });
        console.log(`${LOG_PREFIX} 当前隐藏模式: ${currentMode}`);
    }
    /** 用户切换模式时的回调 */
    function onModeChange() {
        const newMode = this.value;
        if (newMode === currentMode)
            return;
        currentMode = newMode;
        localStorage.setItem(MODE_STORAGE_KEY, newMode);
        if (newMode === 'A') {
            injectHideStyles();
            if (typeof toastr !== 'undefined') {
                toastr.info('已切换至模式 A：视觉+指令隐藏', '隐藏楼层', { timeOut: 2000 });
            }
        }
        else {
            removeHideStyles();
            if (typeof toastr !== 'undefined') {
                toastr.info('已切换至模式 B：仅指令隐藏', '隐藏楼层', { timeOut: 2000 });
            }
        }
        console.log(`${LOG_PREFIX} 隐藏模式已切换为: ${newMode}`);
    }
    // ── 事件监听 ──────────────────────────────────────────────────────────────
    // 按钮通过 dispatchEvent(new CustomEvent(...)) 触发，保持 HTML 与 JS 解耦。
    document.addEventListener(`${EVENT_NS}hide`, () => {
        const { start, end } = readFloorInputs();
        hideFloors(start, end);
    });
    document.addEventListener(`${EVENT_NS}unhide`, () => {
        const { start, end } = readFloorInputs();
        unhideFloors(start, end);
    });
    document.addEventListener(`${EVENT_NS}showAll`, () => {
        showAllFloors();
    });
    // ── 初始化（含重试机制）──────────────────────────────────────────────────
    function tryInit(retry = 0) {
        try {
            // 检查 SillyTavern 上下文是否可用
            if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
                throw new Error('SillyTavern 上下文尚未就绪');
            }
            SillyTavern.getContext(); // 验证可正常调用
            initModeSelector();
            console.log(`${LOG_PREFIX} 模块初始化完成。`);
        }
        catch (err) {
            if (retry < 20) {
                setTimeout(() => tryInit(retry + 1), 250);
            }
            else {
                console.error(`${LOG_PREFIX} 初始化失败（已重试 20 次）:`, err);
                if (typeof toastr !== 'undefined') {
                    toastr.error('隐藏楼层模块初始化失败，请检查控制台。', '隐藏楼层');
                }
            }
        }
    }
    tryInit();
})();
