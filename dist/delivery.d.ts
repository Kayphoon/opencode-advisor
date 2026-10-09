import type { AdviceNote, AdvisorConfig, AdvisorSessionState } from "./types.js";
export interface SessionClientLike {
    session: {
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
export declare function deliverNotes(notes: AdviceNote[], sessionID: string, state: AdvisorSessionState, config: AdvisorConfig, client: SessionClientLike): Promise<void>;
//# sourceMappingURL=delivery.d.ts.map