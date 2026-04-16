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
    const SK_LAUNCH = 'smry_launch_role';
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
            name: 'Janus-灵魂典藏馆-事件总结',
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
YYYY年MM月DD日HH:MM~YYYY年MM月DD日HH:MM: 事件1的精炼总结（必须包含:地点、所有关键参与人物、起因、核心经过、关键转折、最终结局，以及此事对该角色造成的永久性改变。不少于150字）
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
</janusdiary>`
        },
        {
            name: 'Janus-灵魂典藏馆-档案压缩',
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
YYYY年MM月DD日HH:MM~YYYY年MM月DD日HH:MM: 事件1的精炼总结（必须包含:地点、所有关键参与人物、起因、核心经过、关键转折、最终结局，以及此事对该角色造成的永久性改变。不少于150字）
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
</janusdiary>`
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
        ctx.setExtensionPrompt(prefixed, content, POS_IN_PROMPT, 0, false, ROLE_SYSTEM);
        console.log(`${LOG_PREFIX} 已注入提示词 [${key}]，长度 ${content.length} 字符`);
        if (ephemeral) {
            scheduleEphemeralCleanup(key, POS_IN_PROMPT, ROLE_SYSTEM);
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
    function getLaunchRole() {
        var _a;
        const r = document.querySelector('input[name="smry-launch-role"]:checked');
        return ((_a = r === null || r === void 0 ? void 0 : r.value) !== null && _a !== void 0 ? _a : 'assistant');
    }
    function getTriggerText() {
        return getInputVal('smry-trigger-text').trim() || '角色扮演暂停、剧情推进暂停，开始总结';
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
        entry.depth = 9999;
        entry.role = 0;
    }
    /**
     * Read the last AI message, optionally extract <janusdiary>, then write to world info.
     */
    async function saveToWorldInfo(contentOverride) {
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
            if (getWiMode() === 'overwrite') {
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
        var _a;
        const ctx = getCtx();
        const chatLength = Array.isArray(ctx.chat) ? ctx.chat.length : 0;
        if (chatLength === 0)
            return;
        const toHide = [];
        for (let i = 0; i < chatLength; i++) {
            if ((i < start || i > end) && ((_a = ctx.chat[i]) === null || _a === void 0 ? void 0 : _a.is_system) !== true) {
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
        const preview = getPreviewText();
        if (!preview) {
            if (typeof toastr !== 'undefined')
                toastr.warning('当前没有可写入世界书的总结预览。', '总结');
            return;
        }
        await saveToWorldInfo(preview);
        const ctx = getCtx();
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
        setPreviewText('');
        setPreviewStatus('待生成');
        summarySession.generatedMessageId = null;
        if (summarySession.floorsHidden) {
            restoreHiddenFloorsForSummary();
        }
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
            const el = document.getElementById('smry-preview');
            if (el) {
                el.removeAttribute('readonly');
                el.value = cleanAiResponse(text);
                setPreviewStatus('生成中...');
            }
        });
        eventSource.on(eventTypes.GENERATION_ENDED, async () => {
            if (!summarySession.pendingPreview)
                return;
            summarySession.pendingPreview = false;
            await delay(200);
            updatePreviewFromLatestMessage();
            const el = document.getElementById('smry-preview');
            if (el)
                el.setAttribute('readonly', '');
        });
        eventSource.on(eventTypes.GENERATION_STOPPED, () => {
            if (!summarySession.pendingPreview)
                return;
            summarySession.pendingPreview = false;
            setPreviewStatus('生成已停止');
            const el = document.getElementById('smry-preview');
            if (el)
                el.setAttribute('readonly', '');
        });
    }
    // ── 核心执行 ──────────────────────────────────────────────────────────────
    async function executeSummary(isReroll = false) {
        const promptA = getInputVal('smry-prompt-a').trim();
        const launchRole = getLaunchRole();
        const triggerText = getTriggerText();
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
        // 静默注入 A+B（ephemeral，生成后自动清除）
        injectContextPrompt(INJECT_KEY_AB, fullPrompt, true);
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
            toastr.info(`总结已启动（楼层 ${range.start} ～ ${range.end}，${launchRole} 模式）`, '总结', { timeOut: 4000 });
        }
        // 等待注入生效
        await delay(200);
        // 按 C 选项触发
        const roleNum = launchRole === 'assistant' ? ROLE_ASSISTANT : ROLE_SYSTEM;
        if (launchRole === 'assistant') {
            injectChatTrigger(INJECT_KEY_USER, '（总结任务触发）', ROLE_USER, true);
        }
        injectChatTrigger(INJECT_KEY_LAUNCH, triggerText, roleNum, true);
        await delay(200);
        await triggerGeneration();
        console.log(`${LOG_PREFIX} 执行完成 [${range.start}~${range.end}] 模式: ${launchRole}`);
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
        const existing = presets.findIndex(p => p.name === trimmed);
        if (existing >= 0) {
            if (!window.confirm(`总结「${trimmed}」已存在，是否覆盖？`))
                return;
            presets[existing].prompt = prompt;
        }
        else {
            presets.push({ name: trimmed, prompt });
        }
        saveJSON(storageKey, presets);
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
        saveJSON(storageKey, presets);
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
        localStorage.setItem(SK_PROMPT_A, getInputVal('smry-prompt-a'));
        localStorage.setItem(SK_START_FLOOR, getInputVal('smry-start-floor'));
        localStorage.setItem(SK_END_FLOOR, getInputVal('smry-end-floor'));
        localStorage.setItem(SK_TRIGGER_TXT, getInputVal('smry-trigger-text'));
        const launchR = document.querySelector('input[name="smry-launch-role"]:checked');
        if (launchR)
            localStorage.setItem(SK_LAUNCH, launchR.value);
        // 世界书设置
        localStorage.setItem(SK_WI_BOOKNAME, getInputVal('smry-wi-bookname'));
        localStorage.setItem(SK_WI_ENTRY, getInputVal('smry-wi-entryname'));
        const wiMode = document.querySelector('input[name="smry-wi-mode"]:checked');
        if (wiMode)
            localStorage.setItem(SK_WI_MODE, wiMode.value);
        const wiExt = document.getElementById('smry-wi-extract');
        if (wiExt)
            localStorage.setItem(SK_WI_EXTRACT, wiExt.checked ? 'true' : 'false');
        localStorage.setItem(SK_WI_EXTRACT_MODE, getExtractMode());
        localStorage.setItem(SK_WI_EXTRACT_CUSTOM, getInputVal('smry-wi-extract-custom'));
        const hideSource = document.getElementById('smry-hide-source');
        if (hideSource)
            localStorage.setItem(SK_HIDE_SOURCE, hideSource.checked ? 'true' : 'false');
    }
    function restoreState() {
        var _a, _b, _c;
        const set = (id, key, fallback = '') => {
            var _a;
            const el = document.getElementById(id);
            if (el)
                el.value = (_a = localStorage.getItem(key)) !== null && _a !== void 0 ? _a : fallback;
        };
        set('smry-prompt-a', SK_PROMPT_A);
        set('smry-start-floor', SK_START_FLOOR);
        set('smry-end-floor', SK_END_FLOOR);
        set('smry-trigger-text', SK_TRIGGER_TXT, '角色扮演暂停、剧情推进暂停，开始总结');
        // 启动角色
        const savedRole = ((_a = localStorage.getItem(SK_LAUNCH)) !== null && _a !== void 0 ? _a : 'assistant');
        const r = document.querySelector(`input[name="smry-launch-role"][value="${savedRole}"]`);
        if (r)
            r.checked = true;
        // 预设列表（首次加载时自动填入内置预设）
        presets_a = loadJSON(SK_PRESETS_A, []);
        if (presets_a.length === 0) {
            presets_a = DEFAULT_PRESETS.map(p => (Object.assign({}, p)));
            saveJSON(SK_PRESETS_A, presets_a);
        }
        refreshPresetSelect('A');
        // 世界书设置
        set('smry-wi-bookname', SK_WI_BOOKNAME);
        const savedEntry = localStorage.getItem(SK_WI_ENTRY);
        const wiEntryEl = document.getElementById('smry-wi-entryname');
        if (wiEntryEl && savedEntry !== null)
            wiEntryEl.value = savedEntry;
        const savedMode = (_b = localStorage.getItem(SK_WI_MODE)) !== null && _b !== void 0 ? _b : 'overwrite';
        const wiModeEl = document.querySelector(`input[name="smry-wi-mode"][value="${savedMode}"]`);
        if (wiModeEl)
            wiModeEl.checked = true;
        const wiExtEl = document.getElementById('smry-wi-extract');
        if (wiExtEl)
            wiExtEl.checked = localStorage.getItem(SK_WI_EXTRACT) !== 'false';
        const extractModeEl = document.getElementById('smry-wi-extract-mode');
        if (extractModeEl)
            extractModeEl.value = (_c = localStorage.getItem(SK_WI_EXTRACT_MODE)) !== null && _c !== void 0 ? _c : 'thinking';
        set('smry-wi-extract-custom', SK_WI_EXTRACT_CUSTOM);
        const hideSourceEl = document.getElementById('smry-hide-source');
        if (hideSourceEl)
            hideSourceEl.checked = localStorage.getItem(SK_HIDE_SOURCE) !== 'false';
        toggleCustomExtractInput();
        clearPreview();
    }
    // ── 自定义事件监听 ────────────────────────────────────────────────────────
    document.addEventListener(`${EVENT_NS}execute`, () => { executeSummary(); });
    document.addEventListener(`${EVENT_NS}savePresetA`, () => savePreset('A'));
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
    document.addEventListener(`${EVENT_NS}saveToWI`, () => { saveToWorldInfo(); });
    document.addEventListener(`${EVENT_NS}confirmPreview`, () => { finalizeSummaryToWorldInfo(); });
    document.addEventListener(`${EVENT_NS}reroll`, () => { rerollSummary(); });
    document.addEventListener(`${EVENT_NS}clearPreview`, () => { clearPreview(); });
    document.addEventListener(`${EVENT_NS}detectWorldBook`, () => {
        const detected = detectCharacterWorldBook();
        const el = document.getElementById('smry-wi-bookname');
        if (detected && el) {
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
            bindSummaryEvents();
            // 自动持久化
            ['smry-prompt-a'].forEach(id => { var _a; return (_a = document.getElementById(id)) === null || _a === void 0 ? void 0 : _a.addEventListener('input', persistState); });
            ['smry-start-floor', 'smry-end-floor', 'smry-trigger-text',
                'smry-wi-bookname', 'smry-wi-entryname', 'smry-wi-extract-custom'].forEach(id => { var _a; return (_a = document.getElementById(id)) === null || _a === void 0 ? void 0 : _a.addEventListener('change', persistState); });
            document.querySelectorAll('input[name="smry-launch-role"]').forEach(r => r.addEventListener('change', persistState));
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
