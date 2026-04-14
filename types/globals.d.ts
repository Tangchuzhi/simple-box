/**
 * 全局类型声明 — SillyTavern 运行时环境
 * 这些全局变量由 SillyTavern 宿主页面提供，无需 import。
 */

// ── SillyTavern 上下文 ────────────────────────────────────────────────────────

declare interface STCharacter {
    name: string;
    avatar?: string;
    [key: string]: any;
}

declare interface STChat extends Array<STChatMessage> {
    [index: number]: STChatMessage;
}

declare interface STChatMessage {
    name?: string;
    mes?: string;
    is_user?: boolean;
    is_system?: boolean;
    [key: string]: any;
}

declare interface STEventSource {
    once(event: string, callback: () => void): void;
    on(event: string, callback: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
}

declare interface STContext {
    characters: STCharacter[];
    chat: STChat;
    name1: string;
    name2: string;
    /** Sets an extension prompt injection into the AI context */
    setExtensionPrompt(key: string, value: string, position: number, depth: number, scan?: boolean, role?: number): void;
    /** All active extension prompts */
    extensionPrompts: { [key: string]: any };
    /** ST event emitter for listening to generation events */
    eventSource: STEventSource;
    /** Event type name constants (e.g. GENERATION_ENDED, GENERATION_STOPPED) */
    eventTypes: { [key: string]: string };
    /** @deprecated Use eventTypes */
    event_types: { [key: string]: string };
    /** Execute STScript slash commands programmatically */
    executeSlashCommandsWithOptions(command: string, options?: any): Promise<any>;
    [key: string]: any;
}

declare var SillyTavern: {
    getContext(): STContext;
    llm?: any;
    libs?: any;
};

// ── toastr 通知库 ─────────────────────────────────────────────────────────────

declare interface ToastrOptions {
    timeOut?: number;
    extendedTimeOut?: number;
    closeButton?: boolean;
    progressBar?: boolean;
    positionClass?: string;
    [key: string]: any;
}

declare var toastr: {
    success(message: string, title?: string, options?: ToastrOptions): void;
    error(message: string, title?: string, options?: ToastrOptions): void;
    warning(message: string, title?: string, options?: ToastrOptions): void;
    info(message: string, title?: string, options?: ToastrOptions): void;
};

// ── jQuery ────────────────────────────────────────────────────────────────────

declare var jQuery: (selectorOrCallback: string | (() => void)) => any;
declare var $: typeof jQuery;
