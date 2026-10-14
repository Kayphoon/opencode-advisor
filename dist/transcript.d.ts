export interface RawPart {
    type?: string;
    name?: string;
    text?: string;
    synthetic?: boolean;
    metadata?: Record<string, unknown>;
    output?: string;
    state?: {
        status?: string;
        input?: unknown;
        content?: Array<{
            type?: string;
            text?: string;
        }>;
    };
}
export interface RawMessage {
    id: string;
    type?: string;
    text?: string;
    metadata?: Record<string, unknown>;
    description?: string;
    content?: RawPart[];
    parts?: RawPart[];
}
export declare function truncateToolOutput(text: string, headLines?: number, tailLines?: number): string;
export declare function extractSessionDelta(allMessages: RawMessage[], lastEvaluatedID: string | null, rollingSummary: string, recentNotes: string[], extraSignals?: string): {
    deltaText: string;
    newLastID: string | null;
    hasMeaningfulWork: boolean;
};
//# sourceMappingURL=transcript.d.ts.map