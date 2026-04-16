/**
 * 动态系统 — 属性追踪模块（玩家友好，内置模板，AI生成规则）
 * 规则格式：是/否判定题，AI在回复末尾附加 {{ds_rules: R1=是, R2=否}}
 */
(function () {
    const INIT_FLAG = '__sb_ds_loaded__';
    if ((window as any)[INIT_FLAG]) return;
    (window as any)[INIT_FLAG] = true;

    const EXT_KEY    = 'simple-box-dynamic';
    const LOG_KEY    = 'sb_ds_log';
    const INJECT_KEY = 'simple-box-dynamic';
    const RULEGEN_KEY = 'sb-ds-rulegen';
    const LOG_PREFIX = '[动态系统]';

    // ── Interfaces ────────────────────────────────────────────────
    interface AttributeDef { key: string; label: string; min: number; max: number; defaultValue: number; step: number; }
    interface RuleDef { id: string; question: string; attrKey: string; yesDelta: number; noDelta: number; enabled: boolean; }
    interface LogEntry { time: number; label: string; delta: number; reason: string; }
    interface DSSettings { attributes: AttributeDef[]; rules: RuleDef[]; injectPrompt: boolean; }

    // ── Built-in templates ────────────────────────────────────────
    interface Template { id: string; name: string; desc: string; attributes: Omit<AttributeDef, 'key'>[]; ruleGenHint: string; }

    const TEMPLATES: Template[] = [
        {
            id: 'affection',
            name: '好感度系统',
            desc: '追踪角色对玩家的好感与信任',
            attributes: [
                { label: '好感度', min: -100, max: 100, defaultValue: 0, step: 5 },
                { label: '信任度', min: 0, max: 100, defaultValue: 50, step: 5 },
            ],
            ruleGenHint: '好感度和信任度变化，关注玩家行为是否让角色产生好感/反感、信任/不信任',
        },
        {
            id: 'growth',
            name: '成长系统',
            desc: '追踪技能、能力或经验成长',
            attributes: [
                { label: '经验值', min: 0, max: 1000, defaultValue: 0, step: 10 },
                { label: '熟练度', min: 0, max: 100, defaultValue: 0, step: 3 },
            ],
            ruleGenHint: '经验与技能成长，关注角色是否经历了有价值的战斗、学习或成长事件',
        },
        {
            id: 'lust',
            name: '情欲系统',
            desc: '追踪欲望与亲密关系状态',
            attributes: [
                { label: '情欲值', min: 0, max: 100, defaultValue: 0, step: 5 },
                { label: '羞耻感', min: 0, max: 100, defaultValue: 50, step: 5 },
            ],
            ruleGenHint: '情欲与亲密程度变化，关注性相关行为、身体接触、心理状态变化',
        },
        {
            id: 'mood',
            name: '情绪系统',
            desc: '追踪角色当前心情与精神状态',
            attributes: [
                { label: '心情', min: -50, max: 50, defaultValue: 0, step: 5 },
                { label: '压力值', min: 0, max: 100, defaultValue: 20, step: 5 },
            ],
            ruleGenHint: '心情与压力变化，关注角色是否遭受压力、挫折或获得愉悦、放松',
        },
    ];

    // ── Core helpers ──────────────────────────────────────────────
    function getCtx(): any { return (window as any).SillyTavern?.getContext?.(); }
    function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

    function getSettings(): DSSettings {
        const w = window as any;
        if (!w.extension_settings) w.extension_settings = {};
        if (!w.extension_settings[EXT_KEY]) w.extension_settings[EXT_KEY] = { attributes: [], rules: [], injectPrompt: true };
        const s = w.extension_settings[EXT_KEY] as DSSettings;
        if (!Array.isArray(s.rules)) s.rules = [];
        return s;
    }

    function saveSettings(): void { (window as any).saveSettingsDebounced?.(); }

    function getVarNum(key: string): number {
        const raw = getCtx()?.chatMetadata?.variables?.[`ds_${key}`];
        return raw !== undefined ? Number(raw) : (getSettings().attributes.find(a => a.key === key)?.defaultValue ?? 0);
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

    async function applyDelta(attrKey: string, delta: number, reason: string): Promise<void> {
        const attr = getSettings().attributes.find(a => a.key === attrKey);
        if (!attr || delta === 0) return;
        const actual = clamp(attr, getVarNum(attrKey) + delta) - getVarNum(attrKey);
        if (actual === 0) return;
        await execSlash(`/addvar key=ds_${attrKey} ${actual}`);
        appendLog({ time: Date.now(), label: attr.label, delta: actual, reason });
    }

    async function setVarDirect(attrKey: string, val: number): Promise<void> {
        const attr = getSettings().attributes.find(a => a.key === attrKey);
        if (!attr) return;
        await execSlash(`/setvar key=ds_${attrKey} ${clamp(attr, val)}`);
    }

    function updatePrompt(): void {
        const ctx = getCtx();
        if (!ctx?.setExtensionPrompt) return;
        const s = getSettings();
        if (!s.injectPrompt || s.attributes.length === 0) { ctx.setExtensionPrompt(INJECT_KEY, '', 1, 9000); return; }
        const attrLines = s.attributes.map(a => `  ${a.label}：${getVarNum(a.key)}（范围 ${a.min}～${a.max}）`);
        const enabled = s.rules.filter(r => r.enabled && r.question.trim());
        const lines = ['【动态属性追踪系统】', '当前属性：', ...attrLines];
        if (enabled.length > 0) {
            lines.push('', `请在每条回复【最后一行】附加判定（不可省略）：`);
            lines.push('{{ds_rules: ' + enabled.map((_, i) => `R${i+1}=是/否`).join(', ') + '}}');
            lines.push('', '判定规则（根据本次回复内容作答）：');
            enabled.forEach((r, i) => {
                const attr = s.attributes.find(a => a.key === r.attrKey);
                const lbl = attr?.label ?? r.attrKey;
                const y = r.yesDelta !== 0 ? `${lbl}${r.yesDelta>0?'+':''}${r.yesDelta}` : '无变化';
                const n = r.noDelta !== 0 ? `${lbl}${r.noDelta>0?'+':''}${r.noDelta}` : '无变化';
                lines.push(`  R${i+1}：${r.question}（是→${y}，否→${n}）`);
            });
        }
        ctx.setExtensionPrompt(INJECT_KEY, lines.join('\n'), 1, 9000);
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
        c.innerHTML = attrs.map(a => {
            const val = getVarNum(a.key);
            const pct = a.max > a.min ? Math.max(0, Math.min(100, ((val - a.min) / (a.max - a.min)) * 100)) : 0;
            return `<div class="ds-card"><div class="ds-card-head"><span class="ds-card-label">${esc(a.label)}</span><span class="ds-card-val">${val}</span><span class="ds-card-max">/${a.max}</span></div><div class="ds-progress-track"><div class="ds-progress-fill" style="width:${pct}%"></div></div><div class="ds-card-controls"><button class="ds-btn-step" data-key="${esc(a.key)}" data-delta="${-a.step}">−${a.step}</button><input type="number" class="ds-val-input" data-key="${esc(a.key)}" value="${val}"/><button class="ds-btn-step" data-key="${esc(a.key)}" data-delta="${a.step}">+${a.step}</button></div></div>`;
        }).join('');
    }

    function renderAttrConfigList(): void {
        const c = el('ds-attr-config-list'); if (!c) return;
        const attrs = getSettings().attributes;
        c.innerHTML = attrs.length === 0 ? `<div class="ds-empty-sm">暂无属性</div>`
            : attrs.map((a, i) => `<div class="ds-list-item"><span class="ds-list-label">${esc(a.label)}</span><span class="ds-list-key">${esc(a.key)}</span><span class="ds-list-range">[${a.min}~${a.max}]</span><button class="ds-icon-btn ds-gen-rule" data-key="${esc(a.key)}" title="AI生成规则"><i class="fa-solid fa-wand-magic-sparkles"></i></button><button class="ds-icon-btn ds-edit-attr" data-idx="${i}" title="编辑"><i class="fa-solid fa-pen"></i></button><button class="ds-icon-btn ds-del ds-del-attr" data-key="${esc(a.key)}" title="删除"><i class="fa-solid fa-trash"></i></button></div>`).join('');
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
        editAttr = attr ? JSON.parse(JSON.stringify(attr)) : { key: '', label: '', min: 0, max: 100, defaultValue: 50, step: 5 };
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
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function hideAttrForm(): void { editAttr = null; const f = el('ds-attr-form'); if (f) f.style.display = 'none'; }

    function saveAttrForm(): void {
        if (!editAttr) return;
        if (editAttrIsNew) editAttr.key = (el('ds-attr-key') as HTMLInputElement).value.trim();
        editAttr.label = (el('ds-attr-label') as HTMLInputElement).value.trim();
        editAttr.min = Number((el('ds-attr-min') as HTMLInputElement).value);
        editAttr.max = Number((el('ds-attr-max') as HTMLInputElement).value);
        editAttr.defaultValue = Number((el('ds-attr-default') as HTMLInputElement).value);
        editAttr.step = Number((el('ds-attr-step') as HTMLInputElement).value) || 1;
        if (!editAttr.key || !editAttr.label) { if (typeof toastr !== 'undefined') toastr.warning('Key 和名称不能为空', '动态系统'); return; }
        const s = getSettings();
        if (editAttrIsNew) s.attributes.push(editAttr);
        else { const i = s.attributes.findIndex(a => a.key === editAttr!.key); if (i >= 0) s.attributes[i] = editAttr; }
        saveSettings(); updatePrompt(); hideAttrForm(); renderAttrConfigList(); renderAttrCards();
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
        if (!confirm(`应用模板「${tpl.name}」？将添加 ${tpl.attributes.length} 个属性（跳过同名已有属性）。`)) return;
        const s = getSettings();
        for (const a of tpl.attributes) {
            const key = a.label.replace(/[^\w\u4e00-\u9fa5]/g, '') || a.label.charCodeAt(0).toString();
            if (!s.attributes.find(x => x.key === key)) s.attributes.push({ key, ...a });
        }
        saveSettings(); updatePrompt(); renderAttrConfigList(); renderAttrCards();
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
        const tog = el<HTMLInputElement>('ds-inject-toggle');
        if (tog) tog.checked = getSettings().injectPrompt;
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
            if (text) { const changed = await parseAndApply(text); if (changed) { renderAttrCards(); renderLog(); } }
        };
        es.on(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler);

        genEndedHandler = () => { if (generatingRules) handleRuleGenComplete(); };
        es.on(et.GENERATION_ENDED, genEndedHandler);
    }

    function cleanup(): void {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
        const ctx = getCtx();
        const es = ctx?.eventSource; const et = ctx?.eventTypes ?? ctx?.event_types;
        if (es && et) {
            if (aiMsgHandler && et.CHARACTER_MESSAGE_RENDERED) es.removeListener(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler);
            if (genEndedHandler && et.GENERATION_ENDED) es.removeListener(et.GENERATION_ENDED, genEndedHandler);
        }
        ctx?.setExtensionPrompt?.(INJECT_KEY, '', 1, 9000);
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
