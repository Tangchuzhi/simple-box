/**
 * 动态系统 — 规则驱动的角色属性管理模块（纯原生 JS，无框架依赖）
 */
(function () {
    const INIT_FLAG = '__sb_ds_loaded__';
    if (window[INIT_FLAG])
        return;
    window[INIT_FLAG] = true;
    const EXT_KEY = 'simple-box-dynamic';
    const LOG_KEY = 'sb_ds_log';
    const INJECT_KEY = 'simple-box-dynamic';
    function getCtx() { var _a, _b; return (_b = (_a = window.SillyTavern) === null || _a === void 0 ? void 0 : _a.getContext) === null || _b === void 0 ? void 0 : _b.call(_a); }
    function getSettings() {
        const w = window;
        if (!w.extension_settings)
            w.extension_settings = {};
        if (!w.extension_settings[EXT_KEY])
            w.extension_settings[EXT_KEY] = { attributes: [], rules: [], injectPrompt: true };
        return w.extension_settings[EXT_KEY];
    }
    function saveSettings() { var _a, _b; (_b = (_a = window).saveSettingsDebounced) === null || _b === void 0 ? void 0 : _b.call(_a); }
    function getVarNum(key) {
        var _a, _b, _c, _d, _e;
        const raw = (_c = (_b = (_a = getCtx()) === null || _a === void 0 ? void 0 : _a.chatMetadata) === null || _b === void 0 ? void 0 : _b.variables) === null || _c === void 0 ? void 0 : _c[`ds_${key}`];
        return raw !== undefined ? Number(raw) : ((_e = (_d = getSettings().attributes.find(a => a.key === key)) === null || _d === void 0 ? void 0 : _d.defaultValue) !== null && _e !== void 0 ? _e : 0);
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
            ctx.chatMetadata[LOG_KEY] = ctx.chatMetadata[LOG_KEY].slice(0, 200);
    }
    async function execSlash(cmd) {
        const ctx = getCtx();
        if (ctx === null || ctx === void 0 ? void 0 : ctx.executeSlashCommandsWithOptions)
            await ctx.executeSlashCommandsWithOptions(cmd);
    }
    function clampVal(attr, val) { return Math.max(attr.min, Math.min(attr.max, Math.round(val))); }
    async function setVar(attr, val) {
        await execSlash(`/setvar key=ds_${attr.key} ${clampVal(attr, val)}`);
    }
    async function addVar(attr, delta, reason) {
        const current = getVarNum(attr.key);
        const next = clampVal(attr, current + delta);
        const actual = next - current;
        if (actual === 0)
            return;
        await execSlash(`/addvar key=ds_${attr.key} ${actual}`);
        appendLog({ time: Date.now(), key: attr.key, label: attr.label, delta: actual, reason });
    }
    function updatePrompt(s) {
        const ctx = getCtx();
        if (!(ctx === null || ctx === void 0 ? void 0 : ctx.setExtensionPrompt))
            return;
        if (!s.injectPrompt || s.attributes.length === 0) {
            ctx.setExtensionPrompt(INJECT_KEY, '', 1, 0);
            return;
        }
        const attrLines = s.attributes.map(a => {
            const val = getVarNum(a.key);
            const stage = [...a.stages].sort((x, y) => y.threshold - x.threshold).find(st => val >= st.threshold);
            return `- ${a.label}：${val}/${a.max}${stage ? `（${stage.label}：${stage.description}）` : ''}`;
        });
        const ruleLines = s.rules.filter(r => r.enabled && r.conditionPrompt.trim()).map(r => `- ${r.name}：${r.conditionPrompt}`);
        const lines = ['【动态系统 · 当前状态】', ...attrLines];
        if (ruleLines.length > 0)
            lines.push('', '【触发规则】（满足条件时在回复末尾附加变更标签）', ...ruleLines);
        lines.push('', '变量更新格式：[ds:addvar key=变量名 数值]');
        ctx.setExtensionPrompt(INJECT_KEY, lines.join('\n'), 1, 0);
    }
    async function parseReply(text, s) {
        const re = /\[ds:addvar\s+key=(\S+)\s+(-?\d+(?:\.\d+)?)\]/g;
        let m;
        let changed = false;
        while ((m = re.exec(text)) !== null) {
            const attr = s.attributes.find(a => a.key === m[1]);
            if (attr) {
                await addVar(attr, Number(m[2]), 'AI判断');
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
    let editAttr = null;
    let editAttrIsNew = false;
    let editRule = null;
    let editRuleIsNew = false;
    let pollTimer = 0;
    let aiMsgHandler = null;
    function el(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
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
            c.innerHTML = `<div class="ds-empty"><i class="fa-solid fa-circle-plus" style="font-size:24px"></i><span>还没有属性，请在「配置」中添加</span></div>`;
            return;
        }
        c.innerHTML = attrs.map(a => {
            const val = getVarNum(a.key);
            const pct = a.max > a.min ? Math.max(0, Math.min(100, ((val - a.min) / (a.max - a.min)) * 100)) : 0;
            const stage = [...a.stages].sort((x, y) => y.threshold - x.threshold).find(st => val >= st.threshold);
            const stageHtml = stage ? `<div class="ds-stage-desc">${esc(stage.label)}：${esc(stage.description)}</div>` : '';
            return `<div class="ds-card"><div class="ds-card-head"><i class="fa-solid ${esc(a.icon)} ds-card-icon"></i><span class="ds-card-label">${esc(a.label)}</span><span class="ds-card-val">${val}</span><span class="ds-card-max">/${a.max}</span></div><div class="ds-progress-track"><div class="ds-progress-fill" style="width:${pct}%"></div></div>${stageHtml}<div class="ds-card-controls"><button class="ds-btn-step" data-key="${esc(a.key)}" data-delta="${-a.step}">−${a.step}</button><input type="number" class="ds-val-input" data-key="${esc(a.key)}" value="${val}"/><button class="ds-btn-step" data-key="${esc(a.key)}" data-delta="${a.step}">+${a.step}</button></div></div>`;
        }).join('');
    }
    function renderAttrConfigList() {
        const c = el('ds-attr-config-list');
        if (!c)
            return;
        const attrs = getSettings().attributes;
        c.innerHTML = attrs.length === 0 ? `<div class="ds-empty-sm">暂无属性</div>`
            : attrs.map((a, i) => `<div class="ds-list-item"><i class="fa-solid ${esc(a.icon)} ds-list-icon"></i><span class="ds-list-label">${esc(a.label)}</span><span class="ds-list-key">${esc(a.key)}</span><span class="ds-list-range">[${a.min}~${a.max}]</span><button class="ds-icon-btn ds-edit-attr" data-idx="${i}"><i class="fa-solid fa-pen"></i></button><button class="ds-icon-btn ds-del ds-del-attr" data-key="${esc(a.key)}"><i class="fa-solid fa-trash"></i></button></div>`).join('');
    }
    function renderRuleConfigList() {
        const c = el('ds-rule-config-list');
        if (!c)
            return;
        const rules = getSettings().rules;
        c.innerHTML = rules.length === 0 ? `<div class="ds-empty-sm">暂无规则</div>`
            : rules.map((r, i) => `<div class="ds-list-item"><i class="fa-solid ${r.enabled ? 'fa-toggle-on ds-toggle-on' : 'fa-toggle-off ds-toggle-off'} ds-toggle-rule" data-id="${esc(r.id)}" style="cursor:pointer"></i><span class="ds-list-label">${esc(r.name)}</span><button class="ds-icon-btn ds-edit-rule" data-idx="${i}"><i class="fa-solid fa-pen"></i></button><button class="ds-icon-btn ds-del ds-del-rule" data-id="${esc(r.id)}"><i class="fa-solid fa-trash"></i></button></div>`).join('');
    }
    function showAttrForm(attr) {
        editAttr = attr ? JSON.parse(JSON.stringify(attr)) : { key: '', label: '', icon: 'fa-star', min: 0, max: 100, defaultValue: 50, step: 5, stages: [] };
        editAttrIsNew = !attr;
        const form = el('ds-attr-form');
        if (!form)
            return;
        form.style.display = '';
        el('ds-attr-form-title').textContent = editAttrIsNew ? '新建属性' : `编辑：${editAttr.label}`;
        el('ds-attr-key').value = editAttr.key;
        el('ds-attr-key').disabled = !editAttrIsNew;
        el('ds-attr-label').value = editAttr.label;
        el('ds-attr-icon').value = editAttr.icon;
        el('ds-attr-min').value = String(editAttr.min);
        el('ds-attr-max').value = String(editAttr.max);
        el('ds-attr-default').value = String(editAttr.defaultValue);
        el('ds-attr-step').value = String(editAttr.step);
        renderStageRows();
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function hideAttrForm() { editAttr = null; const f = el('ds-attr-form'); if (f)
        f.style.display = 'none'; }
    function renderStageRows() {
        const c = el('ds-stage-rows');
        if (!c || !editAttr)
            return;
        c.innerHTML = editAttr.stages.map((s, i) => `<div class="ds-stage-row"><input type="number" class="ds-inp ds-inp-sm" data-sf="threshold" data-idx="${i}" value="${s.threshold}" placeholder="阈值"/><input type="text" class="ds-inp ds-inp-sm" data-sf="label" data-idx="${i}" value="${esc(s.label)}" placeholder="阶段名"/><input type="text" class="ds-inp" data-sf="description" data-idx="${i}" value="${esc(s.description)}" placeholder="行为描述"/><button class="ds-icon-btn ds-del ds-del-stage" data-idx="${i}"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
    }
    function collectStageRows() {
        if (!editAttr)
            return;
        document.querySelectorAll('#ds-stage-rows [data-sf]').forEach(inp => {
            const idx = Number(inp.dataset.idx);
            const field = inp.dataset.sf;
            if (!editAttr.stages[idx])
                return;
            editAttr.stages[idx][field] = field === 'threshold' ? Number(inp.value) : inp.value;
        });
    }
    function saveAttrForm() {
        if (!editAttr)
            return;
        collectStageRows();
        editAttr.key = el('ds-attr-key').value.trim();
        editAttr.label = el('ds-attr-label').value.trim();
        editAttr.icon = el('ds-attr-icon').value.trim() || 'fa-star';
        editAttr.min = Number(el('ds-attr-min').value);
        editAttr.max = Number(el('ds-attr-max').value);
        editAttr.defaultValue = Number(el('ds-attr-default').value);
        editAttr.step = Number(el('ds-attr-step').value) || 1;
        if (!editAttr.key || !editAttr.label)
            return;
        const s = getSettings();
        if (editAttrIsNew) {
            s.attributes.push(editAttr);
        }
        else {
            const idx = s.attributes.findIndex(a => a.key === editAttr.key);
            if (idx >= 0)
                s.attributes[idx] = editAttr;
        }
        saveSettings();
        updatePrompt(s);
        hideAttrForm();
        renderAttrConfigList();
        renderAttrCards();
    }
    function showRuleForm(rule) {
        editRule = rule ? JSON.parse(JSON.stringify(rule)) : { id: Date.now().toString(), name: '', enabled: true, conditionPrompt: '', onMatch: [], onMiss: [], cooldown: 0, lastTriggered: 0 };
        editRuleIsNew = !rule;
        const form = el('ds-rule-form');
        if (!form)
            return;
        form.style.display = '';
        el('ds-rule-form-title').textContent = editRuleIsNew ? '新建规则' : `编辑：${editRule.name}`;
        el('ds-rule-name').value = editRule.name;
        el('ds-rule-prompt').value = editRule.conditionPrompt;
        renderOpRows('match');
        renderOpRows('miss');
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function hideRuleForm() { editRule = null; const f = el('ds-rule-form'); if (f)
        f.style.display = 'none'; }
    function renderOpRows(type) {
        if (!editRule)
            return;
        const c = el(`ds-${type}-rows`);
        if (!c)
            return;
        const ops = type === 'match' ? editRule.onMatch : editRule.onMiss;
        const attrs = getSettings().attributes;
        c.innerHTML = ops.map((op, i) => `<div class="ds-op-row"><select class="ds-inp" data-ot="${type}" data-idx="${i}">${attrs.map(a => `<option value="${esc(a.key)}" ${a.key === op.key ? 'selected' : ''}>${esc(a.label)}（${esc(a.key)}）</option>`).join('')}</select><input type="number" class="ds-inp ds-inp-sm" data-od="${type}" data-idx="${i}" value="${op.delta}" placeholder="±数值"/><button class="ds-icon-btn ds-del ds-del-op" data-ot="${type}" data-idx="${i}"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
    }
    function collectOpRows(type) {
        if (!editRule)
            return;
        const ops = type === 'match' ? editRule.onMatch : editRule.onMiss;
        document.querySelectorAll(`[data-ot="${type}"]`).forEach(sel => { const idx = Number(sel.dataset.idx); if (ops[idx])
            ops[idx].key = sel.value; });
        document.querySelectorAll(`[data-od="${type}"]`).forEach(inp => { const idx = Number(inp.dataset.idx); if (ops[idx])
            ops[idx].delta = Number(inp.value); });
    }
    function saveRuleForm() {
        if (!editRule)
            return;
        collectOpRows('match');
        collectOpRows('miss');
        editRule.name = el('ds-rule-name').value.trim();
        editRule.conditionPrompt = el('ds-rule-prompt').value;
        if (!editRule.name)
            return;
        const s = getSettings();
        if (editRuleIsNew) {
            s.rules.push(editRule);
        }
        else {
            const idx = s.rules.findIndex(r => r.id === editRule.id);
            if (idx >= 0)
                s.rules[idx] = editRule;
        }
        saveSettings();
        updatePrompt(s);
        hideRuleForm();
        renderRuleConfigList();
    }
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
        const tog = el('ds-inject-toggle');
        if (tog)
            tog.checked = getSettings().injectPrompt;
    }
    function setupEvents() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w;
        (_a = el('ds-tab-status')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => switchTab('status'));
        (_b = el('ds-tab-config')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', () => switchTab('config'));
        (_c = el('ds-tab-history')) === null || _c === void 0 ? void 0 : _c.addEventListener('click', () => switchTab('history'));
        (_d = el('ds-refresh-btn')) === null || _d === void 0 ? void 0 : _d.addEventListener('click', renderAll);
        (_e = el('ds-inject-toggle')) === null || _e === void 0 ? void 0 : _e.addEventListener('change', () => {
            const s = getSettings();
            s.injectPrompt = (el('ds-inject-toggle')).checked;
            saveSettings();
            updatePrompt(s);
        });
        (_f = el('ds-new-attr-btn')) === null || _f === void 0 ? void 0 : _f.addEventListener('click', () => editAttr ? hideAttrForm() : showAttrForm());
        (_g = el('ds-attr-config-list')) === null || _g === void 0 ? void 0 : _g.addEventListener('click', e => {
            const t = e.target;
            const eb = t.closest('.ds-edit-attr');
            const db = t.closest('.ds-del-attr');
            if (eb)
                showAttrForm(getSettings().attributes[Number(eb.dataset.idx)]);
            else if (db) {
                const key = db.dataset.key;
                if (!confirm(`删除属性 "${key}"？`))
                    return;
                const s = getSettings();
                s.attributes = s.attributes.filter(a => a.key !== key);
                saveSettings();
                updatePrompt(s);
                renderAttrConfigList();
                renderAttrCards();
            }
        });
        (_h = el('ds-add-stage-btn')) === null || _h === void 0 ? void 0 : _h.addEventListener('click', () => { if (!editAttr)
            return; collectStageRows(); editAttr.stages.push({ threshold: 0, label: '', description: '' }); renderStageRows(); });
        (_j = el('ds-stage-rows')) === null || _j === void 0 ? void 0 : _j.addEventListener('click', e => {
            const db = e.target.closest('.ds-del-stage');
            if (db && editAttr) {
                collectStageRows();
                editAttr.stages.splice(Number(db.dataset.idx), 1);
                renderStageRows();
            }
        });
        (_k = el('ds-save-attr-btn')) === null || _k === void 0 ? void 0 : _k.addEventListener('click', saveAttrForm);
        (_l = el('ds-cancel-attr-btn')) === null || _l === void 0 ? void 0 : _l.addEventListener('click', hideAttrForm);
        (_m = el('ds-new-rule-btn')) === null || _m === void 0 ? void 0 : _m.addEventListener('click', () => editRule ? hideRuleForm() : showRuleForm());
        (_o = el('ds-rule-config-list')) === null || _o === void 0 ? void 0 : _o.addEventListener('click', e => {
            const t = e.target;
            const tog = t.closest('.ds-toggle-rule');
            const eb = t.closest('.ds-edit-rule');
            const db = t.closest('.ds-del-rule');
            if (tog) {
                const s = getSettings();
                const r = s.rules.find(r => r.id === tog.dataset.id);
                if (r) {
                    r.enabled = !r.enabled;
                    saveSettings();
                    updatePrompt(s);
                    renderRuleConfigList();
                }
            }
            else if (eb)
                showRuleForm(getSettings().rules[Number(eb.dataset.idx)]);
            else if (db) {
                if (!confirm('删除此规则？'))
                    return;
                const s = getSettings();
                s.rules = s.rules.filter(r => r.id !== db.dataset.id);
                saveSettings();
                updatePrompt(s);
                renderRuleConfigList();
            }
        });
        (_p = el('ds-add-match-btn')) === null || _p === void 0 ? void 0 : _p.addEventListener('click', () => { var _a, _b; if (!editRule)
            return; collectOpRows('match'); editRule.onMatch.push({ key: (_b = (_a = getSettings().attributes[0]) === null || _a === void 0 ? void 0 : _a.key) !== null && _b !== void 0 ? _b : '', delta: 0 }); renderOpRows('match'); });
        (_q = el('ds-add-miss-btn')) === null || _q === void 0 ? void 0 : _q.addEventListener('click', () => { var _a, _b; if (!editRule)
            return; collectOpRows('miss'); editRule.onMiss.push({ key: (_b = (_a = getSettings().attributes[0]) === null || _a === void 0 ? void 0 : _a.key) !== null && _b !== void 0 ? _b : '', delta: 0 }); renderOpRows('miss'); });
        (_r = el('ds-match-rows')) === null || _r === void 0 ? void 0 : _r.addEventListener('click', e => { const db = e.target.closest('.ds-del-op'); if (db && editRule) {
            collectOpRows('match');
            editRule.onMatch.splice(Number(db.dataset.idx), 1);
            renderOpRows('match');
        } });
        (_s = el('ds-miss-rows')) === null || _s === void 0 ? void 0 : _s.addEventListener('click', e => { const db = e.target.closest('.ds-del-op'); if (db && editRule) {
            collectOpRows('miss');
            editRule.onMiss.splice(Number(db.dataset.idx), 1);
            renderOpRows('miss');
        } });
        (_t = el('ds-save-rule-btn')) === null || _t === void 0 ? void 0 : _t.addEventListener('click', saveRuleForm);
        (_u = el('ds-cancel-rule-btn')) === null || _u === void 0 ? void 0 : _u.addEventListener('click', hideRuleForm);
        (_v = el('ds-attr-cards')) === null || _v === void 0 ? void 0 : _v.addEventListener('click', async (e) => {
            const btn = e.target.closest('.ds-btn-step');
            if (!btn)
                return;
            const attr = getSettings().attributes.find(a => a.key === btn.dataset.key);
            if (attr) {
                await addVar(attr, Number(btn.dataset.delta), '手动调整');
                renderAttrCards();
                renderLog();
            }
        });
        (_w = el('ds-attr-cards')) === null || _w === void 0 ? void 0 : _w.addEventListener('change', async (e) => {
            const inp = e.target;
            if (!inp.classList.contains('ds-val-input'))
                return;
            const attr = getSettings().attributes.find(a => a.key === inp.dataset.key);
            if (attr) {
                await setVar(attr, Number(inp.value));
                renderAttrCards();
            }
        });
    }
    function cleanup() {
        var _a, _b;
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = 0;
        }
        const es = window.eventSource;
        const et = window.event_types;
        if (es && (et === null || et === void 0 ? void 0 : et.CHARACTER_MESSAGE_RENDERED) && aiMsgHandler) {
            es.removeListener(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler);
            aiMsgHandler = null;
        }
        (_b = (_a = getCtx()) === null || _a === void 0 ? void 0 : _a.setExtensionPrompt) === null || _b === void 0 ? void 0 : _b.call(_a, INJECT_KEY, '', 1, 0);
        window[INIT_FLAG] = false;
    }
    renderAll();
    setupEvents();
    updatePrompt(getSettings());
    pollTimer = window.setInterval(() => { renderAttrCards(); renderLog(); }, 3000);
    const es = window.eventSource;
    const et = window.event_types;
    if (es && (et === null || et === void 0 ? void 0 : et.CHARACTER_MESSAGE_RENDERED)) {
        aiMsgHandler = async (_data) => {
            const text = getLastAIMessage();
            if (text) {
                const changed = await parseReply(text, getSettings());
                if (changed) {
                    renderAttrCards();
                    renderLog();
                }
            }
        };
        es.on(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler);
    }
    window.addEventListener('beforeunload', cleanup);
})();
