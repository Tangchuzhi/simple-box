/**
 * 动态系统 — 属性追踪模块（玩家友好，内置模板，AI生成规则）
 * 规则格式：是/否判定题，AI在回复末尾附加 {{ds_rules: R1=是, R2=否}}
 */
(function () {
    const INIT_FLAG = '__sb_ds_loaded__';
    if (window[INIT_FLAG])
        return;
    window[INIT_FLAG] = true;
    const CFG_KEY = 'sb_ds_config';
    const LOG_KEY = 'sb_ds_log';
    const INJECT_KEY = 'simple-box-dynamic';
    const RULEGEN_KEY = 'sb-ds-rulegen';
    const LOG_PREFIX = '[动态系统]';
    const TEMPLATES = [
        {
            id: 'relationship',
            name: '关系弧光系统',
            desc: '追踪角色与USER之间的长期关系变化与角色弧光发展',
            attributes: [
                { label: '好感度', min: -100, max: 100, defaultValue: 0, step: 5,
                    thresholds: [{ min: -100, label: '强烈反感，言辞尖刻或回避' }, { min: -50, label: '漠然冷淡' }, { min: 0, label: '友好亲近' }, { min: 50, label: '深厚感情，主动依赖USER' }] },
                { label: '信任度', min: 0, max: 100, defaultValue: 50, step: 5,
                    thresholds: [{ min: 0, label: '警觉隐瞒' }, { min: 30, label: '逐渐开放' }, { min: 70, label: '毫无保留，愿分享秘密' }] },
                { label: '依赖度', min: 0, max: 100, defaultValue: 0, step: 5,
                    thresholds: [{ min: 0, label: '独立自主' }, { min: 30, label: '偶尔寻求依靠' }, { min: 70, label: '心理依赖，独处感到不安' }] },
            ],
            ruleGenHint: '角色关系弧光变化，关注USER行为是否让角色产生喜欢/反感、信任/怀疑、依赖/疏离等变化',
        },
        {
            id: 'intimacy',
            name: '亲密关系系统',
            desc: '追踪角色与USER之间的亲密、欲望与情感张力变化',
            attributes: [
                { label: '亲密度', min: 0, max: 100, defaultValue: 0, step: 5,
                    thresholds: [{ min: 0, label: '陌生拘谨' }, { min: 30, label: '熟悉，偶有亲昵动作' }, { min: 60, label: '非常亲密，渴望接触' }] },
                { label: '欲望值', min: 0, max: 100, defaultValue: 0, step: 5,
                    thresholds: [{ min: 0, label: '平淡' }, { min: 30, label: '轻微心动，言语带暧昧' }, { min: 60, label: '强烈渴望，行为暗示明显' }] },
                { label: '占有欲', min: 0, max: 100, defaultValue: 0, step: 5,
                    thresholds: [{ min: 0, label: '无感' }, { min: 30, label: '在意USER的关注' }, { min: 70, label: '嫉妒心强，不愿分享USER' }] },
            ],
            ruleGenHint: '亲密关系与情感张力变化，关注身体接触、暧昧互动、情欲暗示、依恋加深或独占倾向增强等事件',
        },
        {
            id: 'status',
            name: '情绪状态系统',
            desc: '追踪角色当前的情绪、压力与疲劳状态变化',
            attributes: [
                { label: '心情', min: -50, max: 50, defaultValue: 0, step: 5,
                    thresholds: [{ min: -50, label: '低落沮丧，易怒或沉默' }, { min: -20, label: '情绪平稳' }, { min: 20, label: '愉快，活力充沛' }] },
                { label: '压力值', min: 0, max: 100, defaultValue: 20, step: 5,
                    thresholds: [{ min: 0, label: '放松' }, { min: 30, label: '轻微紧张' }, { min: 70, label: '明显焦虑，行为失常' }] },
                { label: '疲惫值', min: 0, max: 100, defaultValue: 0, step: 5,
                    thresholds: [{ min: 0, label: '精力充沛' }, { min: 30, label: '略显疲惫' }, { min: 70, label: '极度疲劳，渴望休息' }] },
            ],
            ruleGenHint: '情绪与状态波动，关注角色是否因事件感到愉快、沮丧、紧张、压迫、疲劳、放松或恢复精神',
        },
        {
            id: 'combat',
            name: '战斗冒险系统',
            desc: '追踪角色或USER在战斗或冒险过程中的核心资源变化',
            attributes: [
                { label: '生命值', min: 0, max: 100, defaultValue: 100, step: 5,
                    thresholds: [{ min: 0, label: '濒危，生死边缘' }, { min: 20, label: '重伤，行动迟缓' }, { min: 50, label: '轻伤，仍可战斗' }, { min: 100, label: '满血健康' }] },
                { label: '金币', min: 0, max: 9999, defaultValue: 0, step: 10,
                    thresholds: [{ min: 0, label: '身无分文' }, { min: 100, label: '基本够用' }, { min: 1000, label: '相当富裕' }] },
                { label: '经验值', min: 0, max: 1000, defaultValue: 0, step: 10,
                    thresholds: [{ min: 0, label: '新手' }, { min: 100, label: '初窥门径' }, { min: 500, label: '经验丰富' }, { min: 900, label: '接近精通' }] },
            ],
            ruleGenHint: '战斗与冒险资源变化，关注角色或USER是否受伤、获得战利品、完成战斗或经历可带来经验成长的事件',
        },
    ];
    // ── Core helpers ──────────────────────────────────────────────
    function getCtx() { var _a, _b; return (_b = (_a = window.SillyTavern) === null || _a === void 0 ? void 0 : _a.getContext) === null || _b === void 0 ? void 0 : _b.call(_a); }
    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
    /** Returns the chatMetadata variable key for an attribute, e.g. "ds_alice_favorability" */
    function attrVarKey(a) {
        const char = (a.character || '').trim().toLowerCase().replace(/\s+/g, '_');
        return `ds_${char ? char + '_' : ''}${a.key}`;
    }
    /** Returns the state-label variable key, e.g. "ds_alice_favorability_state" */
    function stateVarKey(a) { return `${attrVarKey(a)}_state`; }
    // ── Threshold helpers ─────────────────────────────────────────
    /** Returns the label for the current value (highest threshold min ≤ val). */
    function getCurrentLabel(thresholds, val) {
        var _a, _b, _c;
        if (!thresholds || thresholds.length === 0)
            return '';
        const sorted = [...thresholds].sort((a, b) => b.min - a.min); // descending
        const match = sorted.find(t => val >= t.min);
        return (_c = (_a = match === null || match === void 0 ? void 0 : match.label) !== null && _a !== void 0 ? _a : (_b = sorted[sorted.length - 1]) === null || _b === void 0 ? void 0 : _b.label) !== null && _c !== void 0 ? _c : '';
    }
    /** Parse textarea text "min: label" per line into Threshold[]. */
    function parseThresholds(text) {
        return text.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
            const m = line.match(/^(-?\d+(?:\.\d+)?)\s*[:：]\s*(.+)$/);
            return m ? { min: Number(m[1]), label: m[2].trim() } : null;
        }).filter((x) => x !== null);
    }
    /** Serialize Threshold[] back to textarea text. */
    function thresholdsToText(thresholds) {
        if (!thresholds || thresholds.length === 0)
            return '';
        return [...thresholds].sort((a, b) => a.min - b.min).map(t => `${t.min}: ${t.label}`).join('\n');
    }
    // ── Lorebook integration ──────────────────────────────────────
    const WI_METADATA_KEY = 'world_info';
    const WI_ENTRY_MARKER = 'sb-dynamic-system';
    let _wiApi = null;
    async function getWiApi() {
        if (_wiApi)
            return _wiApi;
        try {
            _wiApi = await Function('return import("/scripts/world-info.js")')();
        }
        catch ( /* no-op */_a) { /* no-op */ }
        return _wiApi;
    }
    /** Build the lorebook entry content: pure macros — AI reads the resolved label directly. */
    function buildLorebookContent() {
        const s = getSettings();
        const lines = ['【动态系统·角色当前状态】（此条目由动态系统自动维护）', ''];
        const charMap = new Map();
        for (const a of s.attributes) {
            const c = a.character || '';
            if (!charMap.has(c))
                charMap.set(c, []);
            charMap.get(c).push(a);
        }
        charMap.forEach((attrs, char) => {
            if (char)
                lines.push(`【${char}】`);
            for (const a of attrs) {
                if (a.thresholds && a.thresholds.length > 0) {
                    // State macro resolves directly to the current label, no range chart needed
                    lines.push(`${a.label}：{{getvar::${stateVarKey(a)}}}`);
                }
                else {
                    lines.push(`${a.label}：{{getvar::${attrVarKey(a)}}}`);
                }
            }
            lines.push('');
        });
        return lines.join('\n').replace(/\s+$/, '');
    }
    /** Create / update the chat-bound lorebook entry with current attribute definitions. */
    async function updateChatLorebook() {
        var _a, _b;
        const ctx = getCtx();
        const s = getSettings();
        if (!ctx || s.attributes.length === 0)
            return;
        const wi = await getWiApi();
        if (!(wi === null || wi === void 0 ? void 0 : wi.loadWorldInfo) || !(wi === null || wi === void 0 ? void 0 : wi.saveWorldInfo) || !(wi === null || wi === void 0 ? void 0 : wi.createWorldInfoEntry))
            return;
        // Ensure chat-bound lorebook exists
        let bookName = (_a = ctx.chatMetadata) === null || _a === void 0 ? void 0 : _a[WI_METADATA_KEY];
        if (!bookName) {
            await execSlash('/getchatbook');
            bookName = (_b = ctx.chatMetadata) === null || _b === void 0 ? void 0 : _b[WI_METADATA_KEY];
            if (!bookName)
                return;
        }
        const data = await wi.loadWorldInfo(bookName);
        if (!(data === null || data === void 0 ? void 0 : data.entries))
            return;
        let entry = Object.values(data.entries).find((e) => e.comment === WI_ENTRY_MARKER);
        if (!entry) {
            entry = wi.createWorldInfoEntry(bookName, data);
            if (!entry)
                return;
            entry.comment = WI_ENTRY_MARKER;
            entry.constant = true;
            entry.disable = false;
            entry.key = [];
            entry.keysecondary = [];
        }
        entry.content = buildLorebookContent();
        await wi.saveWorldInfo(bookName, data, true);
        console.log(LOG_PREFIX, '已更新世界书条目');
    }
    const DEFAULTS = { attributes: [], rules: [], injectPrompt: true, injectDepth: 0 };
    function getSettings() {
        const ctx = getCtx();
        const meta = ctx === null || ctx === void 0 ? void 0 : ctx.chatMetadata;
        if (!meta)
            return Object.assign({}, DEFAULTS);
        if (!meta[CFG_KEY])
            meta[CFG_KEY] = Object.assign({}, DEFAULTS);
        const s = meta[CFG_KEY];
        if (!Array.isArray(s.rules))
            s.rules = [];
        if (!Array.isArray(s.attributes))
            s.attributes = [];
        if (typeof s.injectDepth !== 'number')
            s.injectDepth = 0;
        return s;
    }
    function saveSettings() {
        var _a, _b;
        const ctx = getCtx();
        if (!(ctx === null || ctx === void 0 ? void 0 : ctx.chatMetadata))
            return;
        (_b = (_a = window).saveChatDebounced) === null || _b === void 0 ? void 0 : _b.call(_a);
    }
    function getVarNum(attr) {
        var _a, _b, _c;
        const raw = (_c = (_b = (_a = getCtx()) === null || _a === void 0 ? void 0 : _a.chatMetadata) === null || _b === void 0 ? void 0 : _b.variables) === null || _c === void 0 ? void 0 : _c[attrVarKey(attr)];
        return raw !== undefined ? Number(raw) : attr.defaultValue;
    }
    function getChatLog() { var _a, _b, _c; return (_c = (_b = (_a = getCtx()) === null || _a === void 0 ? void 0 : _a.chatMetadata) === null || _b === void 0 ? void 0 : _b[LOG_KEY]) !== null && _c !== void 0 ? _c : []; }
    function appendLog(entry) {
        const ctx = getCtx();
        if (!(ctx === null || ctx === void 0 ? void 0 : ctx.chatMetadata))
            return;
        if (!ctx.chatMetadata[LOG_KEY])
            ctx.chatMetadata[LOG_KEY] = [];
        ctx.chatMetadata[LOG_KEY].unshift(entry);
        if (ctx.chatMetadata[LOG_KEY].length > 200)
            ctx.chatMetadata[LOG_KEY].length = 200;
    }
    async function execSlash(cmd) {
        const ctx = getCtx();
        if (ctx === null || ctx === void 0 ? void 0 : ctx.executeSlashCommandsWithOptions)
            await ctx.executeSlashCommandsWithOptions(cmd);
    }
    function clamp(attr, val) { return Math.max(attr.min, Math.min(attr.max, Math.round(val))); }
    /** Sync the _state label variable based on current numeric value. */
    async function syncStateVar(attr, val) {
        if (!attr.thresholds || attr.thresholds.length === 0)
            return;
        const v = val !== undefined ? val : getVarNum(attr);
        const label = getCurrentLabel(attr.thresholds, v);
        if (!label)
            return;
        await execSlash(`/setvar key=${stateVarKey(attr)} ${label}`);
    }
    /** Sync all _state variables from current numeric values (call on init / chat change). */
    async function syncAllStateVars() {
        for (const a of getSettings().attributes)
            await syncStateVar(a);
    }
    async function applyDelta(attrKey, delta, reason) {
        const attr = getSettings().attributes.find(a => a.key === attrKey);
        if (!attr || delta === 0)
            return;
        const current = getVarNum(attr);
        const actual = clamp(attr, current + delta) - current;
        if (actual === 0)
            return;
        const newVal = current + actual;
        await execSlash(`/addvar key=${attrVarKey(attr)} ${actual}`);
        await syncStateVar(attr, newVal);
        const logLabel = attr.character ? `${attr.character} · ${attr.label}` : attr.label;
        appendLog({ time: Date.now(), label: logLabel, delta: actual, reason });
    }
    async function setVarDirect(attrKey, val) {
        const attr = getSettings().attributes.find(a => a.key === attrKey);
        if (!attr)
            return;
        const clamped = clamp(attr, val);
        await execSlash(`/setvar key=${attrVarKey(attr)} ${clamped}`);
        await syncStateVar(attr, clamped);
    }
    function updatePrompt() {
        const ctx = getCtx();
        if (!(ctx === null || ctx === void 0 ? void 0 : ctx.setExtensionPrompt))
            return;
        const s = getSettings();
        if (!s.injectPrompt || s.attributes.length === 0) {
            ctx.setExtensionPrompt(INJECT_KEY, '', 1, s.injectDepth);
            return;
        }
        // Group attributes by character (empty = global)
        const charMap = new Map();
        for (const a of s.attributes) {
            const c = a.character || '';
            if (!charMap.has(c))
                charMap.set(c, []);
            charMap.get(c).push(a);
        }
        const lines = ['【动态属性追踪系统】'];
        charMap.forEach((attrs, char) => {
            if (char)
                lines.push(`\n== ${char} ==`);
            else if (charMap.size > 1)
                lines.push('');
            for (const a of attrs) {
                const val = getVarNum(a);
                const label = getCurrentLabel(a.thresholds, val);
                lines.push(`  ${a.label}：${val}（${a.min}～${a.max}）${label ? ` → ${label}` : ''}`);
            }
        });
        const enabled = s.rules.filter(r => r.enabled && r.question.trim());
        if (enabled.length > 0) {
            lines.push('', '请在每条回复【最后一行】附加判定（不可省略）：');
            lines.push('{{ds_rules: ' + enabled.map((_, i) => `R${i + 1}=是/否`).join(', ') + '}}');
            lines.push('', '判定规则（根据本次回复内容作答）：');
            enabled.forEach((r, i) => {
                const attr = s.attributes.find(a => a.key === r.attrKey);
                const lbl = attr ? (attr.character ? `${attr.character}·${attr.label}` : attr.label) : r.attrKey;
                const y = r.yesDelta !== 0 ? `${lbl}${r.yesDelta > 0 ? '+' : ''}${r.yesDelta}` : '无变化';
                const n = r.noDelta !== 0 ? `${lbl}${r.noDelta > 0 ? '+' : ''}${r.noDelta}` : '无变化';
                lines.push(`  R${i + 1}：${r.question}（是→${y}，否→${n}）`);
            });
        }
        ctx.setExtensionPrompt(INJECT_KEY, lines.join('\n'), 1, s.injectDepth);
    }
    async function parseAndApply(text) {
        const s = getSettings();
        const enabled = s.rules.filter(r => r.enabled && r.question.trim());
        if (enabled.length === 0)
            return false;
        const m = text.match(/\{\{ds_rules:\s*([\s\S]*?)\}\}/);
        if (!m)
            return false;
        let changed = false;
        for (const part of m[1].split(',')) {
            const pm = part.trim().match(/R(\d+)\s*=\s*(是|否|yes|no)/i);
            if (!pm)
                continue;
            const idx = parseInt(pm[1]) - 1;
            const isYes = /^(是|yes)$/i.test(pm[2]);
            const rule = enabled[idx];
            if (!rule)
                continue;
            const delta = isYes ? rule.yesDelta : rule.noDelta;
            if (delta !== 0) {
                await applyDelta(rule.attrKey, delta, isYes ? '规则触发（是）' : '规则触发（否）');
                changed = true;
            }
        }
        return changed;
    }
    function getLastAIMessage() {
        var _a, _b, _c;
        const chat = (_b = (_a = getCtx()) === null || _a === void 0 ? void 0 : _a.chat) !== null && _b !== void 0 ? _b : [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const m = chat[i];
            if (!m.is_user && !m.is_system)
                return (_c = m.mes) !== null && _c !== void 0 ? _c : '';
        }
        return '';
    }
    // ── AI rule generation ────────────────────────────────────────
    let generatingRules = false;
    let ruleGenAttrKey = '';
    async function generateRulesForAttr(attrKey) {
        var _a, _b, _c;
        if (generatingRules) {
            if (typeof toastr !== 'undefined')
                toastr.warning('正在生成中，请稍候…', '动态系统');
            return;
        }
        const s = getSettings();
        const attr = s.attributes.find(a => a.key === attrKey);
        if (!attr)
            return;
        const tpl = TEMPLATES.find(t => t.attributes.some(a => a.label === attr.label));
        const hint = (_a = tpl === null || tpl === void 0 ? void 0 : tpl.ruleGenHint) !== null && _a !== void 0 ? _a : `${attr.label}属性变化`;
        generatingRules = true;
        ruleGenAttrKey = attrKey;
        setGenStatus(`正在为「${attr.label}」生成规则…`);
        const ctx = getCtx();
        const prompt = `请根据当前角色卡的人设与世界观，为属性「${attr.label}（${attr.min}～${attr.max}）」生成3～5条判定规则。
要求：每条规则是一个用"是/否"回答的问题，与${hint}高度相关。
严格只输出以下JSON，不含其他内容：
[{"question":"问题？","yesDelta":5,"noDelta":0}]`;
        (_b = ctx === null || ctx === void 0 ? void 0 : ctx.setExtensionPrompt) === null || _b === void 0 ? void 0 : _b.call(ctx, RULEGEN_KEY, prompt, 0, 0, false, 0);
        await delay(150);
        try {
            await ((_c = ctx === null || ctx === void 0 ? void 0 : ctx.executeSlashCommandsWithOptions) === null || _c === void 0 ? void 0 : _c.call(ctx, '/trigger'));
        }
        catch ( /* fallback */_d) { /* fallback */ }
    }
    async function handleRuleGenComplete() {
        var _a, _b, _c, _d, _e;
        if (!generatingRules)
            return;
        generatingRules = false;
        const ctx = getCtx();
        (_a = ctx === null || ctx === void 0 ? void 0 : ctx.setExtensionPrompt) === null || _a === void 0 ? void 0 : _a.call(ctx, RULEGEN_KEY, '', 0, 0, false, 0);
        const text = getLastAIMessage();
        const chat = (_b = ctx === null || ctx === void 0 ? void 0 : ctx.chat) !== null && _b !== void 0 ? _b : [];
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!((_c = chat[i]) === null || _c === void 0 ? void 0 : _c.is_user) && !((_d = chat[i]) === null || _d === void 0 ? void 0 : _d.is_system)) {
                try {
                    await (ctx === null || ctx === void 0 ? void 0 : ctx.deleteMessage(i));
                }
                catch (_f) { }
                break;
            }
        }
        try {
            const jm = text.match(/\[[\s\S]*\]/);
            if (!jm)
                throw new Error('no JSON');
            const parsed = JSON.parse(jm[0]);
            const s = getSettings();
            for (const r of parsed) {
                if (r.question && typeof r.yesDelta === 'number') {
                    s.rules.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2), question: r.question, attrKey: ruleGenAttrKey, yesDelta: r.yesDelta, noDelta: (_e = r.noDelta) !== null && _e !== void 0 ? _e : 0, enabled: true });
                }
            }
            saveSettings();
            updatePrompt();
            renderRuleConfigList();
            setGenStatus(`已生成 ${parsed.length} 条规则`);
            if (typeof toastr !== 'undefined')
                toastr.success(`已生成 ${parsed.length} 条规则`, '动态系统');
        }
        catch (_g) {
            setGenStatus('解析失败，请重试');
        }
    }
    function setGenStatus(msg) { const e = document.getElementById('ds-gen-status'); if (e)
        e.textContent = msg; }
    // ── Strip {{ds_rules:…}} from displayed message ───────────────
    const RULES_TAG_RE = /\s*\{\{ds_rules:[^}]*\}\}/g;
    async function stripRulesTag() {
        var _a, _b, _c, _d, _e, _f;
        const ctx = getCtx();
        const chat = (_a = ctx === null || ctx === void 0 ? void 0 : ctx.chat) !== null && _a !== void 0 ? _a : [];
        let mesIdx = -1;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!((_b = chat[i]) === null || _b === void 0 ? void 0 : _b.is_user) && !((_c = chat[i]) === null || _c === void 0 ? void 0 : _c.is_system)) {
                mesIdx = i;
                break;
            }
        }
        if (mesIdx < 0)
            return;
        const msg = chat[mesIdx];
        const original = (_d = msg === null || msg === void 0 ? void 0 : msg.mes) !== null && _d !== void 0 ? _d : '';
        const stripped = original.replace(RULES_TAG_RE, '').replace(/\s+$/, '');
        if (stripped === original)
            return;
        msg.mes = stripped;
        // Update rendered DOM element
        const mesTextEl = document.querySelector(`#chat .mes[mesid="${mesIdx}"] .mes_text`);
        if (mesTextEl) {
            mesTextEl.innerHTML = mesTextEl.innerHTML.replace(RULES_TAG_RE, '');
        }
        (_f = (_e = window).saveChatDebounced) === null || _f === void 0 ? void 0 : _f.call(_e);
    }
    // ── UI state ──────────────────────────────────────────────────
    let editAttr = null;
    let editAttrIsNew = false;
    let editRule = null;
    let editRuleIsNew = false;
    let pollTimer = 0;
    let aiMsgHandler = null;
    let genEndedHandler = null;
    function el(id) { return document.getElementById(id); }
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function switchTab(tab) {
        ['status', 'config', 'history'].forEach(t => {
            const p = el(`ds-panel-${t}`);
            const b = el(`ds-tab-${t}`);
            if (p)
                p.style.display = t === tab ? '' : 'none';
            if (b)
                b.classList.toggle('active', t === tab);
        });
    }
    function renderAttrCards() {
        const c = el('ds-attr-cards');
        if (!c)
            return;
        const attrs = getSettings().attributes;
        if (attrs.length === 0) {
            c.innerHTML = `<div class="ds-empty"><i class="fa-solid fa-circle-plus" style="font-size:24px"></i><span>还没有属性，请在「配置」中添加或选择模板</span></div>`;
            return;
        }
        const charMap = new Map();
        for (const a of attrs) {
            const c2 = a.character || '';
            if (!charMap.has(c2))
                charMap.set(c2, []);
            charMap.get(c2).push(a);
        }
        let html = '';
        charMap.forEach((list, char) => {
            if (char)
                html += `<div class="ds-char-group-hd"><i class="fa-solid fa-user"></i> ${esc(char)}</div>`;
            html += list.map(a => {
                const val = getVarNum(a);
                const pct = a.max > a.min ? Math.max(0, Math.min(100, ((val - a.min) / (a.max - a.min)) * 100)) : 0;
                return `<div class="ds-card"><div class="ds-card-head"><span class="ds-card-label">${esc(a.label)}</span><span class="ds-card-val">${val}</span><span class="ds-card-max">/${a.max}</span></div><div class="ds-progress-track"><div class="ds-progress-fill" style="width:${pct}%"></div></div><div class="ds-card-controls"><button class="ds-btn-step" data-key="${esc(a.key)}" data-delta="${-a.step}">−${a.step}</button><input type="number" class="ds-val-input" data-key="${esc(a.key)}" value="${val}"/><button class="ds-btn-step" data-key="${esc(a.key)}" data-delta="${a.step}">+${a.step}</button></div></div>`;
            }).join('');
        });
        c.innerHTML = html;
    }
    function renderAttrConfigList() {
        const c = el('ds-attr-config-list');
        if (!c)
            return;
        const attrs = getSettings().attributes;
        c.innerHTML = attrs.length === 0 ? `<div class="ds-empty-sm">暂无属性</div>`
            : attrs.map((a, i) => {
                const charBadge = a.character ? `<span class="ds-list-char">${esc(a.character)}</span>` : '';
                return `<div class="ds-list-item">${charBadge}<span class="ds-list-label">${esc(a.label)}</span><span class="ds-list-key" title="{{getvar::${attrVarKey(a)}}}">${esc(attrVarKey(a))}</span><span class="ds-list-range">[${a.min}~${a.max}]</span><button class="ds-icon-btn ds-gen-rule" data-key="${esc(a.key)}" title="AI生成规则"><i class="fa-solid fa-wand-magic-sparkles"></i></button><button class="ds-icon-btn ds-edit-attr" data-idx="${i}" title="编辑"><i class="fa-solid fa-pen"></i></button><button class="ds-icon-btn ds-del ds-del-attr" data-key="${esc(a.key)}" title="删除"><i class="fa-solid fa-trash"></i></button></div>`;
            }).join('');
    }
    function renderRuleConfigList() {
        const c = el('ds-rule-config-list');
        if (!c)
            return;
        const s = getSettings();
        c.innerHTML = s.rules.length === 0 ? `<div class="ds-empty-sm">暂无规则</div>`
            : s.rules.map((r, i) => {
                var _a, _b;
                const lbl = (_b = (_a = s.attributes.find(a => a.key === r.attrKey)) === null || _a === void 0 ? void 0 : _a.label) !== null && _b !== void 0 ? _b : r.attrKey;
                const y = r.yesDelta !== 0 ? `是→${r.yesDelta > 0 ? '+' : ''}${r.yesDelta}` : '';
                const n = r.noDelta !== 0 ? `否→${r.noDelta > 0 ? '+' : ''}${r.noDelta}` : '';
                const q = r.question.length > 22 ? r.question.slice(0, 22) + '…' : r.question;
                return `<div class="ds-list-item"><i class="fa-solid ${r.enabled ? 'fa-toggle-on ds-toggle-on' : 'fa-toggle-off ds-toggle-off'} ds-toggle-rule" data-idx="${i}" style="cursor:pointer"></i><span class="ds-list-label" title="${esc(r.question)}">${esc(q)}</span><span class="ds-list-key">${esc(lbl)}</span><span class="ds-list-range">${esc([y, n].filter(Boolean).join(' '))}</span><button class="ds-icon-btn ds-edit-rule" data-idx="${i}"><i class="fa-solid fa-pen"></i></button><button class="ds-icon-btn ds-del ds-del-rule" data-idx="${i}"><i class="fa-solid fa-trash"></i></button></div>`;
            }).join('');
    }
    // ── Attr form ─────────────────────────────────────────────────
    function showAttrForm(attr) {
        editAttr = attr ? JSON.parse(JSON.stringify(attr)) : { key: '', label: '', min: 0, max: 100, defaultValue: 50, step: 5, character: '', behaviorHint: '' };
        editAttrIsNew = !attr;
        const form = el('ds-attr-form');
        if (!form)
            return;
        form.style.display = '';
        el('ds-attr-form-title').textContent = editAttrIsNew ? '新建属性' : `编辑：${editAttr.label}`;
        el('ds-attr-key').value = editAttr.key;
        el('ds-attr-key').disabled = !editAttrIsNew;
        el('ds-attr-label').value = editAttr.label;
        el('ds-attr-min').value = String(editAttr.min);
        el('ds-attr-max').value = String(editAttr.max);
        el('ds-attr-default').value = String(editAttr.defaultValue);
        el('ds-attr-step').value = String(editAttr.step);
        el('ds-attr-character').value = editAttr.character || '';
        el('ds-attr-thresholds').value = thresholdsToText(editAttr.thresholds);
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function hideAttrForm() { editAttr = null; const f = el('ds-attr-form'); if (f)
        f.style.display = 'none'; }
    function saveAttrForm() {
        if (!editAttr)
            return;
        if (editAttrIsNew)
            editAttr.key = el('ds-attr-key').value.trim();
        editAttr.label = el('ds-attr-label').value.trim();
        editAttr.min = Number(el('ds-attr-min').value);
        editAttr.max = Number(el('ds-attr-max').value);
        editAttr.defaultValue = Number(el('ds-attr-default').value);
        editAttr.step = Number(el('ds-attr-step').value) || 1;
        editAttr.character = el('ds-attr-character').value.trim() || undefined;
        const thr = parseThresholds(el('ds-attr-thresholds').value);
        editAttr.thresholds = thr.length > 0 ? thr : undefined;
        if (!editAttr.key || !editAttr.label) {
            if (typeof toastr !== 'undefined')
                toastr.warning('Key 和名称不能为空', '动态系统');
            return;
        }
        const s = getSettings();
        if (editAttrIsNew)
            s.attributes.push(editAttr);
        else {
            const i = s.attributes.findIndex(a => a.key === editAttr.key);
            if (i >= 0)
                s.attributes[i] = editAttr;
        }
        saveSettings();
        updatePrompt();
        hideAttrForm();
        renderAttrConfigList();
        renderAttrCards();
        updateChatLorebook();
    }
    // ── Rule form ─────────────────────────────────────────────────
    function showRuleForm(rule) {
        var _a, _b;
        const s = getSettings();
        editRule = rule ? JSON.parse(JSON.stringify(rule)) : { id: Date.now().toString(36), question: '', attrKey: (_b = (_a = s.attributes[0]) === null || _a === void 0 ? void 0 : _a.key) !== null && _b !== void 0 ? _b : '', yesDelta: 5, noDelta: 0, enabled: true };
        editRuleIsNew = !rule;
        const form = el('ds-rule-form');
        if (!form)
            return;
        form.style.display = '';
        el('ds-rule-form-title').textContent = editRuleIsNew ? '新建规则' : '编辑规则';
        el('ds-rule-question').value = editRule.question;
        el('ds-rule-yes-delta').value = String(editRule.yesDelta);
        el('ds-rule-no-delta').value = String(editRule.noDelta);
        const sel = el('ds-rule-attr');
        if (sel)
            sel.innerHTML = s.attributes.map(a => `<option value="${esc(a.key)}" ${a.key === editRule.attrKey ? 'selected' : ''}>${esc(a.label)}</option>`).join('');
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function hideRuleForm() { editRule = null; const f = el('ds-rule-form'); if (f)
        f.style.display = 'none'; }
    function saveRuleForm() {
        var _a, _b;
        if (!editRule)
            return;
        editRule.question = el('ds-rule-question').value.trim();
        editRule.attrKey = (_b = (_a = (el('ds-rule-attr'))) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : '';
        editRule.yesDelta = Number(el('ds-rule-yes-delta').value);
        editRule.noDelta = Number(el('ds-rule-no-delta').value);
        if (!editRule.question || !editRule.attrKey) {
            if (typeof toastr !== 'undefined')
                toastr.warning('问题和属性不能为空', '动态系统');
            return;
        }
        const s = getSettings();
        if (editRuleIsNew)
            s.rules.push(editRule);
        else {
            const i = s.rules.findIndex(r => r.id === editRule.id);
            if (i >= 0)
                s.rules[i] = editRule;
        }
        saveSettings();
        updatePrompt();
        hideRuleForm();
        renderRuleConfigList();
    }
    // ── Template apply ────────────────────────────────────────────
    function applyTemplate(tid) {
        const tpl = TEMPLATES.find(t => t.id === tid);
        if (!tpl || tpl.attributes.length === 0)
            return;
        const charInput = window.prompt(`应用模板「${tpl.name}」\n\n角色名称（留空表示全局/通用）：`, '');
        if (charInput === null)
            return; // cancelled
        const character = charInput.trim() || undefined;
        const charPrefix = character ? character.toLowerCase().replace(/\s+/g, '_') + '_' : '';
        const s = getSettings();
        for (const a of tpl.attributes) {
            const key = charPrefix + (a.label.replace(/[^\w\u4e00-\u9fa5]/g, '') || a.label.charCodeAt(0).toString());
            if (!s.attributes.find(x => x.key === key))
                s.attributes.push(Object.assign(Object.assign({ key }, a), { character }));
        }
        saveSettings();
        updatePrompt();
        renderAttrConfigList();
        renderAttrCards();
        if (typeof toastr !== 'undefined')
            toastr.success(`已添加 ${tpl.attributes.length} 个属性${character ? `（角色：${character}）` : ''}`, '动态系统');
        updateChatLorebook();
    }
    // ── Log & renderAll ───────────────────────────────────────────
    function renderLog() {
        const c = el('ds-log-list');
        if (!c)
            return;
        const entries = getChatLog();
        if (entries.length === 0) {
            c.innerHTML = `<div class="ds-empty"><i class="fa-solid fa-scroll" style="font-size:24px"></i><span>暂无变更记录</span></div>`;
            return;
        }
        c.innerHTML = entries.map(e => {
            const sign = e.delta >= 0 ? '+' : '';
            const cls = e.delta >= 0 ? 'ds-log-pos' : 'ds-log-neg';
            const d = new Date(e.time);
            const t = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            return `<div class="ds-log-row"><span class="ds-log-time">${t}</span><span class="ds-log-label">${esc(e.label)}</span><span class="${cls}">${sign}${e.delta}</span><span class="ds-log-reason">${esc(e.reason)}</span></div>`;
        }).join('');
    }
    function renderAll() {
        renderAttrCards();
        renderAttrConfigList();
        renderRuleConfigList();
        renderLog();
        const s = getSettings();
        const tog = el('ds-inject-toggle');
        if (tog)
            tog.checked = s.injectPrompt;
        const dep = el('ds-inject-depth');
        if (dep)
            dep.value = String(s.injectDepth);
    }
    // ── Event bindings ────────────────────────────────────────────
    function setupEvents() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
        (_a = el('ds-tab-status')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => switchTab('status'));
        (_b = el('ds-tab-config')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', () => switchTab('config'));
        (_c = el('ds-tab-history')) === null || _c === void 0 ? void 0 : _c.addEventListener('click', () => switchTab('history'));
        (_d = el('ds-refresh-btn')) === null || _d === void 0 ? void 0 : _d.addEventListener('click', renderAll);
        (_e = el('ds-inject-toggle')) === null || _e === void 0 ? void 0 : _e.addEventListener('change', () => {
            const s = getSettings();
            s.injectPrompt = (el('ds-inject-toggle')).checked;
            saveSettings();
            updatePrompt();
        });
        (_f = el('ds-inject-depth')) === null || _f === void 0 ? void 0 : _f.addEventListener('change', () => {
            const s = getSettings();
            s.injectDepth = Number((el('ds-inject-depth')).value);
            saveSettings();
            updatePrompt();
        });
        // Template buttons
        (_g = el('ds-template-list')) === null || _g === void 0 ? void 0 : _g.addEventListener('click', e => {
            const btn = e.target.closest('[data-tid]');
            if (btn)
                applyTemplate(btn.dataset.tid);
        });
        // Attribute list
        (_h = el('ds-new-attr-btn')) === null || _h === void 0 ? void 0 : _h.addEventListener('click', () => editAttr ? hideAttrForm() : showAttrForm());
        (_j = el('ds-attr-config-list')) === null || _j === void 0 ? void 0 : _j.addEventListener('click', e => {
            const t = e.target;
            const edit = t.closest('.ds-edit-attr');
            const del = t.closest('.ds-del-attr');
            const gen = t.closest('.ds-gen-rule');
            if (edit)
                showAttrForm(getSettings().attributes[Number(edit.dataset.idx)]);
            else if (del) {
                const key = del.dataset.key;
                if (!confirm(`删除属性「${key}」及其所有规则？`))
                    return;
                const s = getSettings();
                s.attributes = s.attributes.filter(a => a.key !== key);
                s.rules = s.rules.filter(r => r.attrKey !== key);
                saveSettings();
                updatePrompt();
                renderAttrConfigList();
                renderAttrCards();
                renderRuleConfigList();
                updateChatLorebook();
            }
            else if (gen)
                generateRulesForAttr(gen.dataset.key);
        });
        (_k = el('ds-save-attr-btn')) === null || _k === void 0 ? void 0 : _k.addEventListener('click', saveAttrForm);
        (_l = el('ds-cancel-attr-btn')) === null || _l === void 0 ? void 0 : _l.addEventListener('click', hideAttrForm);
        // Rule list
        (_m = el('ds-new-rule-btn')) === null || _m === void 0 ? void 0 : _m.addEventListener('click', () => editRule ? hideRuleForm() : showRuleForm());
        (_o = el('ds-rule-config-list')) === null || _o === void 0 ? void 0 : _o.addEventListener('click', e => {
            const t = e.target;
            const tog = t.closest('.ds-toggle-rule');
            const edit = t.closest('.ds-edit-rule');
            const del = t.closest('.ds-del-rule');
            if (tog) {
                const s = getSettings();
                const idx = Number(tog.dataset.idx);
                if (s.rules[idx]) {
                    s.rules[idx].enabled = !s.rules[idx].enabled;
                    saveSettings();
                    updatePrompt();
                    renderRuleConfigList();
                }
            }
            else if (edit)
                showRuleForm(getSettings().rules[Number(edit.dataset.idx)]);
            else if (del) {
                if (!confirm('删除此规则？'))
                    return;
                const s = getSettings();
                s.rules.splice(Number(del.dataset.idx), 1);
                saveSettings();
                updatePrompt();
                renderRuleConfigList();
            }
        });
        (_p = el('ds-save-rule-btn')) === null || _p === void 0 ? void 0 : _p.addEventListener('click', saveRuleForm);
        (_q = el('ds-cancel-rule-btn')) === null || _q === void 0 ? void 0 : _q.addEventListener('click', hideRuleForm);
        // Status card controls
        (_r = el('ds-attr-cards')) === null || _r === void 0 ? void 0 : _r.addEventListener('click', async (e) => {
            const btn = e.target.closest('.ds-btn-step');
            if (!btn)
                return;
            await applyDelta(btn.dataset.key, Number(btn.dataset.delta), '手动调整');
            renderAttrCards();
            renderLog();
        });
        (_s = el('ds-attr-cards')) === null || _s === void 0 ? void 0 : _s.addEventListener('change', async (e) => {
            const inp = e.target;
            if (!inp.classList.contains('ds-val-input'))
                return;
            await setVarDirect(inp.dataset.key, Number(inp.value));
            renderAttrCards();
        });
    }
    // ── ST event binding (fixed: use ctx.eventSource) ─────────────
    function bindSTEvents() {
        var _a;
        const ctx = getCtx();
        const es = ctx === null || ctx === void 0 ? void 0 : ctx.eventSource;
        const et = (_a = ctx === null || ctx === void 0 ? void 0 : ctx.eventTypes) !== null && _a !== void 0 ? _a : ctx === null || ctx === void 0 ? void 0 : ctx.event_types;
        if (!es || !et) {
            console.warn(LOG_PREFIX, 'eventSource 不可用，将在 3 秒后重试');
            setTimeout(bindSTEvents, 3000);
            return;
        }
        aiMsgHandler = async () => {
            if (generatingRules)
                return;
            const text = getLastAIMessage();
            if (!text)
                return;
            // Always strip tag first so it never shows, then apply
            await stripRulesTag();
            const changed = await parseAndApply(text);
            if (changed) {
                renderAttrCards();
                renderLog();
            }
        };
        es.on(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler);
        genEndedHandler = () => { if (generatingRules)
            handleRuleGenComplete(); };
        es.on(et.GENERATION_ENDED, genEndedHandler);
        // Re-render when chat switches (each chat is a separate archive)
        if (et.CHAT_CHANGED) {
            es.on(et.CHAT_CHANGED, () => { setTimeout(() => { renderAll(); updatePrompt(); syncAllStateVars(); updateChatLorebook(); }, 400); });
        }
    }
    function cleanup() {
        var _a, _b, _c;
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = 0;
        }
        const ctx = getCtx();
        const es = ctx === null || ctx === void 0 ? void 0 : ctx.eventSource;
        const et = (_a = ctx === null || ctx === void 0 ? void 0 : ctx.eventTypes) !== null && _a !== void 0 ? _a : ctx === null || ctx === void 0 ? void 0 : ctx.event_types;
        if (es && et) {
            if (aiMsgHandler && et.CHARACTER_MESSAGE_RENDERED)
                es.removeListener(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler);
            if (genEndedHandler && et.GENERATION_ENDED)
                es.removeListener(et.GENERATION_ENDED, genEndedHandler);
        }
        const depth = getSettings().injectDepth;
        (_b = ctx === null || ctx === void 0 ? void 0 : ctx.setExtensionPrompt) === null || _b === void 0 ? void 0 : _b.call(ctx, INJECT_KEY, '', 1, depth);
        (_c = ctx === null || ctx === void 0 ? void 0 : ctx.setExtensionPrompt) === null || _c === void 0 ? void 0 : _c.call(ctx, RULEGEN_KEY, '', 0, 0, false, 0);
        window[INIT_FLAG] = false;
    }
    // ── Init ──────────────────────────────────────────────────────
    function tryInit(retry = 0) {
        try {
            if (!getCtx())
                throw new Error('context not ready');
            renderAll();
            setupEvents();
            updatePrompt();
            bindSTEvents();
            setTimeout(async () => { await syncAllStateVars(); await updateChatLorebook(); }, 700);
            pollTimer = window.setInterval(() => { renderAttrCards(); renderLog(); }, 3000);
            window.addEventListener('beforeunload', cleanup);
            console.log(LOG_PREFIX, '初始化完成');
        }
        catch (err) {
            if (retry < 20)
                setTimeout(() => tryInit(retry + 1), 250);
            else
                console.error(LOG_PREFIX, '初始化失败:', err);
        }
    }
    tryInit();
})();
