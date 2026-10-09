import { type RawMessage } from "./transcript.js";
import { type SessionClientLike } from "./delivery.js";
import type { AdvisorConfig, OpenCodeV2Event } from "./types.js";
export interface PluginContextLike extends SessionClientLike {
    event: {
        subscribe: (options?: {
            signal?: AbortSignal;
        }) => AsyncIterable<OpenCodeV2Event>;
    };
    location: {
        directory: string;
    };
    session: {
        context: (input: {
            sessionID: string;
        }) => Promise<RawMessage[]>;
        synthetic: (input: {
            sessionID: string;
            text: string;
            metadata?: Record<string, unknown>;
            resume?: boolean;
            delivery?: "steer" | "queue";
        }) => Promise<unknown>;
        prompt: (input: {
            sessionID: string;
            text: string;
            metadata?: Record<string, unknown>;
            resume?: boolean;
            delivery?: "steer" | "queue";
        }) => Promise<unknown>;
    };
}
export declare function startEventObserver(ctx: PluginContextLike, config: AdvisorConfig, rootSignal: AbortSignal): void;
//# sourceMappingURL=trigger.d.ts.map