/**
 * 动态系统 — 属性追踪模块（玩家友好，内置模板，AI生成规则）
 * 规则格式：是/否判定题，AI在回复末尾附加 {{ds_rules: R1=是, R2=否}}
 */
(function () {
    const INIT_FLAG = '__sb_ds_loaded__';
    if ((window as any)[INIT_FLAG]) return;
    (window as any)[INIT_FLAG] = true;

    const CFG_KEY    = 'sb_ds_config';
    const LOG_KEY    = 'sb_ds_log';
    const INJECT_KEY = 'simple-box-dynamic';
    const RULEGEN_KEY = 'sb-ds-rulegen';
    const LOG_PREFIX = '[动态系统]';

    // ── Interfaces ────────────────────────────────────────────────
    interface Threshold { min: number; label: string; }
    interface AttributeDef { key: string; label: string; min: number; max: number; defaultValue: number; step: number; character?: string; thresholds?: Threshold[]; }
    interface RuleDef { id: string; question: string; attrKey: string; yesDelta: number; noDelta: number; enabled: boolean; }
    interface LogEntry { time: number; label: string; delta: number; reason: string; }
    interface DSSettings { attributes: AttributeDef[]; rules: RuleDef[]; injectPrompt: boolean; injectDepth: number; }

    // ── Built-in templates ────────────────────────────────────────
    interface Template { id: string; name: string; desc: string; attributes: Omit<AttributeDef, 'key'>[]; ruleGenHint: string; }

    const TEMPLATES: Template[] = [
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
    function getCtx(): any { return (window as any).SillyTavern?.getContext?.(); }
    function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

    /** Returns the chatMetadata variable key for an attribute, e.g. "ds_alice_favorability" */
    function attrVarKey(a: AttributeDef): string {
        const char = (a.character || '').trim().toLowerCase().replace(/\s+/g, '_');
        return `ds_${char ? char + '_' : ''}${a.key}`;
    }
    /** Returns the state-label variable key, e.g. "ds_alice_favorability_state" */
    function stateVarKey(a: AttributeDef): string { return `${attrVarKey(a)}_state`; }

    // ── Threshold helpers ─────────────────────────────────────────
    /** Returns the label for the current value (highest threshold min ≤ val). */
    function getCurrentLabel(thresholds: Threshold[] | undefined, val: number): string {
        if (!thresholds || thresholds.length === 0) return '';
        const sorted = [...thresholds].sort((a, b) => b.min - a.min); // descending
        const match = sorted.find(t => val >= t.min);
        return match?.label ?? sorted[sorted.length - 1]?.label ?? '';
    }
    /** Parse textarea text "min: label" per line into Threshold[]. */
    function parseThresholds(text: string): Threshold[] {
        return text.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
            const m = line.match(/^(-?\d+(?:\.\d+)?)\s*[:：]\s*(.+)$/);
            return m ? { min: Number(m[1]), label: m[2].trim() } : null;
        }).filter((x): x is Threshold => x !== null);
    }
    /** Serialize Threshold[] back to textarea text. */
    function thresholdsToText(thresholds?: Threshold[]): string {
        if (!thresholds || thresholds.length === 0) return '';
        return [...thresholds].sort((a, b) => a.min - b.min).map(t => `${t.min}: ${t.label}`).join('\n');
    }

    // ── Lorebook integration ──────────────────────────────────────
    const WI_METADATA_KEY = 'world_info';
    const WI_ENTRY_MARKER = 'sb-dynamic-system';
    let _wiApi: any = null;

    async function getWiApi(): Promise<any> {
        if (_wiApi) return _wiApi;
        try { _wiApi = await (Function('return import("/scripts/world-info.js")')() as Promise<any>); } catch { /* no-op */ }
        return _wiApi;
    }

    /** Build the lorebook entry content: pure macros — AI reads the resolved label directly. */
    function buildLorebookContent(): string {
        const s = getSettings();
        const lines: string[] = ['【动态系统·角色当前状态】（此条目由动态系统自动维护）', ''];
        const charMap = new Map<string, AttributeDef[]>();
        for (const a of s.attributes) {
            const c = a.character || '';
            if (!charMap.has(c)) charMap.set(c, []);
            charMap.get(c)!.push(a);
        }
        charMap.forEach((attrs, char) => {
            if (char) lines.push(`【${char}】`);
            for (const a of attrs) {
                if (a.thresholds && a.thresholds.length > 0) {
                    // State macro resolves directly to the current label, no range chart needed
                    lines.push(`${a.label}：{{getvar::${stateVarKey(a)}}}`);
                } else {
                    lines.push(`${a.label}：{{getvar::${attrVarKey(a)}}}`);
                }
            }
            lines.push('');
        });
        return lines.join('\n').replace(/\s+$/, '');
    }

    /** Create / update the chat-bound lorebook entry with current attribute definitions. */
    async function updateChatLorebook(): Promise<void> {
        const ctx = getCtx();
        const s = getSettings();
        if (!ctx || s.attributes.length === 0) return;
        const wi = await getWiApi();
        if (!wi?.loadWorldInfo || !wi?.saveWorldInfo || !wi?.createWorldInfoEntry) return;
        // Ensure chat-bound lorebook exists
        let bookName: string = ctx.chatMetadata?.[WI_METADATA_KEY];
        if (!bookName) {
            await execSlash('/getchatbook');
            bookName = ctx.chatMetadata?.[WI_METADATA_KEY];
            if (!bookName) return;
        }
        const data = await wi.loadWorldInfo(bookName);
        if (!data?.entries) return;
        let entry = Object.values(data.entries).find((e: any) => e.comment === WI_ENTRY_MARKER) as any;
        if (!entry) {
            entry = wi.createWorldInfoEntry(bookName, data);
            if (!entry) return;
            entry.comment  = WI_ENTRY_MARKER;
            entry.constant = true;
            entry.disable  = false;
            entry.key      = [];
            entry.keysecondary = [];
        }
        entry.content = buildLorebookContent();
        await wi.saveWorldInfo(bookName, data, true);
        console.log(LOG_PREFIX, '已更新世界书条目');
    }

    const DEFAULTS: DSSettings = { attributes: [], rules: [], injectPrompt: true, injectDepth: 0 };

    function getSettings(): DSSettings {
        const ctx = getCtx();
        const meta = ctx?.chatMetadata;
        if (!meta) return { ...DEFAULTS };
        if (!meta[CFG_KEY]) meta[CFG_KEY] = { ...DEFAULTS };
        const s = meta[CFG_KEY] as DSSettings;
        if (!Array.isArray(s.rules)) s.rules = [];
        if (!Array.isArray(s.attributes)) s.attributes = [];
        if (typeof s.injectDepth !== 'number') s.injectDepth = 0;
        return s;
    }

    function saveSettings(): void {
        const ctx = getCtx();
        if (!ctx?.chatMetadata) return;
        (window as any).saveChatDebounced?.();
    }

    function getVarNum(attr: AttributeDef): number {
        const raw = getCtx()?.chatMetadata?.variables?.[attrVarKey(attr)];
        return raw !== undefined ? Number(raw) : attr.defaultValue;
    }

    function getChatLog(): LogEntry[] { return getCtx()?.chatMetadata?.[LOG_KEY] ?? []; }

    function appendLog(entry: LogEntry): void {
        const ctx = getCtx();
        if (!ctx?.chatMetadata) return;
        if (!ctx.chatMetadata[LOG_KEY]) ctx.chatMetadata[LOG_KEY] = [];
        ctx.chatMetadata[LOG_KEY].unshift(entry);
        if (ctx.chatMetadata[LOG_KEY].length > 200) ctx.chatMetadata[LOG_KEY].length = 200;
    }

    async function execSlash(cmd: string): Promise<void> {
        const ctx = getCtx();
        if (ctx?.executeSlashCommandsWithOptions) await ctx.executeSlashCommandsWithOptions(cmd);
    }

    function clamp(attr: AttributeDef, val: number): number { return Math.max(attr.min, Math.min(attr.max, Math.round(val))); }

    /** Sync the _state label variable based on current numeric value. */
    async function syncStateVar(attr: AttributeDef, val?: number): Promise<void> {
        if (!attr.thresholds || attr.thresholds.length === 0) return;
        const v = val !== undefined ? val : getVarNum(attr);
        const label = getCurrentLabel(attr.thresholds, v);
        if (!label) return;
        await execSlash(`/setvar key=${stateVarKey(attr)} ${label}`);
    }
    /** Sync all _state variables from current numeric values (call on init / chat change). */
    async function syncAllStateVars(): Promise<void> {
        for (const a of getSettings().attributes) await syncStateVar(a);
    }

    async function applyDelta(attrKey: string, delta: number, reason: string): Promise<void> {
        const attr = getSettings().attributes.find(a => a.key === attrKey);
        if (!attr || delta === 0) return;
        const current = getVarNum(attr);
        const actual = clamp(attr, current + delta) - current;
        if (actual === 0) return;
        const newVal = current + actual;
        await execSlash(`/addvar key=${attrVarKey(attr)} ${actual}`);
        await syncStateVar(attr, newVal);
        const logLabel = attr.character ? `${attr.character} · ${attr.label}` : attr.label;
        appendLog({ time: Date.now(), label: logLabel, delta: actual, reason });
    }

    async function setVarDirect(attrKey: string, val: number): Promise<void> {
        const attr = getSettings().attributes.find(a => a.key === attrKey);
        if (!attr) return;
        const clamped = clamp(attr, val);
        await execSlash(`/setvar key=${attrVarKey(attr)} ${clamped}`);
        await syncStateVar(attr, clamped);
    }

    function updatePrompt(): void {
        const ctx = getCtx();
        if (!ctx?.setExtensionPrompt) return;
        const s = getSettings();
        if (!s.injectPrompt || s.attributes.length === 0) { ctx.setExtensionPrompt(INJECT_KEY, '', 1, s.injectDepth); return; }

        // Group attributes by character (empty = global)
        const charMap = new Map<string, AttributeDef[]>();
        for (const a of s.attributes) {
            const c = a.character || '';
            if (!charMap.has(c)) charMap.set(c, []);
            charMap.get(c)!.push(a);
        }

        const lines: string[] = ['【动态属性追踪系统】'];
        charMap.forEach((attrs, char) => {
            if (char) lines.push(`\n== ${char} ==`);
            else if (charMap.size > 1) lines.push('');
            for (const a of attrs) {
                const val = getVarNum(a);
                const label = getCurrentLabel(a.thresholds, val);
                lines.push(`  ${a.label}：${val}（${a.min}～${a.max}）${label ? ` → ${label}` : ''}`);
            }
        });

        const enabled = s.rules.filter(r => r.enabled && r.question.trim());
        if (enabled.length > 0) {
            lines.push('', '请在每条回复【最后一行】附加判定（不可省略）：');
            lines.push('{{ds_rules: ' + enabled.map((_, i) => `R${i+1}=是/否`).join(', ') + '}}');
            lines.push('', '判定规则（根据本次回复内容作答）：');
            enabled.forEach((r, i) => {
                const attr = s.attributes.find(a => a.key === r.attrKey);
                const lbl = attr ? (attr.character ? `${attr.character}·${attr.label}` : attr.label) : r.attrKey;
                const y = r.yesDelta !== 0 ? `${lbl}${r.yesDelta>0?'+':''}${r.yesDelta}` : '无变化';
                const n = r.noDelta !== 0 ? `${lbl}${r.noDelta>0?'+':''}${r.noDelta}` : '无变化';
                lines.push(`  R${i+1}：${r.question}（是→${y}，否→${n}）`);
            });
        }
        ctx.setExtensionPrompt(INJECT_KEY, lines.join('\n'), 1, s.injectDepth);
    }

    async function parseAndApply(text: string): Promise<boolean> {
        const s = getSettings();
        const enabled = s.rules.filter(r => r.enabled && r.question.trim());
        if (enabled.length === 0) return false;
        const m = text.match(/\{\{ds_rules:\s*([\s\S]*?)\}\}/);
        if (!m) return false;
        let changed = false;
        for (const part of m[1].split(',')) {
            const pm = part.trim().match(/R(\d+)\s*=\s*(是|否|yes|no)/i);
            if (!pm) continue;
            const idx = parseInt(pm[1]) - 1;
            const isYes = /^(是|yes)$/i.test(pm[2]);
            const rule = enabled[idx];
            if (!rule) continue;
            const delta = isYes ? rule.yesDelta : rule.noDelta;
            if (delta !== 0) { await applyDelta(rule.attrKey, delta, isYes ? '规则触发（是）' : '规则触发（否）'); changed = true; }
        }
        return changed;
    }

    function getLastAIMessage(): string {
        const chat: any[] = getCtx()?.chat ?? [];
        for (let i = chat.length - 1; i >= 0; i--) { const m = chat[i]; if (!m.is_user && !m.is_system) return m.mes ?? ''; }
        return '';
    }

    // ── AI rule generation ────────────────────────────────────────
    let generatingRules = false;
    let ruleGenAttrKey = '';

    async function generateRulesForAttr(attrKey: string): Promise<void> {
        if (generatingRules) { if (typeof toastr !== 'undefined') toastr.warning('正在生成中，请稍候…', '动态系统'); return; }
        const s = getSettings();
        const attr = s.attributes.find(a => a.key === attrKey);
        if (!attr) return;
        const tpl = TEMPLATES.find(t => t.attributes.some(a => a.label === attr.label));
        const hint = tpl?.ruleGenHint ?? `${attr.label}属性变化`;
        generatingRules = true;
        ruleGenAttrKey = attrKey;
        setGenStatus(`正在为「${attr.label}」生成规则…`);
        const ctx = getCtx();
        const prompt =
`请根据当前角色卡的人设与世界观，为属性「${attr.label}（${attr.min}～${attr.max}）」生成3～5条判定规则。
要求：每条规则是一个用"是/否"回答的问题，与${hint}高度相关。
严格只输出以下JSON，不含其他内容：
[{"question":"问题？","yesDelta":5,"noDelta":0}]`;
        ctx?.setExtensionPrompt?.(RULEGEN_KEY, prompt, 0, 0, false, 0);
        await delay(150);
        try { await ctx?.executeSlashCommandsWithOptions?.('/trigger'); } catch { /* fallback */ }
    }

    async function handleRuleGenComplete(): Promise<void> {
        if (!generatingRules) return;
        generatingRules = false;
        const ctx = getCtx();
        ctx?.setExtensionPrompt?.(RULEGEN_KEY, '', 0, 0, false, 0);
        const text = getLastAIMessage();
        const chat: any[] = ctx?.chat ?? [];
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i]?.is_user && !chat[i]?.is_system) { try { await ctx?.deleteMessage(i); } catch {} break; }
        }
        try {
            const jm = text.match(/\[[\s\S]*\]/);
            if (!jm) throw new Error('no JSON');
            const parsed: Array<{question:string;yesDelta:number;noDelta:number}> = JSON.parse(jm[0]);
            const s = getSettings();
            for (const r of parsed) {
                if (r.question && typeof r.yesDelta === 'number') {
                    s.rules.push({ id: Date.now().toString(36)+Math.random().toString(36).slice(2), question: r.question, attrKey: ruleGenAttrKey, yesDelta: r.yesDelta, noDelta: r.noDelta ?? 0, enabled: true });
                }
            }
            saveSettings(); updatePrompt(); renderRuleConfigList();
            setGenStatus(`已生成 ${parsed.length} 条规则`);
            if (typeof toastr !== 'undefined') toastr.success(`已生成 ${parsed.length} 条规则`, '动态系统');
        } catch { setGenStatus('解析失败，请重试'); }
    }

    function setGenStatus(msg: string): void { const e = document.getElementById('ds-gen-status'); if (e) e.textContent = msg; }

    // ── Strip {{ds_rules:…}} from displayed message ───────────────
    const RULES_TAG_RE = /\s*\{\{ds_rules:[^}]*\}\}/g;

    async function stripRulesTag(): Promise<void> {
        const ctx = getCtx();
        const chat: any[] = ctx?.chat ?? [];
        let mesIdx = -1;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i]?.is_user && !chat[i]?.is_system) { mesIdx = i; break; }
        }
        if (mesIdx < 0) return;
        const msg = chat[mesIdx];
        const original: string = msg?.mes ?? '';
        const stripped = original.replace(RULES_TAG_RE, '').replace(/\s+$/, '');
        if (stripped === original) return;
        msg.mes = stripped;
        // Update rendered DOM element
        const mesTextEl = document.querySelector(`#chat .mes[mesid="${mesIdx}"] .mes_text`);
        if (mesTextEl) {
            mesTextEl.innerHTML = mesTextEl.innerHTML.replace(RULES_TAG_RE, '');
        }
        (window as any).saveChatDebounced?.();
    }

    // ── UI state ──────────────────────────────────────────────────
    let editAttr: AttributeDef | null = null;
    let editAttrIsNew = false;
    let editRule: RuleDef | null = null;
    let editRuleIsNew = false;
    let pollTimer = 0;
    let aiMsgHandler: ((data: any) => void) | null = null;
    let genEndedHandler: (() => void) | null = null;

    function el<T extends HTMLElement>(id: string): T | null { return document.getElementById(id) as T | null; }
    function esc(s: string): string { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function switchTab(tab: string): void {
        (['status', 'config', 'history'] as const).forEach(t => {
            const p = el(`ds-panel-${t}`); const b = el(`ds-tab-${t}`);
            if (p) p.style.display = t === tab ? '' : 'none';
            if (b) b.classList.toggle('active', t === tab);
        });
    }

    function renderAttrCards(): void {
        const c = el('ds-attr-cards'); if (!c) return;
        const attrs = getSettings().attributes;
        if (attrs.length === 0) { c.innerHTML = `<div class="ds-empty"><i class="fa-solid fa-circle-plus" style="font-size:24px"></i><span>还没有属性，请在「配置」中添加或选择模板</span></div>`; return; }
        const charMap = new Map<string, AttributeDef[]>();
        for (const a of attrs) { const c2 = a.character || ''; if (!charMap.has(c2)) charMap.set(c2, []); charMap.get(c2)!.push(a); }
        let html = '';
        charMap.forEach((list, char) => {
            if (char) html += `<div class="ds-char-group-hd"><i class="fa-solid fa-user"></i> ${esc(char)}</div>`;
            html += list.map(a => {
                const val = getVarNum(a);
                const pct = a.max > a.min ? Math.max(0, Math.min(100, ((val - a.min) / (a.max - a.min)) * 100)) : 0;
                return `<div class="ds-card"><div class="ds-card-head"><span class="ds-card-label">${esc(a.label)}</span><span class="ds-card-val">${val}</span><span class="ds-card-max">/${a.max}</span></div><div class="ds-progress-track"><div class="ds-progress-fill" style="width:${pct}%"></div></div><div class="ds-card-controls"><button class="ds-btn-step" data-key="${esc(a.key)}" data-delta="${-a.step}">−${a.step}</button><input type="number" class="ds-val-input" data-key="${esc(a.key)}" value="${val}"/><button class="ds-btn-step" data-key="${esc(a.key)}" data-delta="${a.step}">+${a.step}</button></div></div>`;
            }).join('');
        });
        c.innerHTML = html;
    }

    function renderAttrConfigList(): void {
        const c = el('ds-attr-config-list'); if (!c) return;
        const attrs = getSettings().attributes;
        c.innerHTML = attrs.length === 0 ? `<div class="ds-empty-sm">暂无属性</div>`
            : attrs.map((a, i) => {
                const charBadge = a.character ? `<span class="ds-list-char">${esc(a.character)}</span>` : '';
                return `<div class="ds-list-item">${charBadge}<span class="ds-list-label">${esc(a.label)}</span><span class="ds-list-key" title="{{getvar::${attrVarKey(a)}}}">${esc(attrVarKey(a))}</span><span class="ds-list-range">[${a.min}~${a.max}]</span><button class="ds-icon-btn ds-gen-rule" data-key="${esc(a.key)}" title="AI生成规则"><i class="fa-solid fa-wand-magic-sparkles"></i></button><button class="ds-icon-btn ds-edit-attr" data-idx="${i}" title="编辑"><i class="fa-solid fa-pen"></i></button><button class="ds-icon-btn ds-del ds-del-attr" data-key="${esc(a.key)}" title="删除"><i class="fa-solid fa-trash"></i></button></div>`;
            }).join('');
    }

    function renderRuleConfigList(): void {
        const c = el('ds-rule-config-list'); if (!c) return;
        const s = getSettings();
        c.innerHTML = s.rules.length === 0 ? `<div class="ds-empty-sm">暂无规则</div>`
            : s.rules.map((r, i) => {
                const lbl = s.attributes.find(a => a.key === r.attrKey)?.label ?? r.attrKey;
                const y = r.yesDelta !== 0 ? `是→${r.yesDelta>0?'+':''}${r.yesDelta}` : '';
                const n = r.noDelta !== 0 ? `否→${r.noDelta>0?'+':''}${r.noDelta}` : '';
                const q = r.question.length > 22 ? r.question.slice(0,22)+'…' : r.question;
                return `<div class="ds-list-item"><i class="fa-solid ${r.enabled ? 'fa-toggle-on ds-toggle-on' : 'fa-toggle-off ds-toggle-off'} ds-toggle-rule" data-idx="${i}" style="cursor:pointer"></i><span class="ds-list-label" title="${esc(r.question)}">${esc(q)}</span><span class="ds-list-key">${esc(lbl)}</span><span class="ds-list-range">${esc([y,n].filter(Boolean).join(' '))}</span><button class="ds-icon-btn ds-edit-rule" data-idx="${i}"><i class="fa-solid fa-pen"></i></button><button class="ds-icon-btn ds-del ds-del-rule" data-idx="${i}"><i class="fa-solid fa-trash"></i></button></div>`;
            }).join('');
    }

    // ── Attr form ─────────────────────────────────────────────────
    function showAttrForm(attr?: AttributeDef): void {
        editAttr = attr ? JSON.parse(JSON.stringify(attr)) : { key: '', label: '', min: 0, max: 100, defaultValue: 50, step: 5, character: '', behaviorHint: '' };
        editAttrIsNew = !attr;
        const form = el('ds-attr-form'); if (!form) return;
        form.style.display = '';
        (el('ds-attr-form-title') as HTMLElement).textContent = editAttrIsNew ? '新建属性' : `编辑：${editAttr!.label}`;
        (el('ds-attr-key') as HTMLInputElement).value = editAttr!.key;
        (el('ds-attr-key') as HTMLInputElement).disabled = !editAttrIsNew;
        (el('ds-attr-label') as HTMLInputElement).value = editAttr!.label;
        (el('ds-attr-min') as HTMLInputElement).value = String(editAttr!.min);
        (el('ds-attr-max') as HTMLInputElement).value = String(editAttr!.max);
        (el('ds-attr-default') as HTMLInputElement).value = String(editAttr!.defaultValue);
        (el('ds-attr-step') as HTMLInputElement).value = String(editAttr!.step);
        (el('ds-attr-character') as HTMLInputElement).value = editAttr!.character || '';
        (el('ds-attr-thresholds') as HTMLTextAreaElement).value = thresholdsToText(editAttr!.thresholds);
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function hideAttrForm(): void { editAttr = null; const f = el('ds-attr-form'); if (f) f.style.display = 'none'; }

    function saveAttrForm(): void {
        if (!editAttr) return;
        if (editAttrIsNew) editAttr.key = (el('ds-attr-key') as HTMLInputElement).value.trim();
        editAttr.label       = (el('ds-attr-label') as HTMLInputElement).value.trim();
        editAttr.min         = Number((el('ds-attr-min') as HTMLInputElement).value);
        editAttr.max         = Number((el('ds-attr-max') as HTMLInputElement).value);
        editAttr.defaultValue = Number((el('ds-attr-default') as HTMLInputElement).value);
        editAttr.step        = Number((el('ds-attr-step') as HTMLInputElement).value) || 1;
        editAttr.character  = (el('ds-attr-character') as HTMLInputElement).value.trim() || undefined;
        const thr = parseThresholds((el('ds-attr-thresholds') as HTMLTextAreaElement).value);
        editAttr.thresholds = thr.length > 0 ? thr : undefined;
        if (!editAttr.key || !editAttr.label) { if (typeof toastr !== 'undefined') toastr.warning('Key 和名称不能为空', '动态系统'); return; }
        const s = getSettings();
        if (editAttrIsNew) s.attributes.push(editAttr);
        else { const i = s.attributes.findIndex(a => a.key === editAttr!.key); if (i >= 0) s.attributes[i] = editAttr; }
        saveSettings(); updatePrompt(); hideAttrForm(); renderAttrConfigList(); renderAttrCards();
        updateChatLorebook();
    }

    // ── Rule form ─────────────────────────────────────────────────
    function showRuleForm(rule?: RuleDef): void {
        const s = getSettings();
        editRule = rule ? JSON.parse(JSON.stringify(rule)) : { id: Date.now().toString(36), question: '', attrKey: s.attributes[0]?.key ?? '', yesDelta: 5, noDelta: 0, enabled: true };
        editRuleIsNew = !rule;
        const form = el('ds-rule-form'); if (!form) return;
        form.style.display = '';
        (el('ds-rule-form-title') as HTMLElement).textContent = editRuleIsNew ? '新建规则' : '编辑规则';
        (el('ds-rule-question') as HTMLTextAreaElement).value = editRule!.question;
        (el('ds-rule-yes-delta') as HTMLInputElement).value = String(editRule!.yesDelta);
        (el('ds-rule-no-delta') as HTMLInputElement).value = String(editRule!.noDelta);
        const sel = el<HTMLSelectElement>('ds-rule-attr');
        if (sel) sel.innerHTML = s.attributes.map(a => `<option value="${esc(a.key)}" ${a.key === editRule!.attrKey ? 'selected' : ''}>${esc(a.label)}</option>`).join('');
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function hideRuleForm(): void { editRule = null; const f = el('ds-rule-form'); if (f) f.style.display = 'none'; }

    function saveRuleForm(): void {
        if (!editRule) return;
        editRule.question = (el('ds-rule-question') as HTMLTextAreaElement).value.trim();
        editRule.attrKey = (el<HTMLSelectElement>('ds-rule-attr'))?.value ?? '';
        editRule.yesDelta = Number((el('ds-rule-yes-delta') as HTMLInputElement).value);
        editRule.noDelta = Number((el('ds-rule-no-delta') as HTMLInputElement).value);
        if (!editRule.question || !editRule.attrKey) { if (typeof toastr !== 'undefined') toastr.warning('问题和属性不能为空', '动态系统'); return; }
        const s = getSettings();
        if (editRuleIsNew) s.rules.push(editRule);
        else { const i = s.rules.findIndex(r => r.id === editRule!.id); if (i >= 0) s.rules[i] = editRule; }
        saveSettings(); updatePrompt(); hideRuleForm(); renderRuleConfigList();
    }

    // ── Template apply ────────────────────────────────────────────
    function applyTemplate(tid: string): void {
        const tpl = TEMPLATES.find(t => t.id === tid);
        if (!tpl || tpl.attributes.length === 0) return;
        const charInput = window.prompt(
            `应用模板「${tpl.name}」\n\n角色名称（留空表示全局/通用）：`,
            ''
        );
        if (charInput === null) return; // cancelled
        const character = charInput.trim() || undefined;
        const charPrefix = character ? character.toLowerCase().replace(/\s+/g, '_') + '_' : '';
        const s = getSettings();
        for (const a of tpl.attributes) {
            const key = charPrefix + (a.label.replace(/[^\w\u4e00-\u9fa5]/g, '') || a.label.charCodeAt(0).toString());
            if (!s.attributes.find(x => x.key === key)) s.attributes.push({ key, ...a, character });
        }
        saveSettings(); updatePrompt(); renderAttrConfigList(); renderAttrCards();
        if (typeof toastr !== 'undefined') toastr.success(`已添加 ${tpl.attributes.length} 个属性${character ? `（角色：${character}）` : ''}`, '动态系统');
        updateChatLorebook();
    }

    // ── Log & renderAll ───────────────────────────────────────────
    function renderLog(): void {
        const c = el('ds-log-list'); if (!c) return;
        const entries = getChatLog();
        if (entries.length === 0) { c.innerHTML = `<div class="ds-empty"><i class="fa-solid fa-scroll" style="font-size:24px"></i><span>暂无变更记录</span></div>`; return; }
        c.innerHTML = entries.map(e => {
            const sign = e.delta >= 0 ? '+' : '';
            const cls = e.delta >= 0 ? 'ds-log-pos' : 'ds-log-neg';
            const d = new Date(e.time);
            const t = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            return `<div class="ds-log-row"><span class="ds-log-time">${t}</span><span class="ds-log-label">${esc(e.label)}</span><span class="${cls}">${sign}${e.delta}</span><span class="ds-log-reason">${esc(e.reason)}</span></div>`;
        }).join('');
    }

    function renderAll(): void {
        renderAttrCards(); renderAttrConfigList(); renderRuleConfigList(); renderLog();
        const s = getSettings();
        const tog = el<HTMLInputElement>('ds-inject-toggle');
        if (tog) tog.checked = s.injectPrompt;
        const dep = el<HTMLSelectElement>('ds-inject-depth');
        if (dep) dep.value = String(s.injectDepth);
    }

    // ── Event bindings ────────────────────────────────────────────
    function setupEvents(): void {
        el('ds-tab-status')?.addEventListener('click', () => switchTab('status'));
        el('ds-tab-config')?.addEventListener('click', () => switchTab('config'));
        el('ds-tab-history')?.addEventListener('click', () => switchTab('history'));
        el('ds-refresh-btn')?.addEventListener('click', renderAll);

        el('ds-inject-toggle')?.addEventListener('change', () => {
            const s = getSettings(); s.injectPrompt = (el<HTMLInputElement>('ds-inject-toggle'))!.checked;
            saveSettings(); updatePrompt();
        });

        el('ds-inject-depth')?.addEventListener('change', () => {
            const s = getSettings();
            s.injectDepth = Number((el<HTMLSelectElement>('ds-inject-depth'))!.value);
            saveSettings(); updatePrompt();
        });

        // Template buttons
        el('ds-template-list')?.addEventListener('click', e => {
            const btn = (e.target as HTMLElement).closest('[data-tid]') as HTMLElement | null;
            if (btn) applyTemplate(btn.dataset.tid!);
        });

        // Attribute list
        el('ds-new-attr-btn')?.addEventListener('click', () => editAttr ? hideAttrForm() : showAttrForm());
        el('ds-attr-config-list')?.addEventListener('click', e => {
            const t = e.target as HTMLElement;
            const edit = t.closest('.ds-edit-attr') as HTMLElement | null;
            const del = t.closest('.ds-del-attr') as HTMLElement | null;
            const gen = t.closest('.ds-gen-rule') as HTMLElement | null;
            if (edit) showAttrForm(getSettings().attributes[Number(edit.dataset.idx)]);
            else if (del) {
                const key = del.dataset.key!;
                if (!confirm(`删除属性「${key}」及其所有规则？`)) return;
                const s = getSettings();
                s.attributes = s.attributes.filter(a => a.key !== key);
                s.rules = s.rules.filter(r => r.attrKey !== key);
                saveSettings(); updatePrompt(); renderAttrConfigList(); renderAttrCards(); renderRuleConfigList();
                updateChatLorebook();
            } else if (gen) generateRulesForAttr(gen.dataset.key!);
        });
        el('ds-save-attr-btn')?.addEventListener('click', saveAttrForm);
        el('ds-cancel-attr-btn')?.addEventListener('click', hideAttrForm);

        // Rule list
        el('ds-new-rule-btn')?.addEventListener('click', () => editRule ? hideRuleForm() : showRuleForm());
        el('ds-rule-config-list')?.addEventListener('click', e => {
            const t = e.target as HTMLElement;
            const tog = t.closest('.ds-toggle-rule') as HTMLElement | null;
            const edit = t.closest('.ds-edit-rule') as HTMLElement | null;
            const del = t.closest('.ds-del-rule') as HTMLElement | null;
            if (tog) {
                const s = getSettings(); const idx = Number(tog.dataset.idx);
                if (s.rules[idx]) { s.rules[idx].enabled = !s.rules[idx].enabled; saveSettings(); updatePrompt(); renderRuleConfigList(); }
            } else if (edit) showRuleForm(getSettings().rules[Number(edit.dataset.idx)]);
            else if (del) {
                if (!confirm('删除此规则？')) return;
                const s = getSettings(); s.rules.splice(Number(del.dataset.idx), 1);
                saveSettings(); updatePrompt(); renderRuleConfigList();
            }
        });
        el('ds-save-rule-btn')?.addEventListener('click', saveRuleForm);
        el('ds-cancel-rule-btn')?.addEventListener('click', hideRuleForm);

        // Status card controls
        el('ds-attr-cards')?.addEventListener('click', async e => {
            const btn = (e.target as HTMLElement).closest('.ds-btn-step') as HTMLElement | null;
            if (!btn) return;
            await applyDelta(btn.dataset.key!, Number(btn.dataset.delta), '手动调整');
            renderAttrCards(); renderLog();
        });
        el('ds-attr-cards')?.addEventListener('change', async e => {
            const inp = e.target as HTMLInputElement;
            if (!inp.classList.contains('ds-val-input')) return;
            await setVarDirect(inp.dataset.key!, Number(inp.value));
            renderAttrCards();
        });
    }

    // ── ST event binding (fixed: use ctx.eventSource) ─────────────
    function bindSTEvents(): void {
        const ctx = getCtx();
        const es = ctx?.eventSource;
        const et = ctx?.eventTypes ?? ctx?.event_types;
        if (!es || !et) { console.warn(LOG_PREFIX, 'eventSource 不可用，将在 3 秒后重试'); setTimeout(bindSTEvents, 3000); return; }

        aiMsgHandler = async () => {
            if (generatingRules) return;
            const text = getLastAIMessage();
            if (!text) return;
            // Always strip tag first so it never shows, then apply
            await stripRulesTag();
            const changed = await parseAndApply(text);
            if (changed) { renderAttrCards(); renderLog(); }
        };
        es.on(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler);

        genEndedHandler = () => { if (generatingRules) handleRuleGenComplete(); };
        es.on(et.GENERATION_ENDED, genEndedHandler);

        // Re-render when chat switches (each chat is a separate archive)
        if (et.CHAT_CHANGED) {
            es.on(et.CHAT_CHANGED, () => { setTimeout(() => { renderAll(); updatePrompt(); syncAllStateVars(); updateChatLorebook(); }, 400); });
        }
    }

    function cleanup(): void {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
        const ctx = getCtx();
        const es = ctx?.eventSource; const et = ctx?.eventTypes ?? ctx?.event_types;
        if (es && et) {
            if (aiMsgHandler && et.CHARACTER_MESSAGE_RENDERED) es.removeListener(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler);
            if (genEndedHandler && et.GENERATION_ENDED) es.removeListener(et.GENERATION_ENDED, genEndedHandler);
        }
        const depth = getSettings().injectDepth;
        ctx?.setExtensionPrompt?.(INJECT_KEY, '', 1, depth);
        ctx?.setExtensionPrompt?.(RULEGEN_KEY, '', 0, 0, false, 0);
        (window as any)[INIT_FLAG] = false;
    }

    // ── Init ──────────────────────────────────────────────────────
    function tryInit(retry: number = 0): void {
        try {
            if (!getCtx()) throw new Error('context not ready');
            renderAll();
            setupEvents();
            updatePrompt();
            bindSTEvents();
            setTimeout(async () => { await syncAllStateVars(); await updateChatLorebook(); }, 700);
            pollTimer = window.setInterval(() => { renderAttrCards(); renderLog(); }, 3000);
            window.addEventListener('beforeunload', cleanup);
            console.log(LOG_PREFIX, '初始化完成');
        } catch (err) {
            if (retry < 20) setTimeout(() => tryInit(retry + 1), 250);
            else console.error(LOG_PREFIX, '初始化失败:', err);
        }
    }

    tryInit();

})();
