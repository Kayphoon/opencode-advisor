import type { AdviceNote, AdvisorConfig, AdvisorSessionState, SessionMessageLike } from "./types.js";
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
/** Render one note, including verified evidence and any suggested patch. */
export declare function formatNote(item: AdviceNote): string;
/**
 * Dual-channel delivery:
 * 1. Non-blockers (`nit`, `concern`) are attached via Instruction Entry
 *    (<context key="advisor">...</context>). This injects the advice into the
 *    model's next-step prompt without triggering a fake user message or redundant chat turn.
 * 2. Blockers are delivered as an immediate steer_waking prompt to halt execution and correct course.
 */
export declare function deliverNotes(notes: AdviceNote[], sessionID: string, state: AdvisorSessionState, config: AdvisorConfig, client: SessionClientLike): Promise<void>;
export type { SessionMessageLike };
//# sourceMappingURL=delivery.d.ts.map