/**
 * 总结的总结 — 功能模块
 *
 * 职责：
 *   - 从一个或多个世界书条目中读取已有总结内容
 *   - 支持拖动排序，用户决定档案注入顺序
 *   - 将条目内容模拟为聊天历史（POS_IN_CHAT）注入，避免被全局世界书干扰
 *   - 压缩后写入指定世界书条目（可命名为"第N层压缩档案"）
 *   - 使用独立提示词预设体系，与「总结」模块完全解耦
 */
(function () {
    'use strict';
    if (window.self !== window.top)
        return;
    const INIT_FLAG = '__cpr_compress_loaded__';
    if (window[INIT_FLAG]) {
        console.log('[总结的总结] 模块已存在，跳过重复初始化');
        return;
    }
    window[INIT_FLAG] = true;
    const LOG_PREFIX = '[总结的总结]';
    const EVENT_NS = 'Cpr_';
    // ── localStorage 键名 ────────────────────────────────────────────────────
    const SK_ENTRIES = 'cpr_entries';
    const SK_PRESETS = 'cpr_presets';
    const SK_PROMPT = 'cpr_prompt';
    const SK_TRIGGER_TXT = 'cpr_trigger_text';
    const SK_OUT_BOOKNAME = 'cpr_out_bookname';
    const SK_OUT_ENTRYNAME = 'cpr_out_entryname';
    const SK_WI_EXTRACT = 'cpr_wi_extract';
    const SK_WI_EXTRACT_MODE = 'cpr_wi_extract_mode';
    const SK_WI_EXTRACT_CUSTOM = 'cpr_wi_extract_custom';
    const SK_BROWSE_BOOKNAME = 'cpr_browse_bookname';
    const SK_WRITE_MODE = 'cpr_write_mode';
    const SK_WI_DEPTH = 'cpr_wi_depth';
    // ── SillyTavern extension_prompt_types 数值 ──────────────────────────────
    const POS_IN_PROMPT = 0; // 主提示词末尾（系统区）
    const POS_IN_CHAT = 1; // 聊天历史中（指定 depth）
    // ── SillyTavern extension_prompt_roles 数值 ──────────────────────────────
    const ROLE_SYSTEM = 0;
    const ROLE_USER = 1;
    const ROLE_ASSISTANT = 2;
    // ── 注入 key ─────────────────────────────────────────────────────────────
    const INJECT_KEY_ARCHIVE = 'cpr-archive'; // 档案内容（IN_CHAT 高深度）
    const INJECT_KEY_USER = 'cpr-user-pad'; // assistant 模式前置 user 占位
    // ── 模块状态 ─────────────────────────────────────────────────────────────
    let entries = [];
    let presets = [];
    let wiBookNames = [];
    let browseBookEntries = [];
    let pendingSummaryPrompt = null;
    let activeSummaryPrompt = null;
    let activeArchiveBlock = null;
    let isContinueGeneration = false;
    let session = {
        generatedMessageId: null,
        pendingPreview: false,
        hiddenFloors: [],
        floorsHidden: false,
    };
    // ── 内置预设 ─────────────────────────────────────────────────────────────
    const REMOVED_DEFAULTS = ['打工喵-压缩版'];
    const DEFAULT_PRESETS = [
        {
            name: 'Janus-灵魂典藏馆',
            prompt: `Janus, pause all narrative and role-playing. Based on <soul_world> + <chat_history> content, compress existing [Soul Archives]. **This response should only contain <thinking> and compressed soul archives.**

**Process (<thinking> must be strictly generated):**
1. Confirm execution mode: Archive compression mode - <chat_history> entire content consists of [Soul Archives] with no plot content whatsoever
2. Identify all characters from existing archives that need compression, totaling N characters
3. Apply compression principles to reduce redundancy while maintaining essential information
4. Commit to strictly following [Core Principles], [Archive Format], and [Archive Compression Principles]
5. Commit that the janusdiary block output immediately after </thinking> will contain only compressed archives

---[Core Principles] [Archive Compression Principles] [Soul Archive Format]need not be output or reflected in <thinking>---

**[Core Principles]**
1. Strictly third-person perspective, record only objective facts, prohibit subjective speculation and emotional rendering
2. Must maintain archives for all characters that appeared in original content
3. All information must have direct/indirect basis from original content
4. All character archives must completely include all parts of the standard format, with no omissions

**[Archive Compression Principles]**
1. Retain important events, merge similar events with small time spans
2. Maintain completeness of character relationship networks, keep detailed records of important item states
3. When compressing 人生履历 (records/history), maintain causal logic chains of key nodes

**[Soul Archives Format]**
<thinking>
[Process1~5点内容]
</thinking>
<janusdiary>
[角色1]
◆ 人生履历
YYYY年MM月DD日HH:MM~YYYY年MM月DD日HH:MM: 事件1的精炼总结（必须包含:地点、所有关键参与人物、起因、核心经过、关键转折、最终结局，以及此事对该角色造成的永久性改变。不少于100字）
YYYY年MM月DD日HH:MM~YYYY年MM月DD日HH:MM: 与事件1接续的事件2的精炼总结
...etc.
◆ 人物关系
对方角色名| 旧关系→新关系: YYYY年MM月DD日导致该转变的关键事件摘要
◆ 组织归属
组织名称 | 旧身份/地位→新身份/地位: YYYY年MM月DD日导致该转变的关键事件摘要
◆ 重要物品
物品名称 | 持有/消耗/损坏/转交/丢失: YYYY年MM月DD日状态变更事件摘要
◆ 未解之谜
伏笔/约定/线索/承诺 | YYYY年MM月DD日具体事件摘要 | 待激活/已完成

---

[角色2]
...
...
[角色5]
...

---

<!-- 已完成[M+X]/N个角色，还需继续压缩剩余(N-(M+X))个角色档案。我会保持相同的质量标准，严格执行压缩档案原则，确保每个角色的档案都完整包含所有必要部分。接下来处理: [具体角色名1, 角色名2, 角色名3, 角色名4, 角色名5] -->

[角色6]
...

[5个一组循环直到所有角色档案生成]

**[已完成[M+X]/N个角色档案压缩，全部角色档案整理完毕。]**
</janusdiary>

现在开始压缩：`
        },
        {
            name: '打工喵',
            prompt: `现在停止生成任何正文创作！请调取上下文所有记录，对既有的阶段性归档执行二次压缩整合。

必须遵循以下记录格式：

【总结】

- [时间]: {客观记录该阶段的核心事件与对话，禁止文学化修辞，禁止描述角色心情。字数不少于100字。重点描述：发生了什么关键冲突、角色做出了什么核心决策、以及环境的变化。}
- [时间]: {……}

- [待完成事件]: {仅保留至目前为止仍处于"进行中"或"未触发"状态的计划/约定。已完成或已失效的条目必须剔除。}
- [重要物品]: {清点目前角色随身携带或存放在特定位置的关键道具，注明归属权。已消耗/遗失的物品不再列出。}
- [角色成长]: {对比故事开始时，分析各角色（A、B...）在性格、认知或情感关系上的实质性变化，并引用具体事件作为论据，客观记录，禁止文学化修辞，禁止描述角色心情}

————

压缩要求:
1. 信息密度优先：合并时间相近、主题一致的事件，删除冗余与重复记录，保留对后续剧情不可或缺的关键节点。
2. 时序严格：事件按时间先后排列，保留因果链，不得打乱顺序。
3. 交叉校验：若各档案存在相互矛盾的记录，以最新档案为准并在事件描述中简要注明差异。
4. 状态更新：[待完成事件]与[重要物品]必须基于最新档案去除已完成、已失效或已消耗的条目；[角色成长]保留最新的阶段性结论。
5. 格式一致：输出严格遵循上方【总结】结构，不得新增或省略小节。

现在开始压缩：`
        }
    ];
    // ── 工具函数 ─────────────────────────────────────────────────────────────
    function loadJSON(key, def) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : def;
        }
        catch (_a) {
            return def;
        }
    }
    function saveJSON(key, val) {
        localStorage.setItem(key, JSON.stringify(val));
    }
    function getCtx() {
        return window.SillyTavern.getContext();
    }
    // ── extension_settings 持久化（跨设备同步到 settings.json） ──────────────
    const SETTINGS_NS = 'simple-box';
    function getExtSettings() {
        try {
            const ctx = getCtx();
            const ext = ctx === null || ctx === void 0 ? void 0 : ctx.extensionSettings;
            if (ext) {
                if (!ext[SETTINGS_NS])
                    ext[SETTINGS_NS] = {};
                return ext[SETTINGS_NS];
            }
        }
        catch (_a) { }
        return {};
    }
    function saveSetting(key, value) {
        var _a;
        try {
            const ctx = getCtx();
            getExtSettings()[key] = value;
            (_a = ctx === null || ctx === void 0 ? void 0 : ctx.saveSettingsDebounced) === null || _a === void 0 ? void 0 : _a.call(ctx);
        }
        catch (_b) {
            try {
                localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            }
            catch (_c) { }
        }
    }
    function loadSetting(key) {
        try {
            const s = getExtSettings();
            if (key in s && s[key] !== null && s[key] !== undefined)
                return String(s[key]);
            const lv = localStorage.getItem(key);
            if (lv !== null)
                saveSetting(key, lv);
            return lv;
        }
        catch (_a) {
            return localStorage.getItem(key);
        }
    }
    function loadSettingJSON(key, def) {
        try {
            const s = getExtSettings();
            if (key in s && s[key] !== null && s[key] !== undefined)
                return s[key];
            const lv = localStorage.getItem(key);
            if (lv !== null) {
                try {
                    const parsed = JSON.parse(lv);
                    saveSetting(key, parsed);
                    return parsed;
                }
                catch (_a) { }
            }
        }
        catch (_b) { }
        return def;
    }
    function getInputVal(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    // ── 预览区操作 ───────────────────────────────────────────────────────────
    function setPreviewText(text) {
        const el = document.getElementById('cpr-preview');
        if (el)
            el.value = text;
    }
    function getPreviewText() {
        var _a, _b;
        return (_b = (_a = document.getElementById('cpr-preview')) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : '';
    }
    function setPreviewStatus(text) {
        const el = document.getElementById('cpr-preview-status');
        if (el)
            el.textContent = text;
    }
    // ── UI 辅助 ───────────────────────────────────────────────────────────────
    function getOutBookName() {
        return getInputVal('cpr-out-bookname').trim();
    }
    function getOutEntryName() {
        return getInputVal('cpr-out-entryname').trim() || '档案压缩';
    }
    function isExtractEnabled() {
        var _a, _b;
        return (_b = (_a = document.getElementById('cpr-wi-extract')) === null || _a === void 0 ? void 0 : _a.checked) !== null && _b !== void 0 ? _b : true;
    }
    function getExtractMode() {
        var _a;
        const el = document.getElementById('cpr-wi-extract-mode');
        return ((_a = el === null || el === void 0 ? void 0 : el.value) !== null && _a !== void 0 ? _a : 'thinking');
    }
    function getCustomExtractTags() {
        return getInputVal('cpr-wi-extract-custom').split(',').map(v => v.trim()).filter(Boolean);
    }
    function toggleCustomExtractInput() {
        const input = document.getElementById('cpr-wi-extract-custom');
        if (!input)
            return;
        input.style.display = getExtractMode() === 'custom' ? '' : 'none';
    }
    // ── AI 输出清理 ───────────────────────────────────────────────────────────
    function cleanAiResponse(text) {
        if (!isExtractEnabled())
            return text.trim();
        const mode = getExtractMode();
        const tags = mode === 'thinking' ? ['thinking']
            : mode === 'think' ? ['think']
                : mode === 'custom' ? getCustomExtractTags()
                    : ['thinking'];
        let result = text;
        for (const tag of tags) {
            const safe = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result = result.replace(new RegExp(`<${safe}>[\\s\\S]*?<\\/${safe}>`, 'gi'), '');
        }
        return result.replace(/\n{3,}/g, '\n\n').trim();
    }
    // ── 世界书 API ────────────────────────────────────────────────────────────
    async function getWiApi() {
        return Function('return import("/scripts/world-info.js")')();
    }
    function getFreeWiUid(data) {
        if (!data || !('entries' in data))
            return null;
        for (let uid = 0; uid < 1000000; uid++) {
            if (!(uid in data.entries))
                return uid;
        }
        return null;
    }
    function getWiDepth() {
        const v = parseInt(getInputVal('cpr-wi-depth'), 10);
        return isNaN(v) ? 9999 : Math.max(0, v);
    }
    function makeWiEntry(uid, comment, content) {
        return {
            uid, key: [], keysecondary: [], comment, content,
            constant: true, selective: true, selectiveLogic: 0,
            addMemo: false, order: 100, position: 4, disable: false,
            excludeRecursion: false, preventRecursion: false, delayUntilRecursion: 0,
            probability: 100, useProbability: true, depth: getWiDepth(),
            group: '', groupOverride: false, groupWeight: 100,
            scanDepth: null, caseSensitive: null, matchWholeWords: null,
            useGroupScoring: null, automationId: '', role: 0,
            sticky: null, cooldown: null, delay: null, triggers: [],
            vectorized: false, outletName: '',
            matchPersonaDescription: false, matchCharacterDescription: false,
            matchCharacterPersonality: false, matchCharacterDepthPrompt: false,
            matchScenario: false, matchCreatorNotes: false,
        };
    }
    function normalizeWiEntry(entry) {
        entry.constant = true;
        entry.selective = true;
        entry.position = 4;
        entry.depth = getWiDepth();
        entry.role = 0;
    }
    async function loadWorldBookNames() {
        try {
            const wiMod = await getWiApi();
            wiBookNames = Array.isArray(wiMod.world_names) ? wiMod.world_names : [];
        }
        catch (err) {
            console.warn(`${LOG_PREFIX} 无法获取世界书列表`, err);
            wiBookNames = [];
        }
        populateAllBookSelects();
        renderEntryList();
    }
    function populateSelectWithBooks(sel, currentValue) {
        const prev = currentValue || sel.value;
        sel.innerHTML = '<option value="">未选择</option>';
        wiBookNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        });
        if (prev)
            sel.value = prev;
    }
    function populateAllBookSelects() {
        var _a, _b;
        const outSel = document.getElementById('cpr-out-bookname');
        if (outSel)
            populateSelectWithBooks(outSel, (_a = loadSetting(SK_OUT_BOOKNAME)) !== null && _a !== void 0 ? _a : '');
        const browseSel = document.getElementById('cpr-browse-bookname');
        if (browseSel) {
            populateSelectWithBooks(browseSel, (_b = loadSetting(SK_BROWSE_BOOKNAME)) !== null && _b !== void 0 ? _b : '');
            if (browseSel.value)
                loadBrowseEntries(browseSel.value);
        }
    }
    async function loadBrowseEntries(bookName) {
        const checklist = document.getElementById('cpr-entry-checklist');
        if (!checklist)
            return;
        if (!bookName) {
            browseBookEntries = [];
            checklist.innerHTML = '<div class="cpr-entry-empty">选择世界书以浏览条目</div>';
            return;
        }
        checklist.innerHTML = '<div class="cpr-entry-empty"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</div>';
        try {
            const ctx = getCtx();
            const data = await ctx.loadWorldInfo(bookName);
            browseBookEntries = data
                ? Object.values(data.entries)
                    .map((e) => { var _a; return (e.comment || ((_a = e.key) === null || _a === void 0 ? void 0 : _a[0]) || '').trim(); })
                    .filter(Boolean)
                    .sort()
                : [];
            renderEntryChecklist();
        }
        catch (err) {
            console.warn(`${LOG_PREFIX} loadBrowseEntries 失败`, err);
            browseBookEntries = [];
            if (checklist)
                checklist.innerHTML = '<div class="cpr-entry-empty">加载失败</div>';
        }
    }
    function renderEntryChecklist() {
        const checklist = document.getElementById('cpr-entry-checklist');
        if (!checklist)
            return;
        if (browseBookEntries.length === 0) {
            checklist.innerHTML = '<div class="cpr-entry-empty">该世界书暂无条目</div>';
            return;
        }
        checklist.innerHTML = '';
        browseBookEntries.forEach(name => {
            const item = document.createElement('label');
            item.className = 'cpr-entry-check-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = name;
            cb.className = 'cpr-entry-cb';
            cb.addEventListener('change', updateCheckAllState);
            const span = document.createElement('span');
            span.textContent = name;
            item.appendChild(cb);
            item.appendChild(span);
            checklist.appendChild(item);
        });
        updateCheckAllState();
    }
    function updateCheckAllState() {
        const allCb = document.getElementById('cpr-check-all');
        if (!allCb)
            return;
        const cbs = Array.from(document.querySelectorAll('#cpr-entry-checklist .cpr-entry-cb'));
        allCb.checked = cbs.length > 0 && cbs.every(cb => cb.checked);
        allCb.indeterminate = cbs.some(cb => cb.checked) && !cbs.every(cb => cb.checked);
    }
    function toggleCheckAll() {
        const allCb = document.getElementById('cpr-check-all');
        if (!allCb)
            return;
        document.querySelectorAll('#cpr-entry-checklist .cpr-entry-cb')
            .forEach(cb => { cb.checked = allCb.checked; });
    }
    function addCheckedEntries() {
        var _a;
        const browseSel = document.getElementById('cpr-browse-bookname');
        const bookName = (_a = browseSel === null || browseSel === void 0 ? void 0 : browseSel.value) !== null && _a !== void 0 ? _a : '';
        if (!bookName) {
            if (typeof toastr !== 'undefined')
                toastr.warning('请先选择世界书。', '总结的总结');
            return;
        }
        const checked = Array.from(document.querySelectorAll('#cpr-entry-checklist .cpr-entry-cb:checked')).map(cb => cb.value);
        if (checked.length === 0) {
            if (typeof toastr !== 'undefined')
                toastr.warning('请先勾选至少一个条目。', '总结的总结');
            return;
        }
        let added = 0;
        checked.forEach(entryName => {
            if (!entries.some(e => e.bookName === bookName && e.entryName === entryName)) {
                entries.push({ bookName, entryName });
                added++;
            }
        });
        persistEntries();
        renderEntryList();
        if (typeof toastr !== 'undefined') {
            toastr.success(`已添加 ${added} 个条目${added < checked.length ? `（${checked.length - added} 个重复跳过）` : ''}`, '总结的总结', { timeOut: 2000 });
        }
    }
    function clearAllEntries() {
        if (entries.length === 0)
            return;
        if (!window.confirm('确定清空所有压缩条目？'))
            return;
        entries = [];
        persistEntries();
        renderEntryList();
    }
    // ── 条目列表管理 ─────────────────────────────────────────────────────────
    let dragSrcIdx = -1;
    let pointerSortState = null;
    const POINTER_SORT_THRESHOLD = 6;
    function persistEntries() {
        saveSetting(SK_ENTRIES, entries);
    }
    function clearEntryDragState(list) {
        list.querySelectorAll('.cpr-entry-row').forEach(r => {
            r.classList.remove('cpr-drag-over', 'cpr-dragging', 'cpr-drag-pressing');
        });
    }
    function moveEntry(sourceIdx, targetIdx) {
        if (sourceIdx < 0 || targetIdx < 0 || sourceIdx === targetIdx)
            return;
        if (sourceIdx >= entries.length || targetIdx >= entries.length)
            return;
        const moved = entries.splice(sourceIdx, 1)[0];
        entries.splice(targetIdx, 0, moved);
        persistEntries();
        renderEntryList();
    }
    function getPointerTargetRow(e) {
        var _a;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        return (_a = el === null || el === void 0 ? void 0 : el.closest) === null || _a === void 0 ? void 0 : _a.call(el, '#cpr-entry-list .cpr-entry-row');
    }
    function finishPointerSort(e) {
        var _a, _b;
        const state = pointerSortState;
        if (!state)
            return;
        pointerSortState = null;
        document.removeEventListener('pointermove', onPointerSortMove, true);
        document.removeEventListener('pointerup', onPointerSortEnd, true);
        document.removeEventListener('pointercancel', onPointerSortCancel, true);
        try {
            if (e)
                (_b = (_a = state.row).releasePointerCapture) === null || _b === void 0 ? void 0 : _b.call(_a, e.pointerId);
        }
        catch (_c) { }
        const shouldMove = state.active && state.targetIdx >= 0 && state.targetIdx !== state.sourceIdx;
        clearEntryDragState(state.list);
        if (shouldMove) {
            moveEntry(state.sourceIdx, state.targetIdx);
        }
    }
    function cancelPointerSort(e) {
        var _a, _b;
        const state = pointerSortState;
        if (!state)
            return;
        pointerSortState = null;
        document.removeEventListener('pointermove', onPointerSortMove, true);
        document.removeEventListener('pointerup', onPointerSortEnd, true);
        document.removeEventListener('pointercancel', onPointerSortCancel, true);
        try {
            if (e)
                (_b = (_a = state.row).releasePointerCapture) === null || _b === void 0 ? void 0 : _b.call(_a, e.pointerId);
        }
        catch (_c) { }
        clearEntryDragState(state.list);
    }
    function onPointerSortMove(e) {
        var _a;
        const state = pointerSortState;
        if (!state || e.pointerId !== state.pointerId)
            return;
        const dx = Math.abs(e.clientX - state.startX);
        const dy = Math.abs(e.clientY - state.startY);
        if (!state.active && Math.max(dx, dy) < POINTER_SORT_THRESHOLD)
            return;
        e.preventDefault();
        if (!state.active) {
            state.active = true;
            state.row.classList.remove('cpr-drag-pressing');
            state.row.classList.add('cpr-dragging');
        }
        const targetRow = getPointerTargetRow(e);
        state.list.querySelectorAll('.cpr-entry-row').forEach(r => r.classList.remove('cpr-drag-over'));
        if (!targetRow) {
            state.targetIdx = -1;
            return;
        }
        const targetIdx = parseInt((_a = targetRow.dataset.idx) !== null && _a !== void 0 ? _a : '-1', 10);
        state.targetIdx = targetIdx;
        if (targetIdx >= 0 && targetIdx !== state.sourceIdx) {
            targetRow.classList.add('cpr-drag-over');
        }
    }
    function onPointerSortEnd(e) {
        if (!pointerSortState || e.pointerId !== pointerSortState.pointerId)
            return;
        e.preventDefault();
        finishPointerSort(e);
    }
    function onPointerSortCancel(e) {
        if (!pointerSortState || e.pointerId !== pointerSortState.pointerId)
            return;
        cancelPointerSort(e);
    }
    function bindPointerSort(handle, row, idx, list) {
        handle.addEventListener('pointerdown', (e) => {
            var _a;
            if (e.pointerType === 'mouse' && e.button !== 0)
                return;
            if (entries.length < 2)
                return;
            e.preventDefault();
            cancelPointerSort();
            pointerSortState = {
                pointerId: e.pointerId,
                sourceIdx: idx,
                targetIdx: idx,
                startX: e.clientX,
                startY: e.clientY,
                active: false,
                row,
                list,
            };
            row.classList.add('cpr-drag-pressing');
            try {
                (_a = row.setPointerCapture) === null || _a === void 0 ? void 0 : _a.call(row, e.pointerId);
            }
            catch (_b) { }
            document.addEventListener('pointermove', onPointerSortMove, true);
            document.addEventListener('pointerup', onPointerSortEnd, true);
            document.addEventListener('pointercancel', onPointerSortCancel, true);
        });
    }
    function renderEntryList() {
        const list = document.getElementById('cpr-entry-list');
        if (!list)
            return;
        list.innerHTML = '';
        if (entries.length === 0) {
            list.innerHTML = '<div class="cpr-entry-empty">从上方勾选条目后点击「添加选中条目」</div>';
            return;
        }
        entries.forEach((entry, idx) => {
            const row = document.createElement('div');
            row.className = 'cpr-entry-row';
            row.setAttribute('draggable', 'true');
            row.dataset.idx = String(idx);
            const handle = document.createElement('span');
            handle.className = 'cpr-drag-handle';
            handle.innerHTML = '<i class="fa-solid fa-grip-lines"></i>';
            handle.title = '拖动排序';
            const label = document.createElement('span');
            label.className = 'cpr-entry-label';
            label.textContent = `${entry.bookName || '(未选书)'} → ${entry.entryName || '(未选条目)'}`;
            label.title = `${entry.bookName} → ${entry.entryName}`;
            const delBtn = document.createElement('button');
            delBtn.className = 'cpr-icon-btn cpr-icon-btn--del cpr-entry-del';
            delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            delBtn.title = '移除';
            delBtn.addEventListener('click', () => {
                entries.splice(idx, 1);
                persistEntries();
                renderEntryList();
            });
            bindPointerSort(handle, row, idx, list);
            row.addEventListener('dragstart', (e) => {
                dragSrcIdx = idx;
                row.classList.add('cpr-dragging');
                if (e.dataTransfer)
                    e.dataTransfer.effectAllowed = 'move';
            });
            row.addEventListener('dragend', () => {
                dragSrcIdx = -1;
                clearEntryDragState(list);
            });
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (e.dataTransfer)
                    e.dataTransfer.dropEffect = 'move';
                list.querySelectorAll('.cpr-entry-row').forEach(r => r.classList.remove('cpr-drag-over'));
                row.classList.add('cpr-drag-over');
            });
            row.addEventListener('dragleave', () => { row.classList.remove('cpr-drag-over'); });
            row.addEventListener('drop', (e) => {
                var _a;
                e.preventDefault();
                row.classList.remove('cpr-drag-over');
                const targetIdx = parseInt((_a = row.dataset.idx) !== null && _a !== void 0 ? _a : '-1', 10);
                if (dragSrcIdx < 0 || dragSrcIdx === targetIdx)
                    return;
                moveEntry(dragSrcIdx, targetIdx);
                dragSrcIdx = -1;
            });
            row.appendChild(handle);
            row.appendChild(label);
            row.appendChild(delBtn);
            list.appendChild(row);
        });
    }
    // ── 注入管理 ─────────────────────────────────────────────────────────────
    function injectAtPosition(key, content, position, depth, role, ephemeral) {
        const ctx = getCtx();
        if (typeof ctx.setExtensionPrompt !== 'function') {
            console.error(`${LOG_PREFIX} setExtensionPrompt 不可用`);
            return;
        }
        ctx.setExtensionPrompt(`script_inject_${key}`, content, position, depth, false, role);
        console.log(`${LOG_PREFIX} 已注入 [${key}] pos=${position} depth=${depth} 长度 ${content.length}`);
        if (ephemeral) {
            scheduleEphemeralCleanup(key, position, role);
        }
    }
    function scheduleEphemeralCleanup(key, position, role) {
        var _a;
        const ctx = getCtx();
        const eventSource = ctx.eventSource;
        const eventTypes = (_a = ctx.eventTypes) !== null && _a !== void 0 ? _a : ctx.event_types;
        if (!eventSource || !eventTypes) {
            setTimeout(() => removeInjection(key, position, role), 10000);
            return;
        }
        let cleaned = false;
        const cleanup = () => {
            if (cleaned)
                return;
            cleaned = true;
            removeInjection(key, position, role);
        };
        eventSource.once(eventTypes.GENERATION_ENDED, cleanup);
        eventSource.once(eventTypes.GENERATION_STOPPED, cleanup);
    }
    function removeInjection(key, position, role) {
        const ctx = getCtx();
        if (typeof ctx.setExtensionPrompt !== 'function')
            return;
        ctx.setExtensionPrompt(`script_inject_${key}`, '', position, 0, false, role);
        console.log(`${LOG_PREFIX} 已清理注入 [${key}]`);
    }
    // ── 生成触发 ─────────────────────────────────────────────────────────────
    function callSlashCommand(cmd) {
        const ta = document.querySelector('#send_textarea');
        const btn = document.querySelector('#send_but');
        if (!ta || !btn) {
            console.error(`${LOG_PREFIX} 找不到输入框或发送按钮`);
            if (typeof toastr !== 'undefined')
                toastr.error('找不到 SillyTavern 输入框或发送按钮。', '总结的总结');
            return;
        }
        ta.value = cmd;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        btn.click();
    }
    async function triggerGeneration() {
        const ctx = getCtx();
        try {
            if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
                await ctx.executeSlashCommandsWithOptions('/trigger');
            }
            else {
                callSlashCommand('/trigger');
            }
        }
        catch (err) {
            console.warn(`${LOG_PREFIX} triggerGeneration 降级:`, err);
            callSlashCommand('/trigger');
        }
    }
    async function execSlashCmd(cmd) {
        const ctx = getCtx();
        try {
            if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
                await ctx.executeSlashCommandsWithOptions(cmd);
            }
            else {
                callSlashCommand(cmd);
                await delay(100);
            }
        }
        catch (err) {
            console.warn(`${LOG_PREFIX} execSlashCmd 降级: ${cmd}`, err);
            callSlashCommand(cmd);
            await delay(100);
        }
    }
    // ── 楼层隐藏管理 ─────────────────────────────────────────────────────────
    function groupIntoRanges(indices) {
        if (indices.length === 0)
            return [];
        const sorted = [...indices].sort((a, b) => a - b);
        const ranges = [];
        let rs = sorted[0], re = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === re + 1) {
                re = sorted[i];
            }
            else {
                ranges.push({ start: rs, end: re });
                rs = sorted[i];
                re = sorted[i];
            }
        }
        ranges.push({ start: rs, end: re });
        return ranges;
    }
    async function hideAllFloors() {
        var _a, _b, _c;
        const ctx = getCtx();
        const chatLength = Array.isArray(ctx.chat) ? ctx.chat.length : 0;
        if (chatLength === 0)
            return;
        const toHide = [];
        for (let i = 0; i < chatLength; i++) {
            if (((_a = ctx.chat[i]) === null || _a === void 0 ? void 0 : _a.is_system) !== true && !((_c = (_b = ctx.chat[i]) === null || _b === void 0 ? void 0 : _b.extra) === null || _c === void 0 ? void 0 : _c.hidden))
                toHide.push(i);
        }
        session.hiddenFloors = toHide;
        session.floorsHidden = true;
        await execSlashCmd(`/hide 0-${chatLength - 1}`);
        console.log(`${LOG_PREFIX} 已隐藏全部楼层，共 ${toHide.length} 条`);
    }
    async function restoreHiddenFloors() {
        if (!session.floorsHidden)
            return;
        const ranges = groupIntoRanges(session.hiddenFloors);
        for (const r of ranges) {
            await execSlashCmd(`/unhide ${r.start}-${r.end}`);
        }
        session.hiddenFloors = [];
        session.floorsHidden = false;
        console.log(`${LOG_PREFIX} 已恢复全部隐藏楼层`);
    }
    // ── 世界书写入 ────────────────────────────────────────────────────────────
    async function saveToWorldInfo(content) {
        var _a, _b;
        const ctx = getCtx();
        const bookName = getOutBookName();
        if (!bookName) {
            if (typeof toastr !== 'undefined')
                toastr.error('请选择保存目标世界书。', '总结的总结');
            return;
        }
        const entryName = getOutEntryName();
        let data;
        try {
            data = await ctx.loadWorldInfo(bookName);
        }
        catch (err) {
            console.error(`${LOG_PREFIX} loadWorldInfo 失败:`, err);
        }
        if (!data) {
            if (typeof toastr !== 'undefined')
                toastr.error(`世界书「${bookName}」不存在或加载失败。`, '总结的总结');
            return;
        }
        const writeMode = ((_b = (_a = document.querySelector('input[name="cpr-write-mode"]:checked')) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : 'overwrite');
        const existingUid = Object.keys(data.entries).find((k) => data.entries[k].comment === entryName);
        if (existingUid !== undefined) {
            const entry = data.entries[existingUid];
            normalizeWiEntry(entry);
            if (writeMode === 'append') {
                entry.content = (entry.content ? entry.content + '\n\n---\n\n' : '') + content;
                console.log(`${LOG_PREFIX} 追加条目「${entryName}」`);
            }
            else {
                entry.content = content;
                console.log(`${LOG_PREFIX} 覆盖条目「${entryName}」`);
            }
        }
        else {
            const uid = getFreeWiUid(data);
            if (uid === null) {
                if (typeof toastr !== 'undefined')
                    toastr.error('无法分配条目 UID。', '总结的总结');
                return;
            }
            data.entries[uid] = makeWiEntry(uid, entryName, content);
            normalizeWiEntry(data.entries[uid]);
            console.log(`${LOG_PREFIX} 创建新条目「${entryName}」uid=${uid}`);
        }
        try {
            await ctx.saveWorldInfo(bookName, data, true);
            if (typeof toastr !== 'undefined') {
                toastr.success(`已写入「${bookName}」→「${entryName}」`, '总结的总结', { timeOut: 3000 });
            }
        }
        catch (err) {
            console.error(`${LOG_PREFIX} saveWorldInfo 失败:`, err);
            if (typeof toastr !== 'undefined')
                toastr.error('保存世界书失败，请检查控制台。', '总结的总结');
        }
    }
    // ── 核心执行 ──────────────────────────────────────────────────────────────
    async function executeCompression(isReroll = false) {
        var _a;
        const prompt = getInputVal('cpr-prompt').trim();
        if (!prompt) {
            if (typeof toastr !== 'undefined')
                toastr.warning('请填写压缩提示词。', '总结的总结');
            return;
        }
        if (entries.length === 0) {
            if (typeof toastr !== 'undefined')
                toastr.warning('请至少添加一个条目作为压缩素材。', '总结的总结');
            return;
        }
        setPreviewText('');
        setPreviewStatus(isReroll ? '正在重ROLL' : '生成中');
        if (!isReroll)
            session.generatedMessageId = null;
        // ── 读取各条目内容 ────────────────────────────────────────
        const ctx = getCtx();
        const blocks = [];
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (!e.bookName || !e.entryName) {
                console.warn(`${LOG_PREFIX} 跳过未填写的条目 #${i + 1}`);
                continue;
            }
            try {
                const data = await ctx.loadWorldInfo(e.bookName);
                if (!data) {
                    console.warn(`${LOG_PREFIX} 世界书「${e.bookName}」加载失败`);
                    continue;
                }
                const found = Object.values(data.entries).find((x) => x.comment === e.entryName);
                if (!((_a = found === null || found === void 0 ? void 0 : found.content) === null || _a === void 0 ? void 0 : _a.trim())) {
                    console.warn(`${LOG_PREFIX} 条目「${e.entryName}」内容为空`);
                    continue;
                }
                blocks.push(`[档案 ${i + 1}/${entries.length}：${e.bookName} → ${e.entryName}]\n${found.content.trim()}`);
            }
            catch (err) {
                console.warn(`${LOG_PREFIX} 读取条目失败: ${e.bookName}/${e.entryName}`, err);
            }
        }
        if (blocks.length === 0) {
            if (typeof toastr !== 'undefined')
                toastr.warning('未能读取任何条目内容，请检查世界书和条目名称。', '总结的总结');
            setPreviewStatus('待生成');
            return;
        }
        // ── 将条目内容注入为模拟聊天历史（assistant 角色，高深度 = 靠前） ──
        const archiveBlock = blocks.join('\n\n---\n\n');
        activeArchiveBlock = archiveBlock;
        injectAtPosition(INJECT_KEY_ARCHIVE, archiveBlock, POS_IN_CHAT, 9999, ROLE_USER, true);
        // ── 通过事件钩子将压缩提示词追加到上下文最末尾（在 JB/PHI 之后）──
        pendingSummaryPrompt = prompt;
        activeSummaryPrompt = prompt;
        // ── 首次执行：隐藏全部聊天楼层 ──────────────────────────
        if (!isReroll) {
            if (session.floorsHidden)
                await restoreHiddenFloors();
            await hideAllFloors();
        }
        session.pendingPreview = true;
        if (typeof toastr !== 'undefined') {
            toastr.info(`压缩已启动，共读取 ${blocks.length} 个档案条目`, '总结的总结', { timeOut: 4000 });
        }
        await delay(200);
        // ── 触发生成 ─────────────────────────────────────────────
        await triggerGeneration();
        console.log(`${LOG_PREFIX} 压缩触发完成，条目数: ${blocks.length}`);
    }
    // ── 预览管理 ──────────────────────────────────────────────────────────────
    function getLatestAiMessageInfo() {
        var _a;
        const chat = (_a = getCtx().chat) !== null && _a !== void 0 ? _a : [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const m = chat[i];
            if (!(m === null || m === void 0 ? void 0 : m.is_user) && !(m === null || m === void 0 ? void 0 : m.is_system) && typeof (m === null || m === void 0 ? void 0 : m.mes) === 'string') {
                return { id: i, text: m.mes };
            }
        }
        return { id: null, text: '' };
    }
    function updatePreviewFromLatestMessage() {
        const latest = getLatestAiMessageInfo();
        if (!latest.text) {
            setPreviewStatus('未捕获到压缩结果');
            return;
        }
        if (latest.id !== null)
            session.generatedMessageId = latest.id;
        setPreviewText(cleanAiResponse(latest.text));
        setPreviewStatus('已生成，等待确认');
    }
    async function finalizeToWorldInfo() {
        activeSummaryPrompt = null;
        activeArchiveBlock = null;
        const preview = getPreviewText();
        if (!preview) {
            if (typeof toastr !== 'undefined')
                toastr.warning('当前没有可写入世界书的压缩预览。', '总结的总结');
            return;
        }
        const ctx = getCtx();
        await saveToWorldInfo(preview);
        if (session.generatedMessageId !== null) {
            try {
                await ctx.deleteMessage(session.generatedMessageId);
            }
            catch (err) {
                console.warn(`${LOG_PREFIX} 删除压缩消息失败:`, err);
            }
        }
        await restoreHiddenFloors();
        try {
            await ctx.saveChat();
        }
        catch (err) {
            console.warn(`${LOG_PREFIX} 保存聊天失败:`, err);
        }
        setPreviewStatus('已写入世界书');
        setPreviewText('');
        session.generatedMessageId = null;
    }
    async function rerollCompression() {
        const ctx = getCtx();
        if (session.generatedMessageId !== null) {
            try {
                await ctx.deleteMessage(session.generatedMessageId);
            }
            catch (err) {
                console.warn(`${LOG_PREFIX} 删除旧压缩消息失败:`, err);
            }
        }
        setPreviewText('');
        setPreviewStatus('正在重ROLL');
        session.generatedMessageId = null;
        await executeCompression(true);
    }
    function clearPreview() {
        activeSummaryPrompt = null;
        activeArchiveBlock = null;
        setPreviewText('');
        setPreviewStatus('待生成');
        session.generatedMessageId = null;
        updateContinueBtnState();
        if (session.floorsHidden) {
            restoreHiddenFloors();
        }
    }
    async function continueCompression() {
        if (session.generatedMessageId === null) {
            if (typeof toastr !== 'undefined')
                toastr.warning('尚无可继续的生成。', '总结的总结');
            return;
        }
        setPreviewStatus('继续生成中...');
        session.pendingPreview = true;
        isContinueGeneration = true;
        if (activeArchiveBlock) {
            injectAtPosition(INJECT_KEY_ARCHIVE, activeArchiveBlock, POS_IN_CHAT, 9999, ROLE_USER, true);
        }
        updateContinueBtnState();
        await execSlashCmd('/continue');
    }
    function updateContinueBtnState() {
        const btn = document.getElementById('cpr-continue-btn');
        if (btn)
            btn.disabled = session.generatedMessageId === null;
    }
    // ── 事件监听（生成流式回调） ─────────────────────────────────────────────
    function bindGenerationEvents() {
        var _a;
        const ctx = getCtx();
        const eventSource = ctx.eventSource;
        const eventTypes = (_a = ctx.eventTypes) !== null && _a !== void 0 ? _a : ctx.event_types;
        if (!eventSource || !eventTypes)
            return;
        eventSource.on(eventTypes.STREAM_TOKEN_RECEIVED, (text) => {
            if (!session.pendingPreview || typeof text !== 'string')
                return;
            if (isContinueGeneration) {
                setPreviewStatus('继续生成中...');
                return;
            }
            const el = document.getElementById('cpr-preview');
            if (el) {
                el.value = cleanAiResponse(text);
                setPreviewStatus('生成中...');
            }
        });
        eventSource.on(eventTypes.CHAT_COMPLETION_PROMPT_READY, (data) => {
            if (!pendingSummaryPrompt || data.dryRun)
                return;
            const chat = data.chat;
            const last = chat[chat.length - 1];
            if ((last === null || last === void 0 ? void 0 : last.role) === 'assistant') {
                chat.splice(chat.length - 1, 0, { role: 'user', content: pendingSummaryPrompt });
            }
            else {
                chat.push({ role: 'user', content: pendingSummaryPrompt });
            }
        });
        eventSource.on(eventTypes.GENERATE_AFTER_COMBINE_PROMPTS, (data) => {
            if (!pendingSummaryPrompt)
                return;
            data.prompt += '\n\n' + pendingSummaryPrompt;
        });
        eventSource.on(eventTypes.GENERATION_ENDED, async () => {
            pendingSummaryPrompt = null;
            isContinueGeneration = false;
            if (!session.pendingPreview)
                return;
            session.pendingPreview = false;
            await delay(200);
            updatePreviewFromLatestMessage();
            updateContinueBtnState();
        });
        eventSource.on(eventTypes.GENERATION_STOPPED, () => {
            pendingSummaryPrompt = null;
            isContinueGeneration = false;
            if (!session.pendingPreview)
                return;
            session.pendingPreview = false;
            setPreviewStatus('生成已停止');
            updateContinueBtnState();
        });
    }
    // ── 预设管理 ──────────────────────────────────────────────────────────────
    function getAllPresets() {
        return presets;
    }
    function refreshPresetSelect() {
        const sel = document.getElementById('cpr-presets');
        if (!sel)
            return;
        const all = getAllPresets();
        const prev = sel.value;
        sel.innerHTML = '<option value="">— 选择预设 —</option>';
        all.forEach((p, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = p.name;
            sel.appendChild(opt);
        });
        if (Array.from(sel.options).some(o => o.value === prev))
            sel.value = prev;
    }
    function applyPreset() {
        const sel = document.getElementById('cpr-presets');
        const ta = document.getElementById('cpr-prompt');
        if (!(sel === null || sel === void 0 ? void 0 : sel.value) || !ta)
            return;
        const idx = parseInt(sel.value, 10);
        if (!isNaN(idx) && presets[idx]) {
            ta.value = presets[idx].prompt;
            persistState();
        }
    }
    function newPreset() {
        const ta = document.getElementById('cpr-prompt');
        const sel = document.getElementById('cpr-presets');
        if (sel)
            sel.value = '';
        if (ta) {
            ta.value = '';
            ta.focus();
        }
        persistState();
    }
    function savePreset() {
        var _a, _b;
        const ta = document.getElementById('cpr-prompt');
        const prompt = (_b = (_a = ta === null || ta === void 0 ? void 0 : ta.value) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : '';
        if (!prompt) {
            if (typeof toastr !== 'undefined')
                toastr.warning('提示词为空，无法保存。', '总结的总结');
            return;
        }
        const name = window.prompt('请输入预设名称：', '');
        if (!(name === null || name === void 0 ? void 0 : name.trim()))
            return;
        const trimmed = name.trim();
        const existing = presets.findIndex(p => p.name === trimmed);
        if (existing >= 0) {
            if (!window.confirm(`预设「${trimmed}」已存在，是否覆盖？`))
                return;
            presets[existing].prompt = prompt;
        }
        else {
            presets.push({ name: trimmed, prompt });
        }
        saveSetting(SK_PRESETS, presets);
        refreshPresetSelect();
        if (typeof toastr !== 'undefined')
            toastr.success(`已保存预设「${trimmed}」。`, '总结的总结', { timeOut: 2000 });
    }
    function deletePreset() {
        const sel = document.getElementById('cpr-presets');
        if (!(sel === null || sel === void 0 ? void 0 : sel.value)) {
            if (typeof toastr !== 'undefined')
                toastr.warning('请先选择要删除的预设。', '总结的总结');
            return;
        }
        const idx = parseInt(sel.value, 10);
        if (isNaN(idx) || !presets[idx])
            return;
        if (!window.confirm(`确定删除预设「${presets[idx].name}」？`))
            return;
        presets.splice(idx, 1);
        saveSetting(SK_PRESETS, presets);
        refreshPresetSelect();
        if (typeof toastr !== 'undefined')
            toastr.success('预设已删除。下次刷新将自动恢复内置预设。', '总结的总结', { timeOut: 2500 });
    }
    // ── 状态持久化 ────────────────────────────────────────────────────────────
    function persistState() {
        const ta = document.getElementById('cpr-prompt');
        if (ta)
            saveSetting(SK_PROMPT, ta.value);
        saveSetting(SK_OUT_BOOKNAME, getInputVal('cpr-out-bookname'));
        saveSetting(SK_OUT_ENTRYNAME, getInputVal('cpr-out-entryname'));
        saveSetting(SK_BROWSE_BOOKNAME, getInputVal('cpr-browse-bookname'));
        const wm = document.querySelector('input[name="cpr-write-mode"]:checked');
        if (wm)
            saveSetting(SK_WRITE_MODE, wm.value);
        const extract = document.getElementById('cpr-wi-extract');
        if (extract)
            saveSetting(SK_WI_EXTRACT, extract.checked ? 'true' : 'false');
        saveSetting(SK_WI_EXTRACT_MODE, getExtractMode());
        saveSetting(SK_WI_EXTRACT_CUSTOM, getInputVal('cpr-wi-extract-custom'));
        saveSetting(SK_WI_DEPTH, getInputVal('cpr-wi-depth'));
    }
    function restoreState() {
        var _a, _b, _c, _d, _e, _f;
        const ta = document.getElementById('cpr-prompt');
        if (ta)
            ta.value = (_a = loadSetting(SK_PROMPT)) !== null && _a !== void 0 ? _a : '';
        const outEntry = document.getElementById('cpr-out-entryname');
        if (outEntry)
            outEntry.value = (_b = loadSetting(SK_OUT_ENTRYNAME)) !== null && _b !== void 0 ? _b : '档案压缩';
        const savedWriteMode = (_c = loadSetting(SK_WRITE_MODE)) !== null && _c !== void 0 ? _c : 'overwrite';
        const writeModeEl = document.querySelector(`input[name="cpr-write-mode"][value="${savedWriteMode}"]`);
        if (writeModeEl)
            writeModeEl.checked = true;
        const extract = document.getElementById('cpr-wi-extract');
        if (extract)
            extract.checked = loadSetting(SK_WI_EXTRACT) !== 'false';
        const extractMode = document.getElementById('cpr-wi-extract-mode');
        if (extractMode)
            extractMode.value = (_d = loadSetting(SK_WI_EXTRACT_MODE)) !== null && _d !== void 0 ? _d : 'thinking';
        const extractCustom = document.getElementById('cpr-wi-extract-custom');
        if (extractCustom)
            extractCustom.value = (_e = loadSetting(SK_WI_EXTRACT_CUSTOM)) !== null && _e !== void 0 ? _e : '';
        const wiDepthEl = document.getElementById('cpr-wi-depth');
        if (wiDepthEl)
            wiDepthEl.value = (_f = loadSetting(SK_WI_DEPTH)) !== null && _f !== void 0 ? _f : '9999';
        toggleCustomExtractInput();
    }
    // ── 自定义事件监听 ────────────────────────────────────────────────────────
    document.addEventListener(`${EVENT_NS}execute`, () => { executeCompression(); });
    document.addEventListener(`${EVENT_NS}confirmPreview`, () => { finalizeToWorldInfo(); });
    document.addEventListener(`${EVENT_NS}reroll`, () => { rerollCompression(); });
    document.addEventListener(`${EVENT_NS}continue`, () => { continueCompression(); });
    document.addEventListener(`${EVENT_NS}refreshEntries`, () => {
        const sel = document.getElementById('cpr-browse-bookname');
        if (sel === null || sel === void 0 ? void 0 : sel.value) {
            saveSetting(SK_BROWSE_BOOKNAME, sel.value);
            loadBrowseEntries(sel.value);
        }
    });
    document.addEventListener(`${EVENT_NS}addChecked`, () => { addCheckedEntries(); });
    document.addEventListener(`${EVENT_NS}clearAll`, () => { clearAllEntries(); });
    document.addEventListener(`${EVENT_NS}toggleCheckAll`, () => { toggleCheckAll(); });
    document.addEventListener(`${EVENT_NS}applyPreset`, () => { applyPreset(); });
    document.addEventListener(`${EVENT_NS}newPreset`, () => { newPreset(); });
    document.addEventListener(`${EVENT_NS}savePreset`, () => { savePreset(); });
    document.addEventListener(`${EVENT_NS}deletePreset`, () => { deletePreset(); });
    // ── 实时持久化 ────────────────────────────────────────────────────────────
    document.addEventListener('change', (e) => {
        var _a;
        const target = e.target;
        if ((_a = target === null || target === void 0 ? void 0 : target.closest) === null || _a === void 0 ? void 0 : _a.call(target, '.cpr-container'))
            persistState();
    });
    document.addEventListener('input', (e) => {
        const target = e.target;
        if ((target === null || target === void 0 ? void 0 : target.id) === 'cpr-wi-extract-mode')
            toggleCustomExtractInput();
    });
    // ── 初始化 ────────────────────────────────────────────────────────────────
    function tryInit(retry = 0) {
        try {
            if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
                throw new Error('SillyTavern 上下文尚未就绪');
            }
            const ctx = SillyTavern.getContext();
            if (!ctx)
                throw new Error('getContext() 返回空值');
            // 加载持久化数据
            entries = loadSettingJSON(SK_ENTRIES, []);
            presets = loadSettingJSON(SK_PRESETS, []);
            // 清理已移除的内置预设
            presets = presets.filter(p => !REMOVED_DEFAULTS.includes(p.name));
            // 内置预设强制同步（覆盖同名旧内容，补充缺失项），用户自定义预设不受影响
            DEFAULT_PRESETS.forEach(def => {
                const idx = presets.findIndex(p => p.name === def.name);
                if (idx >= 0) {
                    if (presets[idx].prompt !== def.prompt)
                        presets[idx].prompt = def.prompt;
                }
                else {
                    presets.unshift(Object.assign({}, def));
                }
            });
            saveSetting(SK_PRESETS, presets);
            restoreState();
            refreshPresetSelect();
            renderEntryList();
            loadWorldBookNames();
            bindGenerationEvents();
            console.log(`${LOG_PREFIX} 初始化完成，条目: ${entries.length}，自定义预设: ${presets.length}`);
        }
        catch (err) {
            if (retry < 10) {
                setTimeout(() => tryInit(retry + 1), 600);
            }
            else {
                console.error(`${LOG_PREFIX} 初始化失败，已放弃:`, err);
            }
        }
    }
    tryInit();
})();
