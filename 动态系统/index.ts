/**
 * 动态系统 — 规则驱动的角色属性管理模块（纯原生 JS，无框架依赖）
 */
(function () {
    const INIT_FLAG = '__sb_ds_loaded__';
    if ((window as any)[INIT_FLAG]) return;
    (window as any)[INIT_FLAG] = true;

    const EXT_KEY = 'simple-box-dynamic';
    const LOG_KEY = 'sb_ds_log';
    const INJECT_KEY = 'simple-box-dynamic';

    interface StageDef { threshold: number; label: string; description: string; }
    interface AttributeDef { key: string; label: string; icon: string; min: number; max: number; defaultValue: number; step: number; stages: StageDef[]; }
    interface VarOp { key: string; delta: number; }
    interface RuleDef { id: string; name: string; enabled: boolean; conditionPrompt: string; onMatch: VarOp[]; onMiss: VarOp[]; cooldown: number; lastTriggered: number; }
    interface LogEntry { time: number; key: string; label: string; delta: number; reason: string; }
    interface DSSettings { attributes: AttributeDef[]; rules: RuleDef[]; injectPrompt: boolean; }

    function getCtx(): any { return (window as any).SillyTavern?.getContext?.(); }

    function getSettings(): DSSettings {
        const w = window as any;
        if (!w.extension_settings) w.extension_settings = {};
        if (!w.extension_settings[EXT_KEY]) w.extension_settings[EXT_KEY] = { attributes: [], rules: [], injectPrompt: true };
        return w.extension_settings[EXT_KEY] as DSSettings;
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
        if (ctx.chatMetadata[LOG_KEY].length > 200) ctx.chatMetadata[LOG_KEY] = ctx.chatMetadata[LOG_KEY].slice(0, 200);
    }

    async function execSlash(cmd: string): Promise<void> {
        const ctx = getCtx();
        if (ctx?.executeSlashCommandsWithOptions) await ctx.executeSlashCommandsWithOptions(cmd);
    }

    function clampVal(attr: AttributeDef, val: number): number { return Math.max(attr.min, Math.min(attr.max, Math.round(val))); }

    async function setVar(attr: AttributeDef, val: number): Promise<void> {
        await execSlash(`/setvar key=ds_${attr.key} ${clampVal(attr, val)}`);
    }

    async function addVar(attr: AttributeDef, delta: number, reason: string): Promise<void> {
        const current = getVarNum(attr.key);
        const next = clampVal(attr, current + delta);
        const actual = next - current;
        if (actual === 0) return;
        await execSlash(`/addvar key=ds_${attr.key} ${actual}`);
        appendLog({ time: Date.now(), key: attr.key, label: attr.label, delta: actual, reason });
    }

    function updatePrompt(s: DSSettings): void {
        const ctx = getCtx();
        if (!ctx?.setExtensionPrompt) return;
        if (!s.injectPrompt || s.attributes.length === 0) { ctx.setExtensionPrompt(INJECT_KEY, '', 1, 0); return; }
        const attrLines = s.attributes.map(a => {
            const val = getVarNum(a.key);
            const stage = [...a.stages].sort((x, y) => y.threshold - x.threshold).find(st => val >= st.threshold);
            return `- ${a.label}：${val}/${a.max}${stage ? `（${stage.label}：${stage.description}）` : ''}`;
        });
        const ruleLines = s.rules.filter(r => r.enabled && r.conditionPrompt.trim()).map(r => `- ${r.name}：${r.conditionPrompt}`);
        const lines = ['【动态系统 · 当前状态】', ...attrLines];
        if (ruleLines.length > 0) lines.push('', '【触发规则】（满足条件时在回复末尾附加变更标签）', ...ruleLines);
        lines.push('', '变量更新格式：[ds:addvar key=变量名 数值]');
        ctx.setExtensionPrompt(INJECT_KEY, lines.join('\n'), 1, 0);
    }

    async function parseReply(text: string, s: DSSettings): Promise<boolean> {
        const re = /\[ds:addvar\s+key=(\S+)\s+(-?\d+(?:\.\d+)?)\]/g;
        let m: RegExpExecArray | null; let changed = false;
        while ((m = re.exec(text)) !== null) {
            const attr = s.attributes.find(a => a.key === m![1]);
            if (attr) { await addVar(attr, Number(m[2]), 'AI判断'); changed = true; }
        }
        return changed;
    }

    function getLastAIMessage(): string {
        const chat: any[] = getCtx()?.chat ?? [];
        for (let i = chat.length - 1; i >= 0; i--) { const m = chat[i]; if (!m.is_user && !m.is_system) return m.mes ?? ''; }
        return '';
    }

    let editAttr: AttributeDef | null = null;
    let editAttrIsNew = false;
    let editRule: RuleDef | null = null;
    let editRuleIsNew = false;
    let pollTimer = 0;
    let aiMsgHandler: ((data: any) => void) | null = null;

    function el<T extends HTMLElement>(id: string): T | null { return document.getElementById(id) as T | null; }

    function esc(s: string): string {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

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
        if (attrs.length === 0) { c.innerHTML = `<div class="ds-empty"><i class="fa-solid fa-circle-plus" style="font-size:24px"></i><span>还没有属性，请在「配置」中添加</span></div>`; return; }
        c.innerHTML = attrs.map(a => {
            const val = getVarNum(a.key);
            const pct = a.max > a.min ? Math.max(0, Math.min(100, ((val - a.min) / (a.max - a.min)) * 100)) : 0;
            const stage = [...a.stages].sort((x, y) => y.threshold - x.threshold).find(st => val >= st.threshold);
            const stageHtml = stage ? `<div class="ds-stage-desc">${esc(stage.label)}：${esc(stage.description)}</div>` : '';
            return `<div class="ds-card"><div class="ds-card-head"><i class="fa-solid ${esc(a.icon)} ds-card-icon"></i><span class="ds-card-label">${esc(a.label)}</span><span class="ds-card-val">${val}</span><span class="ds-card-max">/${a.max}</span></div><div class="ds-progress-track"><div class="ds-progress-fill" style="width:${pct}%"></div></div>${stageHtml}<div class="ds-card-controls"><button class="ds-btn-step" data-key="${esc(a.key)}" data-delta="${-a.step}">−${a.step}</button><input type="number" class="ds-val-input" data-key="${esc(a.key)}" value="${val}"/><button class="ds-btn-step" data-key="${esc(a.key)}" data-delta="${a.step}">+${a.step}</button></div></div>`;
        }).join('');
    }

    function renderAttrConfigList(): void {
        const c = el('ds-attr-config-list'); if (!c) return;
        const attrs = getSettings().attributes;
        c.innerHTML = attrs.length === 0 ? `<div class="ds-empty-sm">暂无属性</div>`
            : attrs.map((a, i) => `<div class="ds-list-item"><i class="fa-solid ${esc(a.icon)} ds-list-icon"></i><span class="ds-list-label">${esc(a.label)}</span><span class="ds-list-key">${esc(a.key)}</span><span class="ds-list-range">[${a.min}~${a.max}]</span><button class="ds-icon-btn ds-edit-attr" data-idx="${i}"><i class="fa-solid fa-pen"></i></button><button class="ds-icon-btn ds-del ds-del-attr" data-key="${esc(a.key)}"><i class="fa-solid fa-trash"></i></button></div>`).join('');
    }

    function renderRuleConfigList(): void {
        const c = el('ds-rule-config-list'); if (!c) return;
        const rules = getSettings().rules;
        c.innerHTML = rules.length === 0 ? `<div class="ds-empty-sm">暂无规则</div>`
            : rules.map((r, i) => `<div class="ds-list-item"><i class="fa-solid ${r.enabled ? 'fa-toggle-on ds-toggle-on' : 'fa-toggle-off ds-toggle-off'} ds-toggle-rule" data-id="${esc(r.id)}" style="cursor:pointer"></i><span class="ds-list-label">${esc(r.name)}</span><button class="ds-icon-btn ds-edit-rule" data-idx="${i}"><i class="fa-solid fa-pen"></i></button><button class="ds-icon-btn ds-del ds-del-rule" data-id="${esc(r.id)}"><i class="fa-solid fa-trash"></i></button></div>`).join('');
    }

    function showAttrForm(attr?: AttributeDef): void {
        editAttr = attr ? JSON.parse(JSON.stringify(attr)) : { key: '', label: '', icon: 'fa-star', min: 0, max: 100, defaultValue: 50, step: 5, stages: [] };
        editAttrIsNew = !attr;
        const form = el('ds-attr-form'); if (!form) return;
        form.style.display = '';
        (el('ds-attr-form-title') as HTMLElement).textContent = editAttrIsNew ? '新建属性' : `编辑：${editAttr!.label}`;
        (el('ds-attr-key') as HTMLInputElement).value = editAttr!.key;
        (el('ds-attr-key') as HTMLInputElement).disabled = !editAttrIsNew;
        (el('ds-attr-label') as HTMLInputElement).value = editAttr!.label;
        (el('ds-attr-icon') as HTMLInputElement).value = editAttr!.icon;
        (el('ds-attr-min') as HTMLInputElement).value = String(editAttr!.min);
        (el('ds-attr-max') as HTMLInputElement).value = String(editAttr!.max);
        (el('ds-attr-default') as HTMLInputElement).value = String(editAttr!.defaultValue);
        (el('ds-attr-step') as HTMLInputElement).value = String(editAttr!.step);
        renderStageRows();
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function hideAttrForm(): void { editAttr = null; const f = el('ds-attr-form'); if (f) f.style.display = 'none'; }

    function renderStageRows(): void {
        const c = el('ds-stage-rows'); if (!c || !editAttr) return;
        c.innerHTML = editAttr.stages.map((s, i) => `<div class="ds-stage-row"><input type="number" class="ds-inp ds-inp-sm" data-sf="threshold" data-idx="${i}" value="${s.threshold}" placeholder="阈值"/><input type="text" class="ds-inp ds-inp-sm" data-sf="label" data-idx="${i}" value="${esc(s.label)}" placeholder="阶段名"/><input type="text" class="ds-inp" data-sf="description" data-idx="${i}" value="${esc(s.description)}" placeholder="行为描述"/><button class="ds-icon-btn ds-del ds-del-stage" data-idx="${i}"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
    }

    function collectStageRows(): void {
        if (!editAttr) return;
        document.querySelectorAll<HTMLInputElement>('#ds-stage-rows [data-sf]').forEach(inp => {
            const idx = Number(inp.dataset.idx); const field = inp.dataset.sf as keyof StageDef;
            if (!editAttr!.stages[idx]) return;
            (editAttr!.stages[idx] as any)[field] = field === 'threshold' ? Number(inp.value) : inp.value;
        });
    }

    function saveAttrForm(): void {
        if (!editAttr) return;
        collectStageRows();
        editAttr.key = (el('ds-attr-key') as HTMLInputElement).value.trim();
        editAttr.label = (el('ds-attr-label') as HTMLInputElement).value.trim();
        editAttr.icon = (el('ds-attr-icon') as HTMLInputElement).value.trim() || 'fa-star';
        editAttr.min = Number((el('ds-attr-min') as HTMLInputElement).value);
        editAttr.max = Number((el('ds-attr-max') as HTMLInputElement).value);
        editAttr.defaultValue = Number((el('ds-attr-default') as HTMLInputElement).value);
        editAttr.step = Number((el('ds-attr-step') as HTMLInputElement).value) || 1;
        if (!editAttr.key || !editAttr.label) return;
        const s = getSettings();
        if (editAttrIsNew) { s.attributes.push(editAttr); }
        else { const idx = s.attributes.findIndex(a => a.key === editAttr!.key); if (idx >= 0) s.attributes[idx] = editAttr; }
        saveSettings(); updatePrompt(s); hideAttrForm(); renderAttrConfigList(); renderAttrCards();
    }

    function showRuleForm(rule?: RuleDef): void {
        editRule = rule ? JSON.parse(JSON.stringify(rule)) : { id: Date.now().toString(), name: '', enabled: true, conditionPrompt: '', onMatch: [], onMiss: [], cooldown: 0, lastTriggered: 0 };
        editRuleIsNew = !rule;
        const form = el('ds-rule-form'); if (!form) return;
        form.style.display = '';
        (el('ds-rule-form-title') as HTMLElement).textContent = editRuleIsNew ? '新建规则' : `编辑：${editRule!.name}`;
        (el('ds-rule-name') as HTMLInputElement).value = editRule!.name;
        (el('ds-rule-prompt') as HTMLTextAreaElement).value = editRule!.conditionPrompt;
        renderOpRows('match'); renderOpRows('miss');
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function hideRuleForm(): void { editRule = null; const f = el('ds-rule-form'); if (f) f.style.display = 'none'; }

    function renderOpRows(type: 'match' | 'miss'): void {
        if (!editRule) return;
        const c = el(`ds-${type}-rows`); if (!c) return;
        const ops = type === 'match' ? editRule.onMatch : editRule.onMiss;
        const attrs = getSettings().attributes;
        c.innerHTML = ops.map((op, i) => `<div class="ds-op-row"><select class="ds-inp" data-ot="${type}" data-idx="${i}">${attrs.map(a => `<option value="${esc(a.key)}" ${a.key === op.key ? 'selected' : ''}>${esc(a.label)}（${esc(a.key)}）</option>`).join('')}</select><input type="number" class="ds-inp ds-inp-sm" data-od="${type}" data-idx="${i}" value="${op.delta}" placeholder="±数值"/><button class="ds-icon-btn ds-del ds-del-op" data-ot="${type}" data-idx="${i}"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
    }

    function collectOpRows(type: 'match' | 'miss'): void {
        if (!editRule) return;
        const ops = type === 'match' ? editRule.onMatch : editRule.onMiss;
        document.querySelectorAll<HTMLSelectElement>(`[data-ot="${type}"]`).forEach(sel => { const idx = Number(sel.dataset.idx); if (ops[idx]) ops[idx].key = sel.value; });
        document.querySelectorAll<HTMLInputElement>(`[data-od="${type}"]`).forEach(inp => { const idx = Number(inp.dataset.idx); if (ops[idx]) ops[idx].delta = Number(inp.value); });
    }

    function saveRuleForm(): void {
        if (!editRule) return;
        collectOpRows('match'); collectOpRows('miss');
        editRule.name = (el('ds-rule-name') as HTMLInputElement).value.trim();
        editRule.conditionPrompt = (el('ds-rule-prompt') as HTMLTextAreaElement).value;
        if (!editRule.name) return;
        const s = getSettings();
        if (editRuleIsNew) { s.rules.push(editRule); }
        else { const idx = s.rules.findIndex(r => r.id === editRule!.id); if (idx >= 0) s.rules[idx] = editRule; }
        saveSettings(); updatePrompt(s); hideRuleForm(); renderRuleConfigList();
    }

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

    function setupEvents(): void {
        el('ds-tab-status')?.addEventListener('click', () => switchTab('status'));
        el('ds-tab-config')?.addEventListener('click', () => switchTab('config'));
        el('ds-tab-history')?.addEventListener('click', () => switchTab('history'));
        el('ds-refresh-btn')?.addEventListener('click', renderAll);

        el('ds-inject-toggle')?.addEventListener('change', () => {
            const s = getSettings(); s.injectPrompt = (el<HTMLInputElement>('ds-inject-toggle'))!.checked;
            saveSettings(); updatePrompt(s);
        });

        el('ds-new-attr-btn')?.addEventListener('click', () => editAttr ? hideAttrForm() : showAttrForm());
        el('ds-attr-config-list')?.addEventListener('click', e => {
            const t = e.target as HTMLElement;
            const eb = t.closest('.ds-edit-attr') as HTMLElement | null;
            const db = t.closest('.ds-del-attr') as HTMLElement | null;
            if (eb) showAttrForm(getSettings().attributes[Number(eb.dataset.idx)]);
            else if (db) {
                const key = db.dataset.key!;
                if (!confirm(`删除属性 "${key}"？`)) return;
                const s = getSettings(); s.attributes = s.attributes.filter(a => a.key !== key);
                saveSettings(); updatePrompt(s); renderAttrConfigList(); renderAttrCards();
            }
        });
        el('ds-add-stage-btn')?.addEventListener('click', () => { if (!editAttr) return; collectStageRows(); editAttr.stages.push({ threshold: 0, label: '', description: '' }); renderStageRows(); });
        el('ds-stage-rows')?.addEventListener('click', e => {
            const db = (e.target as HTMLElement).closest('.ds-del-stage') as HTMLElement | null;
            if (db && editAttr) { collectStageRows(); editAttr.stages.splice(Number(db.dataset.idx), 1); renderStageRows(); }
        });
        el('ds-save-attr-btn')?.addEventListener('click', saveAttrForm);
        el('ds-cancel-attr-btn')?.addEventListener('click', hideAttrForm);

        el('ds-new-rule-btn')?.addEventListener('click', () => editRule ? hideRuleForm() : showRuleForm());
        el('ds-rule-config-list')?.addEventListener('click', e => {
            const t = e.target as HTMLElement;
            const tog = t.closest('.ds-toggle-rule') as HTMLElement | null;
            const eb = t.closest('.ds-edit-rule') as HTMLElement | null;
            const db = t.closest('.ds-del-rule') as HTMLElement | null;
            if (tog) {
                const s = getSettings(); const r = s.rules.find(r => r.id === tog.dataset.id!);
                if (r) { r.enabled = !r.enabled; saveSettings(); updatePrompt(s); renderRuleConfigList(); }
            } else if (eb) showRuleForm(getSettings().rules[Number(eb.dataset.idx)]);
            else if (db) {
                if (!confirm('删除此规则？')) return;
                const s = getSettings(); s.rules = s.rules.filter(r => r.id !== db.dataset.id!);
                saveSettings(); updatePrompt(s); renderRuleConfigList();
            }
        });
        el('ds-add-match-btn')?.addEventListener('click', () => { if (!editRule) return; collectOpRows('match'); editRule.onMatch.push({ key: getSettings().attributes[0]?.key ?? '', delta: 0 }); renderOpRows('match'); });
        el('ds-add-miss-btn')?.addEventListener('click', () => { if (!editRule) return; collectOpRows('miss'); editRule.onMiss.push({ key: getSettings().attributes[0]?.key ?? '', delta: 0 }); renderOpRows('miss'); });
        el('ds-match-rows')?.addEventListener('click', e => { const db = (e.target as HTMLElement).closest('.ds-del-op') as HTMLElement | null; if (db && editRule) { collectOpRows('match'); editRule.onMatch.splice(Number(db.dataset.idx), 1); renderOpRows('match'); } });
        el('ds-miss-rows')?.addEventListener('click', e => { const db = (e.target as HTMLElement).closest('.ds-del-op') as HTMLElement | null; if (db && editRule) { collectOpRows('miss'); editRule.onMiss.splice(Number(db.dataset.idx), 1); renderOpRows('miss'); } });
        el('ds-save-rule-btn')?.addEventListener('click', saveRuleForm);
        el('ds-cancel-rule-btn')?.addEventListener('click', hideRuleForm);

        el('ds-attr-cards')?.addEventListener('click', async e => {
            const btn = (e.target as HTMLElement).closest('.ds-btn-step') as HTMLElement | null;
            if (!btn) return;
            const attr = getSettings().attributes.find(a => a.key === btn.dataset.key!);
            if (attr) { await addVar(attr, Number(btn.dataset.delta), '手动调整'); renderAttrCards(); renderLog(); }
        });
        el('ds-attr-cards')?.addEventListener('change', async e => {
            const inp = e.target as HTMLInputElement;
            if (!inp.classList.contains('ds-val-input')) return;
            const attr = getSettings().attributes.find(a => a.key === inp.dataset.key!);
            if (attr) { await setVar(attr, Number(inp.value)); renderAttrCards(); }
        });
    }

    function cleanup(): void {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
        const es = (window as any).eventSource; const et = (window as any).event_types;
        if (es && et?.CHARACTER_MESSAGE_RENDERED && aiMsgHandler) { es.removeListener(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler); aiMsgHandler = null; }
        getCtx()?.setExtensionPrompt?.(INJECT_KEY, '', 1, 0);
        (window as any)[INIT_FLAG] = false;
    }

    renderAll();
    setupEvents();
    updatePrompt(getSettings());

    pollTimer = window.setInterval(() => { renderAttrCards(); renderLog(); }, 3000);

    const es = (window as any).eventSource; const et = (window as any).event_types;
    if (es && et?.CHARACTER_MESSAGE_RENDERED) {
        aiMsgHandler = async (_data: any) => {
            const text = getLastAIMessage();
            if (text) { const changed = await parseReply(text, getSettings()); if (changed) { renderAttrCards(); renderLog(); } }
        };
        es.on(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler);
    }

    window.addEventListener('beforeunload', cleanup);

})();
