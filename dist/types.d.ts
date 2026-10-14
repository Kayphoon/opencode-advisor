export type AdviceSeverity = "nit" | "concern" | "blocker";
/**
 * Verified evidence backing an advice note. The reviewer must cite real code it
 * actually read — not a guess from the diff alone.
 */
export interface AdviceEvidence {
    /** Workspace-relative path of the file the fact was observed in. */
    file: string;
    /** 1-based line number, when the fact is line-specific. */
    line?: number;
    /** The concrete observed fact (what the code actually does). */
    observedFact: string;
}
export interface AdviceNote {
    note: string;
    severity: AdviceSeverity;
    /** Present when the reviewer verified the claim against the codebase. */
    evidence?: AdviceEvidence;
    /** Optional ready-to-apply fix sketch for concern/blocker notes. */
    suggestedPatch?: string;
}
export interface AdvisorDeliveryConfig {
    nit?: "synthetic_noreply" | "synthetic_waking";
    concern?: "synthetic_noreply" | "synthetic_waking";
    blocker?: "steer_waking" | "steer_noreply";
}
export interface AdvisorProviderConfig {
    baseURL?: string;
    apiKey?: string;
}
/**
 * Intrinsic consultation tool (Claude Code "advisor tool" pattern): lets the
 * primary agent request guidance from a stronger model at decision points.
 */
export interface AdvisorConsultConfig {
    /** Default true. When false the `consult_advisor` tool is not registered. */
    enabled?: boolean;
    /** Model used for consultations. Falls back to the watchdog model. */
    model?: string;
    provider?: AdvisorProviderConfig;
    systemPrompt?: string;
    /** Output token budget per consultation. */
    maxTokens?: number;
    /** How many recent session messages to attach as context. 0 disables. */
    includeContextMessages?: number;
}
export interface AdvisorConfig {
    enabled?: boolean;
    /** Watchdog model. `model` is a legacy alias kept for backward compatibility. */
    model?: string;
    watchdogModel?: string;
    variant?: string;
    provider?: AdvisorProviderConfig;
    reviewMode?: "step" | "idle" | "execution";
    /** Review every Nth eligible update; skipped updates join the next review. */
    reviewInterval?: number;
    maxToolSteps?: number;
    maxNotesPerUpdate?: number;
    immuneTurns?: number;
    timeoutMs?: number;
    maxTokens?: number;
    tools?: string[];
    delivery?: AdvisorDeliveryConfig;
    systemPrompt?: string;
    /**
     * When true (default), a `blocker` without verified evidence is downgraded to
     * `concern`. "Whoever asserts must prove."
     */
    requireEvidence?: boolean;
    consult?: AdvisorConsultConfig;
}
/** Fully resolved model settings for one role (watchdog or consult). */
export interface ResolvedModelConfig {
    role: "watchdog" | "consult";
    model: string;
    modelName: string;
    provider: AdvisorProviderConfig;
    systemPrompt: string;
    maxToolSteps: number;
    timeoutMs: number;
    tools: string[];
    maxTokens?: number;
    temperature: number;
}
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
    execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<string>;
}
export interface ToolExecutionContext {
    workspaceDir: string;
    signal: AbortSignal;
}
export interface AdvisorSessionState {
    sessionID: string;
    workspaceDir: string;
    lastEvaluatedMessageID: string | null;
    consecutiveAdvisorTurns: number;
    userTurnCount: number;
    immuneUntilUserTurn: number;
    /** Number of eligible turn-ends observed (drives `reviewInterval`). */
    eligibleUpdates: number;
    seenHashes: string[];
    rollingSummary: string;
    /** Latest LSP diagnostics observed for this session (deterministic signals). */
    diagnostics: string[];
    isReviewing: boolean;
    abortController: AbortController | null;
}
export interface OpenCodeV2Event {
    id?: string;
    created?: number;
    type: string;
    location?: {
        directory?: string;
        workspaceID?: string;
    };
    data?: Record<string, unknown>;
}
export interface SessionMessageLike {
    id: string;
    type?: string;
    text?: string;
    metadata?: Record<string, unknown>;
    description?: string;
    parts?: Array<{
        type?: string;
        text?: string;
        synthetic?: boolean;
        metadata?: Record<string, unknown>;
        output?: string;
    }>;
}
export interface NativeToolResult {
    content?: string;
    output?: unknown;
    metadata?: Record<string, unknown>;
}
export interface NativeToolContext {
    sessionID: string;
    signal: AbortSignal;
    progress?: (update: Record<string, unknown>) => Promise<void>;
}
export interface NativeToolDefinition {
    name: string;
    description: string;
    input: Record<string, unknown>;
    execute: (input: Record<string, unknown>, context: NativeToolContext) => Promise<NativeToolResult>;
}
export interface NativeToolEditor {
    add: (tool: NativeToolDefinition) => void;
}
/**
 * Structural view of the OpenCode V2 plugin context used by this plugin. Kept
 * intentionally loose so the plugin compiles against the promise-flavored
 * `@opencode/plugin` types without pinning every generic signature.
 */
export interface PluginContextLike {
    options?: Record<string, unknown>;
    location: {
        directory: string;
    };
    event: {
        subscribe: (options?: {
            signal?: AbortSignal;
        }) => AsyncIterable<OpenCodeV2Event>;
    };
    session: {
        context: (input: {
            sessionID: string;
        }) => Promise<SessionMessageLike[]>;
        synthetic: (input: {
            sessionID: string;
            text: string;
            metadata?: Record<string, unknown>;
            resume?: boolean;
            delivery?: "steer" | "queue";
            description?: string;
        }) => Promise<unknown>;
        prompt: (input: {
            sessionID: string;
            text: string;
            metadata?: Record<string, unknown>;
            resume?: boolean;
            delivery?: "steer" | "queue";
        }) => Promise<unknown>;
    };
    tool?: {
        transform: (callback: (editor: NativeToolEditor) => void) => Promise<{
            dispose: () => Promise<void>;
        }>;
    };
    vcs?: {
        diff?: (input: Record<string, unknown>) => Promise<unknown>;
        status?: (input?: Record<string, unknown>) => Promise<unknown>;
    };
}
//# sourceMappingURL=types.d.ts.map