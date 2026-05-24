/**
 * 总结 — 功能模块
 *
 * 职责：
 *   - A 总结提示词（自定义、多套预设保存/加载/删除）
 *   - B 思维链 CoT（可独立开关、独立预设）
 *   - C 启动方式（AI助手身份 / User身份 / System身份）
 *   - 楼层范围选择（仅告知 AI 关注指定范围）
 *   - 使用 SillyTavern.getContext().setExtensionPrompt() 进行不可见注入
 *   - ephemeral：生成结束后自动清除注入
 *
 * 编译目标：ES2017，module: none
 */
(function () {
    'use strict';
    if (window.self !== window.top)
        return;
    const INIT_FLAG = '__smry_summary_loaded__';
    if (window[INIT_FLAG]) {
        console.log('[总结] 模块已存在，跳过重复初始化');
        return;
    }
    window[INIT_FLAG] = true;
    const LOG_PREFIX = '[总结]';
    const EVENT_NS = 'Summary_';
    // ── localStorage 键名 ────────────────────────────────────────────────────
    const SK_PRESETS_A = 'smry_presets_a';
    const SK_PROMPT_A = 'smry_prompt_a';
    const SK_TRIGGER_TXT = 'smry_trigger_text';
    const SK_START_FLOOR = 'smry_start_floor';
    const SK_END_FLOOR = 'smry_end_floor';
    const SK_WI_ENABLED = 'smry_wi_enabled';
    const SK_WI_BOOKNAME = 'smry_wi_bookname';
    const SK_WI_ENTRY = 'smry_wi_entry';
    const SK_WI_MODE = 'smry_wi_mode';
    const SK_WI_EXTRACT = 'smry_wi_extract';
    const SK_WI_EXTRACT_MODE = 'smry_wi_extract_mode';
    const SK_WI_EXTRACT_CUSTOM = 'smry_wi_extract_custom';
    const SK_HIDE_SOURCE = 'smry_hide_source';
    const SK_WI_DEPTH = 'smry_wi_depth';
    // ── SillyTavern extension_prompt_types 数值 ──────────────────────────────
    const POS_IN_PROMPT = 0; // "after"  : 主提示词末尾（系统区，玩家不可见）
    const POS_IN_CHAT = 1; // "chat"   : 聊天历史中（指定 depth，玩家不可见）
    // ── SillyTavern extension_prompt_roles 数值 ──────────────────────────────
    const ROLE_SYSTEM = 0;
    const ROLE_USER = 1;
    const ROLE_ASSISTANT = 2;
    // ── 注入 key 前缀（与 ST 内部 SCRIPT_PROMPT_KEY 匹配） ───────────────────
    const INJECT_KEY_AB = 'smry-context'; // A+B 内容
    const INJECT_KEY_LAUNCH = 'smry-launch'; // C 触发
    const INJECT_KEY_USER = 'smry-user-pad'; // assistant 模式前置 user 占位
    let presets_a = [];
    let pendingSummaryPrompt = null;
    let activeSummaryPrompt = null;
    let isContinueGeneration = false;
    let summarySession = {
        start: 0,
        end: 0,
        generatedMessageId: null,
        pendingPreview: false,
        hiddenForSummary: [],
        floorsHidden: false,
    };
    // ── 内置预设（首次加载时自动填充） ────────────────────────────────────────
    const DEFAULT_PRESETS = [
        {
            name: 'Janus-灵魂典藏馆',
            prompt: `Janus, pause all narrative and role-playing. **Generate incremental [Soul Archives] covering ONLY new events since the last archive update.** Based on <soul_world> + <chat_history> content, generate [Soul Archives].

**Process (<thinking> must be strictly generated):**
1. Identify and list ALL characters appeared story content above, totaling N characters that need processing
2. Commit to generating complete archives for ALL N characters in this single response
3. Commit to strictly following [Core Principles] and [Archive Format], with no omissions of any parts
4. Plan batch processing strategy: Generate in groups of 5 characters with brief reflection between batches to maintain quality
5. Commit that the janusdiary block output immediately after </thinking> will contain only complete archives for all characters

---[Core Principles][Soul Archive Format]need not be output or reflected in <thinking>---

**[Core Principles]**
1. Strictly third-person perspective, record only objective facts, prohibit subjective speculation and emotional rendering
2. Must create archives for all named characters or characters with clear designations that appear
3. All information must have direct/indirect basis from original content
4. All character archives must completely include all parts of the standard format, with no omissions

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

<!-- 已完成[M+X]/N个角色，还需继续生成剩余(N-(M+X))个角色。我会保持相同的质量标准和详细程度，确保每个角色的档案都完整包含所有必要部分。接下来处理: [具体角色名1, 角色名2, 角色名3, 角色名4, 角色名5] -->

[角色6]
...

[5个一组循环直到所有角色档案生成]

**[已完成[M+X]/N个角色，全部角色档案生成完成]**
</janusdiary>

现在开始总结：`
        },
        {
            name: '打工喵',
            prompt: `现在停止生成任何正文创作！请调取上下文所有记录，执行阶段性剧情归档总结。

必须遵循以下记录格式：

【总结】

- [时间]: {在此客观记录该阶段的核心事件与对话，禁止文学化修辞，禁止描述角色心情。字数不少于100字。重点描述：发生了什么关键冲突、角色做出了什么核心决策、以及环境的变化。}
- [时间]: {……}

- [待完成事件]: {仅保留至目前为止仍处于"进行中"或"未触发"状态的计划/约定。}
- [重要物品]: {清点目前角色随身携带或存放在特定位置的关键道具，注明归属权。}
- [角色成长]: {对比故事开始时，分析各角色（A、B...）在性格、认知或情感关系上的实质性变化，并引用具体事件作为论据，客观记录，禁止文学化修辞，禁止描述角色心情}

————

总结要求:
1. 逻辑重于流水账：合并细碎的对话日常，聚焦于能够推动剧情发展或改变角色的【关键事件】。
2. 杜绝虚假描写：事件描述必须基于已发生的客观事实，禁止添加未发生的心理猜测。
3. 动态关联：确保[角色成长]与上文提到的[时间段事件]有明确的因果关系。

现在开始总结：`
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
    function setPreviewStatus(text) {
        const el = document.getElementById('smry-preview-status');
        if (el)
            el.textContent = text;
    }
    function setPreviewText(text) {
        const el = document.getElementById('smry-preview');
        if (el)
            el.value = text;
    }
    function getPreviewText() {
        return getInputVal('smry-preview').trim();
    }
    function toggleCustomExtractInput() {
        const mode = getExtractMode();
        const el = document.getElementById('smry-wi-extract-custom');
        if (!el)
            return;
        el.style.display = mode === 'custom' ? '' : 'none';
    }
    // ── 注入管理（使用 ST Context API，无特殊字符解析问题） ────────────────────
    /**
     * 向 AI 上下文注入内容（玩家不可见）。
     * position=POS_IN_PROMPT：插入到主提示词末尾（"预设的最尾部"）。
     */
    function injectContextPrompt(key, content, ephemeral) {
        const ctx = getCtx();
        if (typeof ctx.setExtensionPrompt !== 'function') {
            console.error(`${LOG_PREFIX} setExtensionPrompt 不可用，降级为斜杠命令注入`);
            return;
        }
        const prefixed = `script_inject_${key}`;
        ctx.setExtensionPrompt(prefixed, content, POS_IN_CHAT, 0, false, ROLE_USER);
        console.log(`${LOG_PREFIX} 已注入提示词 [${key}]，长度 ${content.length} 字符`);
        if (ephemeral) {
            scheduleEphemeralCleanup(key, POS_IN_CHAT, ROLE_USER);
        }
    }
    /**
     * 向聊天历史末尾（depth=0）注入触发消息（玩家不可见）。
     * 用于 system / assistant 启动模式。
     */
    function injectChatTrigger(key, content, role, ephemeral) {
        const ctx = getCtx();
        if (typeof ctx.setExtensionPrompt !== 'function') {
            console.error(`${LOG_PREFIX} setExtensionPrompt 不可用`);
            return;
        }
        const prefixed = `script_inject_${key}`;
        ctx.setExtensionPrompt(prefixed, content, POS_IN_CHAT, 0, false, role);
        console.log(`${LOG_PREFIX} 已注入聊天触发 [${key}] role=${role}`);
        if (ephemeral) {
            scheduleEphemeralCleanup(key, POS_IN_CHAT, role);
        }
    }
    /** 注册 ephemeral 清理：生成结束或中止后自动移除注入 */
    function scheduleEphemeralCleanup(key, position, role) {
        var _a;
        const ctx = getCtx();
        const eventSource = ctx.eventSource;
        const eventTypes = (_a = ctx.eventTypes) !== null && _a !== void 0 ? _a : ctx.event_types;
        if (!eventSource || !eventTypes) {
            console.warn(`${LOG_PREFIX} eventSource 不可用，10s 后回退清理 [${key}]`);
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
    // ── 生成触发（/trigger 斜杠命令） ─────────────────────────────────────────
    function callSlashCommand(cmd) {
        const ta = document.querySelector('#send_textarea');
        const btn = document.querySelector('#send_but');
        if (!ta || !btn) {
            console.error(`${LOG_PREFIX} 找不到输入框或发送按钮`);
            if (typeof toastr !== 'undefined')
                toastr.error('找不到 SillyTavern 输入框或发送按钮。', '总结');
            return;
        }
        ta.value = cmd;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        btn.click();
        console.log(`${LOG_PREFIX} 已执行: ${cmd}`);
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
            console.warn(`${LOG_PREFIX} executeSlashCommandsWithOptions 失败，降级:`, err);
            callSlashCommand('/trigger');
        }
    }
    // ── UI 辅助 ───────────────────────────────────────────────────────────────
    function getStartFloor() {
        const v = getInputVal('smry-start-floor').trim();
        return v !== '' ? v : '0';
    }
    function getEndFloor() {
        const v = getInputVal('smry-end-floor').trim();
        return v !== '' ? v : '{{lastMessageId}}';
    }
    function getRangeNumbers() {
        const ctx = getCtx();
        const chatLength = Array.isArray(ctx.chat) ? Math.max(ctx.chat.length - 1, 0) : 0;
        const startRaw = getInputVal('smry-start-floor').trim();
        const endRaw = getInputVal('smry-end-floor').trim();
        const start = startRaw === '' ? 0 : parseInt(startRaw, 10);
        const end = endRaw === '' ? chatLength : parseInt(endRaw, 10);
        if (isNaN(start) || isNaN(end) || start < 0 || end < 0) {
            throw new Error('请输入有效的楼层范围。');
        }
        return start <= end ? { start, end } : { start: end, end: start };
    }
    // ── 世界书辅助 ────────────────────────────────────────────────────────────
    function getWiBookName() {
        return getInputVal('smry-wi-bookname').trim();
    }
    function getWiEntryName() {
        return getInputVal('smry-wi-entryname').trim() || '前情概要';
    }
    function getWiMode() {
        const r = document.querySelector('input[name="smry-wi-mode"]:checked');
        return ((r === null || r === void 0 ? void 0 : r.value) === 'append') ? 'append' : 'overwrite';
    }
    function isWiExtractEnabled() {
        var _a, _b;
        return (_b = (_a = document.getElementById('smry-wi-extract')) === null || _a === void 0 ? void 0 : _a.checked) !== null && _b !== void 0 ? _b : true;
    }
    function getExtractMode() {
        var _a;
        const el = document.getElementById('smry-wi-extract-mode');
        return ((_a = el === null || el === void 0 ? void 0 : el.value) !== null && _a !== void 0 ? _a : 'thinking');
    }
    function getCustomExtractTags() {
        return getInputVal('smry-wi-extract-custom')
            .split(',')
            .map(v => v.trim())
            .filter(Boolean);
    }
    function shouldHideSourceFloors() {
        var _a, _b;
        return (_b = (_a = document.getElementById('smry-hide-source')) === null || _a === void 0 ? void 0 : _a.checked) !== null && _b !== void 0 ? _b : true;
    }
    async function getWiApi() {
        return Function('return import("/scripts/world-info.js")')();
    }
    async function populateWorldBookSelect() {
        var _a;
        const sel = document.getElementById('smry-wi-bookname');
        if (!sel)
            return;
        const saved = (_a = loadSetting(SK_WI_BOOKNAME)) !== null && _a !== void 0 ? _a : '';
        try {
            const wiMod = await getWiApi();
            const names = Array.isArray(wiMod.world_names) ? wiMod.world_names : [];
            sel.innerHTML = '<option value="">未选择</option>';
            names.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                sel.appendChild(opt);
            });
            if (saved)
                sel.value = saved;
        }
        catch (err) {
            console.warn(`${LOG_PREFIX} 无法获取世界书列表`, err);
            sel.innerHTML = '<option value="">加载失败</option>';
            if (saved) {
                const opt = document.createElement('option');
                opt.value = saved;
                opt.textContent = saved;
                sel.appendChild(opt);
                sel.value = saved;
            }
        }
    }
    /** Auto-detect the world book bound to the current character */
    function detectCharacterWorldBook() {
        var _a, _b, _c, _d;
        const ctx = getCtx();
        const chid = ctx.characterId;
        if (chid === null || chid === undefined)
            return null;
        return ((_d = (_c = (_b = (_a = ctx.characters) === null || _a === void 0 ? void 0 : _a[chid]) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.extensions) === null || _d === void 0 ? void 0 : _d.world) || null;
    }
    /** Remove <thinking>...</thinking> blocks entirely; all other tags are kept as-is. */
    function cleanAiResponse(text) {
        const tags = isWiExtractEnabled()
            ? (() => {
                const mode = getExtractMode();
                if (mode === 'thinking')
                    return ['thinking'];
                if (mode === 'think')
                    return ['think'];
                if (mode === 'custom')
                    return getCustomExtractTags();
                return ['thinking'];
            })()
            : [];
        let result = text;
        for (const tag of tags) {
            const safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result = result.replace(new RegExp(`<${safeTag}>[\\s\\S]*?<\\/${safeTag}>`, 'gi'), '');
        }
        result = result.replace(/\n{3,}/g, '\n\n');
        return result.trim();
    }
    function getWiDepth() {
        const v = parseInt(getInputVal('smry-wi-depth'), 10);
        return isNaN(v) ? 9999 : Math.max(0, v);
    }
    /** Find first unused UID in a world-info data object */
    function getFreeWiUid(data) {
        if (!data || !('entries' in data))
            return null;
        for (let uid = 0; uid < 1000000; uid++) {
            if (!(uid in data.entries))
                return uid;
        }
        return null;
    }
    /** Build a minimal but valid world-info entry */
    function makeWiEntry(uid, comment, content) {
        return {
            uid,
            key: [],
            keysecondary: [],
            comment,
            content,
            constant: true,
            selective: true,
            selectiveLogic: 0,
            addMemo: false,
            order: 100,
            position: 4,
            disable: false,
            excludeRecursion: false,
            preventRecursion: false,
            delayUntilRecursion: 0,
            probability: 100,
            useProbability: true,
            depth: 9999,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: null,
            automationId: '',
            role: 0,
            sticky: null,
            cooldown: null,
            delay: null,
            triggers: [],
            vectorized: false,
            outletName: '',
            matchPersonaDescription: false,
            matchCharacterDescription: false,
            matchCharacterPersonality: false,
            matchCharacterDepthPrompt: false,
            matchScenario: false,
            matchCreatorNotes: false,
        };
    }
    function normalizeWiEntry(entry) {
        entry.constant = true;
        entry.selective = true;
        entry.position = 4;
        entry.depth = getWiDepth();
        entry.role = 0;
    }
    /**
     * Read the last AI message, optionally extract <janusdiary>, then write to world info.
     */
    async function saveToWorldInfo(contentOverride, forceOverwrite = false) {
        var _a, _b, _c;
        const ctx = getCtx();
        // ── Resolve world book name ──────────────────────────────
        let bookName = getWiBookName();
        if (!bookName) {
            bookName = (_a = detectCharacterWorldBook()) !== null && _a !== void 0 ? _a : '';
        }
        if (!bookName) {
            if (typeof toastr !== 'undefined')
                toastr.error('未能检测到世界书，请手动填写世界书名称。', '总结→世界书');
            return;
        }
        // ── Get content from last AI message ────────────────────
        let content = (_b = contentOverride === null || contentOverride === void 0 ? void 0 : contentOverride.trim()) !== null && _b !== void 0 ? _b : '';
        if (!content) {
            const chat = (_c = ctx.chat) !== null && _c !== void 0 ? _c : [];
            const lastAi = [...chat].reverse().find((m) => !m.is_user && !m.is_system);
            if (!(lastAi === null || lastAi === void 0 ? void 0 : lastAi.mes)) {
                if (typeof toastr !== 'undefined')
                    toastr.warning('找不到 AI 回复内容。', '总结→世界书');
                return;
            }
            content = lastAi.mes;
        }
        if (isWiExtractEnabled()) {
            content = cleanAiResponse(content);
        }
        // ── Load world book ──────────────────────────────────────
        let data;
        try {
            data = await ctx.loadWorldInfo(bookName);
        }
        catch (err) {
            console.error(`${LOG_PREFIX} loadWorldInfo 失败:`, err);
        }
        if (!data) {
            if (typeof toastr !== 'undefined')
                toastr.error(`世界书「${bookName}」不存在或加载失败。`, '总结→世界书');
            return;
        }
        // ── Find or create entry ─────────────────────────────────
        const entryName = getWiEntryName();
        const existingUid = Object.keys(data.entries).find((k) => data.entries[k].comment === entryName);
        if (existingUid !== undefined) {
            const entry = data.entries[existingUid];
            normalizeWiEntry(entry);
            if (getWiMode() === 'overwrite' || forceOverwrite) {
                entry.content = content;
            }
            else {
                entry.content = (entry.content ? entry.content + '\n\n---\n\n' : '') + content;
            }
            console.log(`${LOG_PREFIX} 已${getWiMode() === 'overwrite' ? '覆盖' : '追加'}条目「${entryName}」`);
        }
        else {
            const uid = getFreeWiUid(data);
            if (uid === null) {
                if (typeof toastr !== 'undefined')
                    toastr.error('无法分配条目 UID。', '总结→世界书');
                return;
            }
            data.entries[uid] = makeWiEntry(uid, entryName, content);
            normalizeWiEntry(data.entries[uid]);
            console.log(`${LOG_PREFIX} 已创建新条目「${entryName}」uid=${uid}`);
        }
        // ── Save ─────────────────────────────────────────────────
        try {
            await ctx.saveWorldInfo(bookName, data, true);
            if (typeof toastr !== 'undefined') {
                toastr.success(`已${getWiMode() === 'overwrite' ? '覆盖' : '追加'}到「${bookName}」→「${entryName}」`, '总结→世界书', { timeOut: 3000 });
            }
        }
        catch (err) {
            console.error(`${LOG_PREFIX} saveWorldInfo 失败:`, err);
            if (typeof toastr !== 'undefined')
                toastr.error('保存世界书失败，请检查控制台。', '总结→世界书');
        }
    }
    /** Group sorted indices into consecutive ranges for batch slash commands */
    function groupIntoRanges(indices) {
        if (indices.length === 0)
            return [];
        const sorted = [...indices].sort((a, b) => a - b);
        const ranges = [];
        let rangeStart = sorted[0];
        let prev = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] !== prev + 1) {
                ranges.push({ start: rangeStart, end: prev });
                rangeStart = sorted[i];
            }
            prev = sorted[i];
        }
        ranges.push({ start: rangeStart, end: prev });
        return ranges;
    }
    /** Execute a slash command asynchronously via ST context */
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
            console.warn(`${LOG_PREFIX} execSlashCmd 失败，降级: ${cmd}`, err);
            callSlashCommand(cmd);
            await delay(100);
        }
    }
    /**
     * Hide all floors OUTSIDE [start, end] for the summary session.
     * Only records floors that were currently visible, so pre-existing hidden
     * floors are not touched on restore.
     */
    async function hideFloorsForSummary(start, end) {
        var _a, _b, _c;
        const ctx = getCtx();
        const chatLength = Array.isArray(ctx.chat) ? ctx.chat.length : 0;
        if (chatLength === 0)
            return;
        const toHide = [];
        for (let i = 0; i < chatLength; i++) {
            if ((i < start || i > end) && ((_a = ctx.chat[i]) === null || _a === void 0 ? void 0 : _a.is_system) !== true && !((_c = (_b = ctx.chat[i]) === null || _b === void 0 ? void 0 : _b.extra) === null || _c === void 0 ? void 0 : _c.hidden)) {
                toHide.push(i);
            }
        }
        summarySession.hiddenForSummary = toHide;
        summarySession.floorsHidden = true;
        if (start > 0) {
            await execSlashCmd(`/hide 0-${start - 1}`);
        }
        if (end < chatLength - 1) {
            await execSlashCmd(`/hide ${end + 1}-${chatLength - 1}`);
        }
        console.log(`${LOG_PREFIX} 已隐藏范围外楼层，共 ${toHide.length} 条（${start}~${end} 保持可见）`);
    }
    /** Restore only the floors that hideFloorsForSummary hid, preserving pre-existing hidden floors. */
    async function restoreHiddenFloorsForSummary() {
        if (!summarySession.floorsHidden)
            return;
        const ranges = groupIntoRanges(summarySession.hiddenForSummary);
        for (const r of ranges) {
            await execSlashCmd(`/unhide ${r.start}-${r.end}`);
        }
        summarySession.hiddenForSummary = [];
        summarySession.floorsHidden = false;
        console.log(`${LOG_PREFIX} 已恢复总结临时隐藏楼层`);
    }
    function getLatestAiMessageInfo() {
        var _a;
        const ctx = getCtx();
        const chat = (_a = ctx.chat) !== null && _a !== void 0 ? _a : [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const message = chat[i];
            if (!(message === null || message === void 0 ? void 0 : message.is_user) && !(message === null || message === void 0 ? void 0 : message.is_system) && typeof (message === null || message === void 0 ? void 0 : message.mes) === 'string') {
                return { id: i, text: message.mes };
            }
        }
        return { id: null, text: '' };
    }
    function updatePreviewFromLatestMessage() {
        const latest = getLatestAiMessageInfo();
        if (!latest.text) {
            setPreviewStatus('未捕获到总结');
            return;
        }
        if (latest.id !== null)
            summarySession.generatedMessageId = latest.id;
        setPreviewText(cleanAiResponse(latest.text));
        setPreviewStatus('已生成，等待确认');
    }
    async function finalizeSummaryToWorldInfo() {
        activeSummaryPrompt = null;
        const preview = getPreviewText();
        if (!preview) {
            if (typeof toastr !== 'undefined')
                toastr.warning('当前没有可写入世界书的总结预览。', '总结');
            return;
        }
        const ctx = getCtx();
        await saveToWorldInfo(preview);
        if (summarySession.generatedMessageId !== null) {
            try {
                await ctx.deleteMessage(summarySession.generatedMessageId);
            }
            catch (err) {
                console.warn(`${LOG_PREFIX} 删除本次总结消息失败:`, err);
            }
        }
        await restoreHiddenFloorsForSummary();
        if (shouldHideSourceFloors()) {
            await execSlashCmd(`/hide ${summarySession.start}-${summarySession.end}`);
        }
        try {
            await ctx.saveChat();
        }
        catch (err) {
            console.warn(`${LOG_PREFIX} 保存聊天失败:`, err);
        }
        setPreviewStatus('已写入世界书');
        setPreviewText('');
        summarySession.generatedMessageId = null;
    }
    async function rerollSummary() {
        const ctx = getCtx();
        if (summarySession.generatedMessageId !== null) {
            try {
                await ctx.deleteMessage(summarySession.generatedMessageId);
            }
            catch (err) {
                console.warn(`${LOG_PREFIX} 删除旧总结消息失败:`, err);
            }
        }
        setPreviewText('');
        setPreviewStatus('正在重ROLL');
        summarySession.generatedMessageId = null;
        await executeSummary(true);
    }
    function clearPreview() {
        activeSummaryPrompt = null;
        setPreviewText('');
        setPreviewStatus('待生成');
        summarySession.generatedMessageId = null;
        updateContinueBtnState();
        if (summarySession.floorsHidden) {
            restoreHiddenFloorsForSummary();
        }
    }
    async function continueSummary() {
        if (summarySession.generatedMessageId === null) {
            if (typeof toastr !== 'undefined')
                toastr.warning('尚无可继续的生成。', '总结');
            return;
        }
        setPreviewStatus('继续生成中...');
        summarySession.pendingPreview = true;
        isContinueGeneration = true;
        updateContinueBtnState();
        await execSlashCmd('/continue');
    }
    function updateContinueBtnState() {
        const btn = document.getElementById('smry-continue-btn');
        if (btn)
            btn.disabled = summarySession.generatedMessageId === null;
    }
    function bindSummaryEvents() {
        var _a;
        const ctx = getCtx();
        const eventSource = ctx.eventSource;
        const eventTypes = (_a = ctx.eventTypes) !== null && _a !== void 0 ? _a : ctx.event_types;
        if (!eventSource || !eventTypes)
            return;
        eventSource.on(eventTypes.STREAM_TOKEN_RECEIVED, (text) => {
            if (!summarySession.pendingPreview || typeof text !== 'string')
                return;
            if (isContinueGeneration) {
                setPreviewStatus('继续生成中...');
                return;
            }
            const el = document.getElementById('smry-preview');
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
            if (!summarySession.pendingPreview)
                return;
            summarySession.pendingPreview = false;
            await delay(200);
            updatePreviewFromLatestMessage();
            updateContinueBtnState();
        });
        eventSource.on(eventTypes.GENERATION_STOPPED, () => {
            pendingSummaryPrompt = null;
            isContinueGeneration = false;
            if (!summarySession.pendingPreview)
                return;
            summarySession.pendingPreview = false;
            setPreviewStatus('生成已停止');
            updateContinueBtnState();
        });
    }
    // ── 核心执行 ──────────────────────────────────────────────────────────────
    async function executeSummary(isReroll = false) {
        const promptA = getInputVal('smry-prompt-a').trim();
        if (!promptA) {
            if (typeof toastr !== 'undefined')
                toastr.warning('请填写总结提示词。', '总结');
            return;
        }
        let range;
        try {
            range = getRangeNumbers();
        }
        catch (err) {
            if (typeof toastr !== 'undefined')
                toastr.warning(err.message, '总结');
            return;
        }
        setPreviewText('');
        setPreviewStatus(isReroll ? '正在重ROLL' : '生成中');
        if (!isReroll)
            summarySession.generatedMessageId = null;
        // 构建注入内容（包含楼层范围说明）
        const floorNote = `「当前总结范围：第 ${range.start} 楼 ～ 第 ${range.end} 楼，请仅基于此范围内的聊天记录进行总结」`;
        const fullPrompt = `${floorNote}\n\n${promptA}`;
        // 通过事件钩子将提示词追加到上下文最末尾（在 JB/PHI 之后）
        pendingSummaryPrompt = fullPrompt;
        activeSummaryPrompt = fullPrompt;
        // 首次执行：隐藏范围外楼层，使 AI 上下文仅包含 X~Y
        if (!isReroll) {
            if (summarySession.floorsHidden) {
                await restoreHiddenFloorsForSummary();
            }
            summarySession.start = range.start;
            summarySession.end = range.end;
            await hideFloorsForSummary(range.start, range.end);
        }
        summarySession.pendingPreview = true;
        if (typeof toastr !== 'undefined') {
            toastr.info(`总结已启动（楼层 ${range.start} ～ ${range.end}）`, '总结', { timeOut: 4000 });
        }
        // 等待注入生效
        await delay(200);
        await triggerGeneration();
        console.log(`${LOG_PREFIX} 执行完成 [${range.start}~${range.end}]`);
    }
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    // ── 预设管理 ──────────────────────────────────────────────────────────────
    function refreshPresetSelect(section) {
        const sel = document.getElementById('smry-presets-a');
        if (!sel)
            return;
        const presets = presets_a;
        const prev = sel.value;
        sel.innerHTML = '<option value="">— 选择总结 —</option>';
        presets.forEach((p, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = p.name;
            sel.appendChild(opt);
        });
        if (Array.from(sel.options).some(o => o.value === prev))
            sel.value = prev;
    }
    function newPreset(section) {
        const ta = document.getElementById('smry-prompt-a');
        const sel = document.getElementById('smry-presets-a');
        if (sel)
            sel.value = '';
        if (ta) {
            ta.value = '';
            ta.focus();
        }
        persistState();
    }
    function savePreset(section) {
        var _a, _b, _c;
        const textareaId = 'smry-prompt-a';
        const storageKey = SK_PRESETS_A;
        const presets = presets_a;
        const prompt = (_c = (_b = (_a = document.getElementById(textareaId)) === null || _a === void 0 ? void 0 : _a.value) === null || _b === void 0 ? void 0 : _b.trim()) !== null && _c !== void 0 ? _c : '';
        if (!prompt) {
            if (typeof toastr !== 'undefined')
                toastr.warning('提示词为空，无法保存。', '总结');
            return;
        }
        const name = window.prompt('请输入总结名称：', '');
        if (!(name === null || name === void 0 ? void 0 : name.trim()))
            return;
        const trimmed = name.trim();
        if (DEFAULT_PRESETS.some(d => d.name === trimmed)) {
            if (typeof toastr !== 'undefined')
                toastr.warning(`「${trimmed}」是内置总结名称，请使用其他名称保存。`, '总结');
            return;
        }
        const existing = presets.findIndex(p => p.name === trimmed);
        if (existing >= 0) {
            if (!window.confirm(`总结「${trimmed}」已存在，是否覆盖？`))
                return;
            presets[existing].prompt = prompt;
        }
        else {
            presets.push({ name: trimmed, prompt });
        }
        saveSetting(storageKey, presets);
        refreshPresetSelect(section);
        if (typeof toastr !== 'undefined')
            toastr.success(`已保存总结「${trimmed}」。`, '总结', { timeOut: 2000 });
    }
    function deletePreset(section) {
        const selectId = 'smry-presets-a';
        const storageKey = SK_PRESETS_A;
        const presets = presets_a;
        const sel = document.getElementById(selectId);
        if (!(sel === null || sel === void 0 ? void 0 : sel.value)) {
            if (typeof toastr !== 'undefined')
                toastr.warning('请先选择要删除的总结。', '总结');
            return;
        }
        const idx = parseInt(sel.value, 10);
        if (isNaN(idx) || idx < 0 || idx >= presets.length)
            return;
        if (!window.confirm(`确定删除总结「${presets[idx].name}」？`))
            return;
        presets.splice(idx, 1);
        saveSetting(storageKey, presets);
        refreshPresetSelect(section);
        if (typeof toastr !== 'undefined')
            toastr.success('总结已删除。', '总结', { timeOut: 2000 });
    }
    function applyPreset(section) {
        const selectId = 'smry-presets-a';
        const textareaId = 'smry-prompt-a';
        const presets = presets_a;
        const sel = document.getElementById(selectId);
        const ta = document.getElementById(textareaId);
        if (!(sel === null || sel === void 0 ? void 0 : sel.value) || !ta)
            return;
        const idx = parseInt(sel.value, 10);
        if (!isNaN(idx) && presets[idx]) {
            ta.value = presets[idx].prompt;
            persistState();
        }
    }
    // ── 状态持久化 ────────────────────────────────────────────────────────────
    function persistState() {
        saveSetting(SK_PROMPT_A, getInputVal('smry-prompt-a'));
        saveSetting(SK_START_FLOOR, getInputVal('smry-start-floor'));
        saveSetting(SK_END_FLOOR, getInputVal('smry-end-floor'));
        // 世界书设置
        saveSetting(SK_WI_BOOKNAME, getInputVal('smry-wi-bookname'));
        saveSetting(SK_WI_ENTRY, getInputVal('smry-wi-entryname'));
        const wiMode = document.querySelector('input[name="smry-wi-mode"]:checked');
        if (wiMode)
            saveSetting(SK_WI_MODE, wiMode.value);
        const wiExt = document.getElementById('smry-wi-extract');
        if (wiExt)
            saveSetting(SK_WI_EXTRACT, wiExt.checked ? 'true' : 'false');
        saveSetting(SK_WI_EXTRACT_MODE, getExtractMode());
        saveSetting(SK_WI_EXTRACT_CUSTOM, getInputVal('smry-wi-extract-custom'));
        const hideSource = document.getElementById('smry-hide-source');
        if (hideSource)
            saveSetting(SK_HIDE_SOURCE, hideSource.checked ? 'true' : 'false');
        saveSetting(SK_WI_DEPTH, getInputVal('smry-wi-depth'));
    }
    function restoreState() {
        var _a, _b, _c;
        const set = (id, key, fallback = '') => {
            var _a;
            const el = document.getElementById(id);
            if (el)
                el.value = (_a = loadSetting(key)) !== null && _a !== void 0 ? _a : fallback;
        };
        set('smry-prompt-a', SK_PROMPT_A);
        set('smry-start-floor', SK_START_FLOOR);
        set('smry-end-floor', SK_END_FLOOR);
        // 预设列表：内置预设强制同步（覆盖同名旧内容，补充缺失项），用户预设不受影响
        presets_a = loadSettingJSON(SK_PRESETS_A, []);
        let defaultsChanged = false;
        DEFAULT_PRESETS.forEach(def => {
            const idx = presets_a.findIndex(p => p.name === def.name);
            if (idx >= 0) {
                if (presets_a[idx].prompt !== def.prompt) {
                    presets_a[idx].prompt = def.prompt;
                    defaultsChanged = true;
                }
            }
            else {
                presets_a.unshift(Object.assign({}, def));
                defaultsChanged = true;
            }
        });
        if (defaultsChanged) {
            saveSetting(SK_PRESETS_A, presets_a);
        }
        refreshPresetSelect('A');
        // 世界书设置（bookname 由 populateWorldBookSelect 异步处理）
        const savedEntry = loadSetting(SK_WI_ENTRY);
        const wiEntryEl = document.getElementById('smry-wi-entryname');
        if (wiEntryEl && savedEntry !== null)
            wiEntryEl.value = savedEntry;
        const savedMode = (_a = loadSetting(SK_WI_MODE)) !== null && _a !== void 0 ? _a : 'overwrite';
        const wiModeEl = document.querySelector(`input[name="smry-wi-mode"][value="${savedMode}"]`);
        if (wiModeEl)
            wiModeEl.checked = true;
        const wiExtEl = document.getElementById('smry-wi-extract');
        if (wiExtEl)
            wiExtEl.checked = loadSetting(SK_WI_EXTRACT) !== 'false';
        const extractModeEl = document.getElementById('smry-wi-extract-mode');
        if (extractModeEl)
            extractModeEl.value = (_b = loadSetting(SK_WI_EXTRACT_MODE)) !== null && _b !== void 0 ? _b : 'thinking';
        set('smry-wi-extract-custom', SK_WI_EXTRACT_CUSTOM);
        const hideSourceEl = document.getElementById('smry-hide-source');
        if (hideSourceEl)
            hideSourceEl.checked = loadSetting(SK_HIDE_SOURCE) !== 'false';
        const wiDepthEl = document.getElementById('smry-wi-depth');
        if (wiDepthEl)
            wiDepthEl.value = (_c = loadSetting(SK_WI_DEPTH)) !== null && _c !== void 0 ? _c : '9999';
        toggleCustomExtractInput();
        clearPreview();
    }
    // ── 自定义事件监听 ────────────────────────────────────────────────────────
    document.addEventListener(`${EVENT_NS}execute`, () => { executeSummary(); });
    document.addEventListener(`${EVENT_NS}savePresetA`, () => savePreset('A'));
    document.addEventListener(`${EVENT_NS}newPresetA`, () => newPreset('A'));
    document.addEventListener(`${EVENT_NS}deletePresetA`, () => deletePreset('A'));
    document.addEventListener(`${EVENT_NS}applyPresetA`, () => applyPreset('A'));
    document.addEventListener(`${EVENT_NS}resetFloors`, () => {
        const s = document.getElementById('smry-start-floor');
        const e = document.getElementById('smry-end-floor');
        if (s)
            s.value = '';
        if (e)
            e.value = '';
        persistState();
    });
    document.addEventListener(`${EVENT_NS}confirmPreview`, () => { finalizeSummaryToWorldInfo(); });
    document.addEventListener(`${EVENT_NS}reroll`, () => { rerollSummary(); });
    document.addEventListener(`${EVENT_NS}continue`, () => { continueSummary(); });
    document.addEventListener(`${EVENT_NS}detectWorldBook`, () => {
        const detected = detectCharacterWorldBook();
        const el = document.getElementById('smry-wi-bookname');
        if (detected && el) {
            if (!Array.from(el.options).some(o => o.value === detected)) {
                const opt = document.createElement('option');
                opt.value = detected;
                opt.textContent = detected;
                el.appendChild(opt);
            }
            el.value = detected;
            persistState();
            if (typeof toastr !== 'undefined')
                toastr.success(`检测到世界书：${detected}`, '总结→世界书', { timeOut: 2500 });
        }
        else {
            if (typeof toastr !== 'undefined')
                toastr.warning('未检测到绑定的世界书，请手动填写。', '总结→世界书');
        }
    });
    // ── 初始化（含重试） ──────────────────────────────────────────────────────
    function tryInit(retry = 0) {
        var _a;
        try {
            if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
                throw new Error('SillyTavern 上下文尚未就绪');
            }
            const ctx = SillyTavern.getContext();
            if (!ctx)
                throw new Error('getContext() 返回空值');
            restoreState();
            populateWorldBookSelect();
            bindSummaryEvents();
            // 自动持久化
            ['smry-prompt-a'].forEach(id => { var _a; return (_a = document.getElementById(id)) === null || _a === void 0 ? void 0 : _a.addEventListener('input', persistState); });
            ['smry-start-floor', 'smry-end-floor', 'smry-trigger-text',
                'smry-wi-bookname', 'smry-wi-entryname', 'smry-wi-extract-custom', 'smry-wi-depth'].forEach(id => { var _a; return (_a = document.getElementById(id)) === null || _a === void 0 ? void 0 : _a.addEventListener('change', persistState); });
            ['smry-wi-extract', 'smry-hide-source'].forEach(id => { var _a; return (_a = document.getElementById(id)) === null || _a === void 0 ? void 0 : _a.addEventListener('change', persistState); });
            document.querySelectorAll('input[name="smry-wi-mode"]').forEach(r => r.addEventListener('change', persistState));
            (_a = document.getElementById('smry-wi-extract-mode')) === null || _a === void 0 ? void 0 : _a.addEventListener('change', () => {
                toggleCustomExtractInput();
                persistState();
            });
            console.log(`${LOG_PREFIX} 模块初始化完成。`);
        }
        catch (err) {
            if (retry < 20) {
                setTimeout(() => tryInit(retry + 1), 250);
            }
            else {
                console.error(`${LOG_PREFIX} 初始化失败（已重试 20 次）:`, err);
                if (typeof toastr !== 'undefined') {
                    toastr.error('总结模块初始化失败，请检查控制台。', '总结');
                }
            }
        }
    }
    tryInit();
})();
