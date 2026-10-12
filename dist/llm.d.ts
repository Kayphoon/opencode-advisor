import type { AdvisorProviderConfig } from "./types.js";
export interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content?: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
            name: string;
            arguments: string;
        };
    }>;
}
export interface ChatCompletionOptions {
    baseURL: string;
    apiKey: string;
    modelName: string;
    messages: ChatMessage[];
    tools?: Array<{
        type: "function";
        function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        };
    }>;
    temperature?: number;
    maxTokens?: number;
    signal: AbortSignal;
}
export interface ChatCompletionResult {
    message: ChatMessage | null;
    error?: string;
}
/** Strip a `provider/` prefix from a model slug. */
export declare function resolveModelName(slug: string): string;
export declare function normalizeBaseURL(provider: AdvisorProviderConfig | undefined, fallback: string): string;
/**
 * One OpenAI-compatible chat completion. Never throws for transport/HTTP errors —
 * returns `{ message: null, error }` so callers can fail open without blocking.
 */
export declare function callChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
//# sourceMappingURL=llm.d.ts.map