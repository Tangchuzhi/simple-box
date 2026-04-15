/**
 * 动态系统 — 规则驱动的角色属性管理模块
 *
 * 存储策略：
 *   配置（属性定义 + 规则）→ extension_settings['simple-box-dynamic']  保存到 ST 设置文件
 *   运行数值              → chatMetadata.variables (via /setvar /addvar)  随聊天文件保存
 *   变更历史              → chatMetadata['sb_ds_log']                     随聊天文件保存
 */

(function () {
    // ── 初始化守卫 ────────────────────────────────────────────────────────────
    const INIT_FLAG = '__sb_ds_loaded__';
    if ((window as any)[INIT_FLAG]) return;
    (window as any)[INIT_FLAG] = true;

    // ── 类型定义 ──────────────────────────────────────────────────────────────

    interface Stage {
        threshold: number;
        label: string;
        description: string;
    }

    interface AttributeDef {
        key: string;
        label: string;
        icon: string;
        min: number;
        max: number;
        defaultValue: number;
        step: number;
        stages: Stage[];
    }

    interface VarOp {
        key: string;
        delta: number;
    }

    interface RuleDef {
        id: string;
        name: string;
        enabled: boolean;
        conditionPrompt: string;
        onMatch: VarOp[];
        onMiss: VarOp[];
        cooldown: number;
        lastTriggered: number;
    }

    interface LogEntry {
        time: number;
        label: string;
        key: string;
        delta: number;
        reason: string;
    }

    interface DSSettings {
        attributes: AttributeDef[];
        rules: RuleDef[];
        injectPrompt: boolean;
    }

    // ── 常量 ──────────────────────────────────────────────────────────────────

    const EXT_KEY = 'simple-box-dynamic';
    const VAR_PREFIX = 'ds_';
    const LOG_KEY = 'sb_ds_log';
    const INJECT_KEY = 'simple-box-dynamic';

    // ── ST API 层 ─────────────────────────────────────────────────────────────

    function getCtx(): any {
        return (window as any).SillyTavern?.getContext?.();
    }

    function getSettings(): DSSettings {
        const w = window as any;
        if (!w.extension_settings) w.extension_settings = {};
        if (!w.extension_settings[EXT_KEY]) {
            w.extension_settings[EXT_KEY] = { attributes: [], rules: [], injectPrompt: true };
        }
        return w.extension_settings[EXT_KEY] as DSSettings;
    }

    function saveSettings(): void {
        const save = (window as any).saveSettingsDebounced ?? getCtx()?.saveSettingsDebounced;
        if (typeof save === 'function') save();
    }

    function getChatVars(): Record<string, any> {
        return getCtx()?.chatMetadata?.variables ?? {};
    }

    function getVarNum(key: string): number {
        return Number(getChatVars()[VAR_PREFIX + key] ?? 0);
    }

    function getChatLog(): LogEntry[] {
        const ctx = getCtx();
        return (ctx?.chatMetadata?.[LOG_KEY] as LogEntry[]) ?? [];
    }

    function appendLog(entry: LogEntry): void {
        const ctx = getCtx();
        if (!ctx?.chatMetadata) return;
        const log: LogEntry[] = ctx.chatMetadata[LOG_KEY] ?? [];
        log.unshift(entry);
        if (log.length > 300) log.splice(300);
        ctx.chatMetadata[LOG_KEY] = log;
    }

    async function execSlash(cmd: string): Promise<void> {
        const ctx = getCtx();
        if (ctx?.executeSlashCommandsWithOptions) {
            await ctx.executeSlashCommandsWithOptions(cmd);
        }
    }

    function clampVal(attr: AttributeDef, val: number): number {
        return Math.max(attr.min, Math.min(attr.max, Math.round(val)));
    }

    async function setVar(attr: AttributeDef, value: number): Promise<void> {
        const clamped = clampVal(attr, value);
        await execSlash(`/setvar key=${VAR_PREFIX + attr.key} ${clamped}`);
    }

    async function addVar(attr: AttributeDef, delta: number, reason: string = ''): Promise<void> {
        const current = getVarNum(attr.key);
        const next = clampVal(attr, current + delta);
        const actual = next - current;
        if (actual === 0) return;
        await execSlash(`/addvar key=${VAR_PREFIX + attr.key} ${actual}`);
        appendLog({ time: Date.now(), label: attr.label, key: attr.key, delta: actual, reason });
    }

    function updatePrompt(settings: DSSettings): void {
        const ctx = getCtx();
        if (!ctx?.setExtensionPrompt) return;

        if (!settings.injectPrompt || settings.attributes.length === 0) {
            ctx.setExtensionPrompt(INJECT_KEY, '', 1, 0);
            return;
        }

        const attrLines = settings.attributes.map(a => {
            const val = getVarNum(a.key);
            const sorted = [...a.stages].sort((x, y) => y.threshold - x.threshold);
            const stage = sorted.find(s => val >= s.threshold);
            const stagePart = stage ? `（${stage.label}：${stage.description}）` : '';
            return `- ${a.label}：${val}/${a.max}${stagePart}`;
        });

        const ruleLines = settings.rules
            .filter(r => r.enabled && r.conditionPrompt.trim())
            .map(r => `- ${r.name}：${r.conditionPrompt}`);

        const lines: string[] = [
            '【动态系统 · 当前状态】',
            ...attrLines,
        ];
        if (ruleLines.length > 0) {
            lines.push('', '【触发规则】（满足条件时在回复末尾附加变更标签）');
            lines.push(...ruleLines);
        }
        lines.push('', '变量更新格式（每条独占一行，置于回复末尾）：', '[ds:addvar key=变量名 数值]');

        ctx.setExtensionPrompt(INJECT_KEY, lines.join('\n'), 1, 0);
    }

    async function parseReply(text: string, settings: DSSettings): Promise<boolean> {
        const re = /\[ds:addvar\s+key=(\S+)\s+(-?\d+(?:\.\d+)?)\]/g;
        let m: RegExpExecArray | null;
        let changed = false;
        while ((m = re.exec(text)) !== null) {
            const attr = settings.attributes.find(a => a.key === m![1]);
            if (attr) {
                await addVar(attr, Number(m[2]), 'AI判断');
                changed = true;
            }
        }
        return changed;
    }

    function getLastAIMessage(): string {
        const ctx = getCtx();
        const chat: any[] = ctx?.chat ?? [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const msg = chat[i];
            if (!msg.is_user && !msg.is_system) return msg.mes ?? '';
        }
        return '';
    }

    // ── CSS 注入 ──────────────────────────────────────────────────────────────

    function injectStyles(): void {
        if (document.getElementById('sb-ds-style')) return;
        const style = document.createElement('style');
        style.id = 'sb-ds-style';
        style.textContent = `
.ds-app { font-size: 13px; color: var(--SmartThemeTextColor); }

/* Sub-tabs — 与外层 fs-tab-btn 风格完全一致 */
.ds-subtabs { display:flex; gap:5px; margin-bottom:10px; }
.ds-subtab { flex:1; padding:7px 8px; background:var(--SmartThemeChatTintColor, rgba(255,255,255,0.06)); border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15)); border-radius:5px; color:var(--SmartThemeTextColor); font-size:11px; cursor:pointer; transition:border-color 0.2s, background 0.2s, color 0.2s; white-space:nowrap; opacity:0.7; }
.ds-subtab.active { border-color:var(--SmartThemeQuoteColor, #007bff); background:rgba(0,123,255,0.1); color:var(--SmartThemeQuoteColor, #007bff); opacity:1; }
.ds-subtab:hover:not(.active) { border-color:var(--SmartThemeBorderColor, rgba(255,255,255,0.3)); opacity:0.9; }

/* 属性卡片 */
.ds-card { background:var(--SmartThemeChatTintColor, rgba(255,255,255,0.05)); border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15)); border-radius:6px; padding:10px 12px; margin-bottom:8px; }
.ds-card-head { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
.ds-card-icon { opacity:0.7; }
.ds-card-label { flex:1; font-weight:bold; font-size:12px; color:var(--SmartThemeTextColor); }
.ds-card-val { font-size:15px; font-weight:bold; color:var(--SmartThemeQuoteColor, #007bff); }
.ds-card-max { opacity:0.5; font-size:12px; }
.ds-progress-track { height:4px; background:var(--SmartThemeBorderColor, rgba(255,255,255,0.15)); border-radius:2px; overflow:hidden; margin-bottom:6px; }
.ds-progress-fill { height:100%; background:var(--SmartThemeQuoteColor, #007bff); border-radius:2px; transition:width 0.3s ease; opacity:0.8; }
.ds-stage-desc { font-size:11px; opacity:0.65; margin-bottom:6px; font-style:italic; color:var(--SmartThemeTextColor); }
.ds-card-controls { display:flex; align-items:center; gap:6px; }
.ds-btn-step { padding:6px 10px; border-radius:4px; border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.2)); background:var(--SmartThemeChatTintColor, rgba(255,255,255,0.08)); color:var(--SmartThemeTextColor); cursor:pointer; font-size:12px; transition:border-color 0.2s, color 0.2s; }
.ds-btn-step:hover { border-color:var(--SmartThemeQuoteColor, #007bff); color:var(--SmartThemeQuoteColor, #007bff); }
.ds-val-input { flex:1; text-align:center; background:var(--SmartThemeChatTintColor, rgba(255,255,255,0.08)); border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.2)); border-radius:4px; color:var(--SmartThemeTextColor); padding:5px 6px; font-size:12px; min-width:0; transition:border-color 0.2s, box-shadow 0.2s; }
.ds-val-input:focus { outline:none; border-color:var(--SmartThemeQuoteColor, #007bff); box-shadow:0 0 0 2px rgba(0,123,255,0.18); }
.ds-refresh-btn { width:100%; padding:7px; margin-top:4px; background:var(--SmartThemeChatTintColor, rgba(255,255,255,0.06)); border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15)); border-radius:5px; color:var(--SmartThemeTextColor); cursor:pointer; font-size:12px; opacity:0.7; transition:border-color 0.2s, color 0.2s, opacity 0.2s; }
.ds-refresh-btn:hover { opacity:1; border-color:var(--SmartThemeQuoteColor, #007bff); color:var(--SmartThemeQuoteColor, #007bff); }

/* 配置区 */
.ds-config-row { display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1)); margin-bottom:10px; }
.ds-toggle-label { display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; font-size:12px; color:var(--SmartThemeTextColor); }
.ds-hint { font-size:11px; opacity:0.5; color:var(--SmartThemeTextColor); }
.ds-section-hd { display:flex; align-items:center; justify-content:space-between; font-size:11px; font-weight:bold; opacity:0.85; margin-bottom:6px; color:var(--SmartThemeTextColor); }
.ds-add-btn { width:22px; height:22px; border-radius:4px; border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.2)); background:var(--SmartThemeChatTintColor, rgba(255,255,255,0.08)); color:var(--SmartThemeTextColor); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:11px; flex-shrink:0; transition:border-color 0.2s, color 0.2s; }
.ds-add-btn:hover { border-color:var(--SmartThemeQuoteColor, #007bff); color:var(--SmartThemeQuoteColor, #007bff); }
.ds-list-item { display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:5px; background:var(--SmartThemeChatTintColor, rgba(255,255,255,0.05)); border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1)); margin-bottom:4px; font-size:12px; color:var(--SmartThemeTextColor); }
.ds-list-icon { opacity:0.6; flex-shrink:0; }
.ds-list-label { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ds-list-key { opacity:0.5; font-size:11px; white-space:nowrap; font-family:monospace; }
.ds-list-range { opacity:0.4; font-size:11px; white-space:nowrap; }
.ds-icon-btn { width:22px; height:22px; border-radius:4px; border:1px solid transparent; background:transparent; color:var(--SmartThemeTextColor); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:11px; flex-shrink:0; opacity:0.6; transition:border-color 0.2s, background 0.2s, color 0.2s, opacity 0.2s; }
.ds-icon-btn:hover { border-color:var(--SmartThemeBorderColor, rgba(255,255,255,0.2)); background:var(--SmartThemeChatTintColor, rgba(255,255,255,0.08)); opacity:1; }
.ds-icon-btn.ds-del:hover { border-color:rgba(231,76,60,0.5); background:rgba(231,76,60,0.08); color:#e74c3c; opacity:1; }
.ds-toggle-on { color:var(--SmartThemeQuoteColor, #27ae60); font-size:18px; cursor:pointer; flex-shrink:0; }
.ds-toggle-off { color:var(--SmartThemeTextColor); opacity:0.3; font-size:18px; cursor:pointer; flex-shrink:0; }
.ds-empty-sm { text-align:center; padding:8px; opacity:0.4; font-size:11px; color:var(--SmartThemeTextColor); }

/* 历史记录 */
.ds-empty { text-align:center; padding:20px; opacity:0.4; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:12px; color:var(--SmartThemeTextColor); }
.ds-log-row { display:grid; grid-template-columns:100px 1fr 42px 1fr; gap:4px; padding:5px 4px; border-bottom:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.06)); font-size:11px; align-items:center; }
.ds-log-row:last-child { border-bottom:none; }
.ds-log-time { opacity:0.45; white-space:nowrap; color:var(--SmartThemeTextColor); }
.ds-log-label { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px; color:var(--SmartThemeTextColor); }
.ds-log-pos { color:#27ae60; font-weight:bold; text-align:center; }
.ds-log-neg { color:#e74c3c; font-weight:bold; text-align:center; }
.ds-log-reason { opacity:0.5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--SmartThemeTextColor); }

/* 内联表单 */
.ds-inline-form { background:var(--SmartThemeChatTintColor, rgba(255,255,255,0.05)); border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15)); border-left:3px solid var(--SmartThemeQuoteColor, #007bff); border-radius:5px; padding:10px 12px; margin-top:6px; margin-bottom:6px; }
.ds-inline-form-hd { font-size:11px; font-weight:bold; color:var(--SmartThemeQuoteColor, #007bff); margin-bottom:10px; display:flex; align-items:center; gap:5px; }
.ds-form-grid { display:grid; grid-template-columns:auto 1fr; gap:7px 10px; align-items:center; margin-bottom:8px; }
.ds-form-grid label { font-size:11px; font-weight:bold; opacity:0.8; white-space:nowrap; color:var(--SmartThemeTextColor); }
.ds-inp { width:100%; padding:6px 8px; background:var(--SmartThemeChatTintColor, rgba(255,255,255,0.08)); border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.2)); border-radius:4px; color:var(--SmartThemeTextColor); font-size:12px; box-sizing:border-box; transition:border-color 0.2s, box-shadow 0.2s; }
.ds-inp:focus { outline:none; border-color:var(--SmartThemeQuoteColor, #007bff); box-shadow:0 0 0 2px rgba(0,123,255,0.18); }
.ds-inp:disabled { opacity:0.4; cursor:not-allowed; }
.ds-inp-sm { width:70px; }
.ds-textarea { resize:vertical; min-height:60px; font-family:inherit; line-height:1.5; }
.ds-four-col { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
.ds-stages-hd { display:flex; align-items:center; justify-content:space-between; font-size:11px; font-weight:bold; opacity:0.8; margin:8px 0 5px; color:var(--SmartThemeTextColor); }
.ds-stage-row,.ds-op-row { display:flex; gap:6px; align-items:center; margin-bottom:4px; }
.ds-form-footer { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; padding-top:8px; border-top:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1)); }
.ds-btn-primary { padding:6px 14px; background:rgba(0,123,255,0.1); border:1px solid var(--SmartThemeQuoteColor, #007bff); border-radius:5px; color:var(--SmartThemeQuoteColor, #007bff); cursor:pointer; font-size:12px; transition:background 0.2s; }
.ds-btn-primary:hover { background:rgba(0,123,255,0.22); }
.ds-btn-ghost { padding:6px 14px; background:var(--SmartThemeChatTintColor, rgba(255,255,255,0.06)); border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.2)); border-radius:5px; color:var(--SmartThemeTextColor); cursor:pointer; font-size:12px; transition:border-color 0.2s; }
.ds-btn-ghost:hover { border-color:var(--SmartThemeQuoteColor, #007bff); color:var(--SmartThemeQuoteColor, #007bff); }
        `;
        document.head.appendChild(style);
    }

    // ── Vue 应用 ──────────────────────────────────────────────────────────────

    function initVueApp(): void {
        const VueLib: any = (window as any).Vue;
        if (!VueLib) {
            console.error('[动态系统] Vue 不可用');
            return;
        }

        injectStyles();

        const { createApp, ref, onMounted, onUnmounted } = VueLib;

        // ── AttrCard 子组件 ────────────────────────────────────────────────

        const AttrCard = {
            props: ['attr', 'value'],
            emits: ['add', 'set'],
            computed: {
                pct(this: any) {
                    const span = this.attr.max - this.attr.min;
                    if (span <= 0) return 0;
                    return Math.round(((this.value ?? this.attr.defaultValue) - this.attr.min) / span * 100);
                },
                stageDesc(this: any) {
                    if (!this.attr.stages?.length) return '';
                    const val = this.value ?? this.attr.defaultValue;
                    const sorted = [...this.attr.stages].sort((a: Stage, b: Stage) => b.threshold - a.threshold);
                    const s = sorted.find((st: Stage) => val >= st.threshold);
                    return s ? `${s.label}：${s.description}` : '';
                },
                displayVal(this: any) {
                    return this.value ?? this.attr.defaultValue;
                },
            },
            template: `
                <div class="ds-card">
                    <div class="ds-card-head">
                        <i :class="'fa-solid ' + attr.icon + ' ds-card-icon'"></i>
                        <span class="ds-card-label">{{ attr.label }}</span>
                        <span class="ds-card-val">{{ displayVal }}</span>
                        <span class="ds-card-max">/{{ attr.max }}</span>
                    </div>
                    <div class="ds-progress-track">
                        <div class="ds-progress-fill" :style="{width: pct + '%'}"></div>
                    </div>
                    <div v-if="stageDesc" class="ds-stage-desc">{{ stageDesc }}</div>
                    <div class="ds-card-controls">
                        <button class="ds-btn-step" @click="$emit('add', attr, -attr.step)">-{{ attr.step }}</button>
                        <input type="number" class="ds-val-input"
                            :value="displayVal" :min="attr.min" :max="attr.max"
                            @change="(e) => $emit('set', attr, Number(e.target.value))"/>
                        <button class="ds-btn-step" @click="$emit('add', attr, attr.step)">+{{ attr.step }}</button>
                    </div>
                </div>
            `,
        };

        // ── 根组件 ─────────────────────────────────────────────────────────

        const App = {
            components: { AttrCard },
            setup() {
                const settings = getSettings();
                const activeTab = ref('status');
                const attrs = ref(settings.attributes);
                const rules = ref(settings.rules);
                const injectPrompt = ref(settings.injectPrompt);
                const vals = ref({} as Record<string, number>);
                const log = ref([] as LogEntry[]);

                // 内联表单状态
                const editAttr = ref(null as AttributeDef | null);
                const isNewAttr = ref(false);
                const editRule = ref(null as RuleDef | null);
                const isNewRule = ref(false);

                // ── 数据刷新 ──────────────────────────────────────────────

                function refreshVals(): void {
                    const v: Record<string, number> = {};
                    attrs.value.forEach(a => { v[a.key] = getVarNum(a.key); });
                    vals.value = v;
                    log.value = getChatLog();
                }

                function persist(): void {
                    const s = getSettings();
                    s.attributes = attrs.value;
                    s.rules = rules.value;
                    s.injectPrompt = injectPrompt.value;
                    saveSettings();
                    updatePrompt(s);
                }

                // ── 属性 CRUD ─────────────────────────────────────────────

                function openNewAttr(): void {
                    editAttr.value = { key: '', label: '', icon: 'fa-star', min: 0, max: 100, defaultValue: 50, step: 5, stages: [] };
                    isNewAttr.value = true;
                }

                function openEditAttr(a: AttributeDef): void {
                    editAttr.value = JSON.parse(JSON.stringify(a));
                    isNewAttr.value = false;
                }

                function saveAttrForm(): void {
                    if (!editAttr.value || !editAttr.value.key.trim() || !editAttr.value.label.trim()) return;
                    if (isNewAttr.value) {
                        attrs.value.push(editAttr.value);
                    } else {
                        const idx = attrs.value.findIndex(a => a.key === editAttr.value!.key);
                        if (idx >= 0) attrs.value[idx] = editAttr.value;
                    }
                    persist();
                    editAttr.value = null;
                }

                function deleteAttr(key: string): void {
                    if (!confirm(`删除属性 "${key}"？`)) return;
                    attrs.value = attrs.value.filter(a => a.key !== key);
                    persist();
                }

                function addStage(): void {
                    editAttr.value?.stages.push({ threshold: 0, label: '', description: '' });
                }

                function removeStage(i: number): void {
                    editAttr.value?.stages.splice(i, 1);
                }

                // ── 规则 CRUD ─────────────────────────────────────────────

                function openNewRule(): void {
                    editRule.value = { id: Date.now().toString(), name: '', enabled: true, conditionPrompt: '', onMatch: [], onMiss: [], cooldown: 0, lastTriggered: 0 };
                    isNewRule.value = true;
                }

                function openEditRule(r: RuleDef): void {
                    editRule.value = JSON.parse(JSON.stringify(r));
                    isNewRule.value = false;
                }

                function saveRuleForm(): void {
                    if (!editRule.value || !editRule.value.name.trim()) return;
                    if (isNewRule.value) {
                        rules.value.push(editRule.value);
                    } else {
                        const idx = rules.value.findIndex(r => r.id === editRule.value!.id);
                        if (idx >= 0) rules.value[idx] = editRule.value;
                    }
                    persist();
                    editRule.value = null;
                }

                function toggleRule(r: RuleDef): void {
                    r.enabled = !r.enabled;
                    persist();
                }

                function deleteRule(id: string): void {
                    rules.value = rules.value.filter(r => r.id !== id);
                    persist();
                }

                function addOp(list: VarOp[]): void {
                    list.push({ key: attrs.value[0]?.key ?? '', delta: 0 });
                }

                function removeOp(list: VarOp[], i: number): void {
                    list.splice(i, 1);
                }

                // ── 手动调整 ──────────────────────────────────────────────

                async function onAdd(attr: AttributeDef, delta: number): Promise<void> {
                    await addVar(attr, delta, '手动调整');
                    refreshVals();
                }

                async function onSet(attr: AttributeDef, val: number): Promise<void> {
                    await setVar(attr, val);
                    refreshVals();
                }

                // ── 格式化工具 ────────────────────────────────────────────

                function fmtTime(ts: number): string {
                    return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                }

                // ── 生命周期 ──────────────────────────────────────────────

                let pollTimer: number;
                let aiMsgHandler: (data: any) => void;

                onMounted(() => {
                    refreshVals();
                    pollTimer = window.setInterval(refreshVals, 3000);

                    const es: any = (window as any).eventSource;
                    const et: any = (window as any).event_types;
                    if (es && et?.CHARACTER_MESSAGE_RENDERED) {
                        aiMsgHandler = async (_data: any) => {
                            const text = getLastAIMessage();
                            if (text) {
                                const changed = await parseReply(text, getSettings());
                                if (changed) refreshVals();
                            }
                        };
                        es.on(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler);
                    }

                    updatePrompt(getSettings());
                });

                onUnmounted(() => {
                    clearInterval(pollTimer);
                    const es: any = (window as any).eventSource;
                    const et: any = (window as any).event_types;
                    if (es && et?.CHARACTER_MESSAGE_RENDERED && aiMsgHandler) {
                        es.removeListener(et.CHARACTER_MESSAGE_RENDERED, aiMsgHandler);
                    }
                    getCtx()?.setExtensionPrompt?.(INJECT_KEY, '', 1, 0);
                });

                return {
                    activeTab, attrs, rules, injectPrompt, vals, log,
                    editAttr, isNewAttr,
                    editRule, isNewRule,
                    refreshVals, persist,
                    openNewAttr, openEditAttr, saveAttrForm, deleteAttr, addStage, removeStage,
                    openNewRule, openEditRule, saveRuleForm, toggleRule, deleteRule, addOp, removeOp,
                    onAdd, onSet, fmtTime,
                };
            },
            template: `
                <div class="ds-app">

                    <!-- Sub-tab 切换 -->
                    <div class="ds-subtabs">
                        <button :class="['ds-subtab', {active: activeTab==='status'}]" @click="activeTab='status'">
                            <i class="fa-solid fa-gauge-high"></i> 状态
                        </button>
                        <button :class="['ds-subtab', {active: activeTab==='rules'}]" @click="activeTab='rules'">
                            <i class="fa-solid fa-sliders"></i> 配置
                        </button>
                        <button :class="['ds-subtab', {active: activeTab==='history'}]" @click="activeTab='history'">
                            <i class="fa-solid fa-clock-rotate-left"></i> 历史
                        </button>
                    </div>

                    <!-- ─── 状态面板 ─── -->
                    <div v-show="activeTab==='status'">
                        <div v-if="attrs.length === 0" class="ds-empty">
                            <i class="fa-solid fa-circle-plus" style="font-size:24px"></i>
                            <span>还没有属性，请在「配置」中添加</span>
                        </div>
                        <attr-card
                            v-for="a in attrs" :key="a.key"
                            :attr="a" :value="vals[a.key] ?? a.defaultValue"
                            @add="onAdd" @set="onSet"
                        />
                        <button class="ds-refresh-btn" @click="refreshVals">
                            <i class="fa-solid fa-rotate"></i> 刷新数值
                        </button>
                    </div>

                    <!-- ─── 配置面板 ─── -->
                    <div v-show="activeTab==='rules'">
                        <div class="ds-config-row">
                            <label class="ds-toggle-label">
                                <input type="checkbox" v-model="injectPrompt" @change="persist"/>
                                注入提示词
                            </label>
                            <span class="ds-hint">让 AI 了解当前状态并按规则附加 [ds:addvar] 标签</span>
                        </div>

                        <!-- 属性定义 -->
                        <div class="ds-section-hd">
                            <span>属性定义</span>
                            <button class="ds-add-btn" @click="editAttr ? (editAttr = null) : openNewAttr()" title="添加属性">
                                <i :class="editAttr && isNewAttr ? 'fa-solid fa-xmark' : 'fa-solid fa-plus'"></i>
                            </button>
                        </div>
                        <div v-if="attrs.length===0 && !editAttr" class="ds-empty-sm">暂无属性</div>
                        <div v-for="a in attrs" :key="a.key" class="ds-list-item">
                            <i :class="'fa-solid '+a.icon+' ds-list-icon'"></i>
                            <span class="ds-list-label">{{ a.label }}</span>
                            <span class="ds-list-key">{{ a.key }}</span>
                            <span class="ds-list-range">[{{ a.min }}~{{ a.max }}]</span>
                            <button class="ds-icon-btn" @click="openEditAttr(a)" title="编辑"><i class="fa-solid fa-pen"></i></button>
                            <button class="ds-icon-btn ds-del" @click="deleteAttr(a.key)" title="删除"><i class="fa-solid fa-trash"></i></button>
                        </div>

                        <!-- 属性内联表单 -->
                        <div v-if="editAttr" class="ds-inline-form">
                            <div class="ds-inline-form-hd">
                                <i class="fa-solid fa-pen-to-square"></i>
                                {{ isNewAttr ? '新建属性' : '编辑：' + editAttr.label }}
                            </div>
                            <div class="ds-form-grid">
                                <label>Key（唯一标识）</label>
                                <input v-model="editAttr.key" :disabled="!isNewAttr" class="ds-inp" placeholder="favorability"/>
                                <label>名称</label>
                                <input v-model="editAttr.label" class="ds-inp" placeholder="好感度"/>
                                <label>图标 (fa-xxx)</label>
                                <input v-model="editAttr.icon" class="ds-inp" placeholder="fa-heart"/>
                                <label>最小 / 最大 / 默认 / 步长</label>
                                <div class="ds-four-col">
                                    <input v-model.number="editAttr.min" type="number" class="ds-inp ds-inp-sm" placeholder="0"/>
                                    <input v-model.number="editAttr.max" type="number" class="ds-inp ds-inp-sm" placeholder="100"/>
                                    <input v-model.number="editAttr.defaultValue" type="number" class="ds-inp ds-inp-sm" placeholder="50"/>
                                    <input v-model.number="editAttr.step" type="number" class="ds-inp ds-inp-sm" placeholder="5"/>
                                </div>
                            </div>
                            <div class="ds-stages-hd">
                                阶段描述
                                <button class="ds-add-btn" @click="addStage"><i class="fa-solid fa-plus"></i></button>
                            </div>
                            <div v-for="(s, i) in editAttr.stages" :key="i" class="ds-stage-row">
                                <input v-model.number="s.threshold" type="number" class="ds-inp ds-inp-sm" placeholder="阈值"/>
                                <input v-model="s.label" class="ds-inp ds-inp-sm" placeholder="阶段名"/>
                                <input v-model="s.description" class="ds-inp" placeholder="行为描述（注入到提示词）"/>
                                <button class="ds-icon-btn ds-del" @click="removeStage(i)"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                            <div class="ds-form-footer">
                                <button class="ds-btn-primary" @click="saveAttrForm">保存</button>
                                <button class="ds-btn-ghost" @click="editAttr = null">取消</button>
                            </div>
                        </div>

                        <!-- 触发规则 -->
                        <div class="ds-section-hd" style="margin-top:14px">
                            <span>触发规则</span>
                            <button class="ds-add-btn" @click="editRule ? (editRule = null) : openNewRule()" title="添加规则">
                                <i :class="editRule && isNewRule ? 'fa-solid fa-xmark' : 'fa-solid fa-plus'"></i>
                            </button>
                        </div>
                        <div v-if="rules.length===0 && !editRule" class="ds-empty-sm">暂无规则</div>
                        <div v-for="r in rules" :key="r.id" class="ds-list-item">
                            <i :class="r.enabled ? 'ds-toggle-on fa-solid fa-toggle-on' : 'ds-toggle-off fa-solid fa-toggle-off'"
                                @click="toggleRule(r)"></i>
                            <span class="ds-list-label">{{ r.name }}</span>
                            <button class="ds-icon-btn" @click="openEditRule(r)" title="编辑"><i class="fa-solid fa-pen"></i></button>
                            <button class="ds-icon-btn ds-del" @click="deleteRule(r.id)" title="删除"><i class="fa-solid fa-trash"></i></button>
                        </div>

                        <!-- 规则内联表单 -->
                        <div v-if="editRule" class="ds-inline-form">
                            <div class="ds-inline-form-hd">
                                <i class="fa-solid fa-pen-to-square"></i>
                                {{ isNewRule ? '新建规则' : '编辑：' + editRule.name }}
                            </div>
                            <div class="ds-form-grid">
                                <label>规则名称</label>
                                <input v-model="editRule.name" class="ds-inp" placeholder="例：共进晚餐"/>
                                <label>判定提示词</label>
                                <textarea v-model="editRule.conditionPrompt" class="ds-inp ds-textarea" rows="3"
                                    placeholder="告诉 AI 如何判断条件是否成立，成立时在回复末附加 [ds:addvar] 标签"></textarea>
                            </div>
                            <div class="ds-stages-hd">
                                命中时操作
                                <button class="ds-add-btn" @click="addOp(editRule.onMatch)"><i class="fa-solid fa-plus"></i></button>
                            </div>
                            <div v-for="(op, i) in editRule.onMatch" :key="'m'+i" class="ds-op-row">
                                <select v-model="op.key" class="ds-inp">
                                    <option v-for="a in attrs" :value="a.key" :key="a.key">{{ a.label }}（{{ a.key }}）</option>
                                </select>
                                <input v-model.number="op.delta" type="number" class="ds-inp ds-inp-sm" placeholder="±数值"/>
                                <button class="ds-icon-btn ds-del" @click="removeOp(editRule.onMatch, i)"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                            <div class="ds-stages-hd">
                                未命中时操作
                                <button class="ds-add-btn" @click="addOp(editRule.onMiss)"><i class="fa-solid fa-plus"></i></button>
                            </div>
                            <div v-for="(op, i) in editRule.onMiss" :key="'s'+i" class="ds-op-row">
                                <select v-model="op.key" class="ds-inp">
                                    <option v-for="a in attrs" :value="a.key" :key="a.key">{{ a.label }}（{{ a.key }}）</option>
                                </select>
                                <input v-model.number="op.delta" type="number" class="ds-inp ds-inp-sm" placeholder="±数值"/>
                                <button class="ds-icon-btn ds-del" @click="removeOp(editRule.onMiss, i)"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                            <div class="ds-form-footer">
                                <button class="ds-btn-primary" @click="saveRuleForm">保存</button>
                                <button class="ds-btn-ghost" @click="editRule = null">取消</button>
                            </div>
                        </div>
                    </div>

                    <!-- ─── 历史面板 ─── -->
                    <div v-show="activeTab==='history'">
                        <div v-if="log.length===0" class="ds-empty">
                            <i class="fa-solid fa-scroll" style="font-size:24px"></i>
                            <span>暂无变更记录</span>
                        </div>
                        <div v-for="(e, i) in log" :key="i" class="ds-log-row">
                            <span class="ds-log-time">{{ fmtTime(e.time) }}</span>
                            <span class="ds-log-label">{{ e.label }}</span>
                            <span :class="e.delta >= 0 ? 'ds-log-pos' : 'ds-log-neg'">
                                {{ e.delta >= 0 ? '+' : '' }}{{ e.delta }}
                            </span>
                            <span class="ds-log-reason">{{ e.reason }}</span>
                        </div>
                    </div>

                </div>
            `,
        };

        // 挂载
        const el = document.getElementById('sb-ds-root');
        if (!el) { console.error('[动态系统] 找不到挂载点 #sb-ds-root'); return; }

        const app = createApp(App);
        app.mount(el);
        (window as any).__sb_ds_app__ = app;
        console.log('[动态系统] Vue 应用已挂载');
    }

    // ── Vue 加载器 ────────────────────────────────────────────────────────────

    if ((window as any).Vue) {
        initVueApp();
    } else {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.global.prod.js';
        s.onload = initVueApp;
        s.onerror = () => {
            console.error('[动态系统] Vue CDN 加载失败');
            const el = document.getElementById('sb-ds-root');
            if (el) el.innerHTML = '<p style="color:#dc3545;padding:12px;font-size:12px"><i class="fa-solid fa-circle-exclamation"></i> Vue 加载失败，请检查网络连接</p>';
        };
        document.head.appendChild(s);
    }

})();
