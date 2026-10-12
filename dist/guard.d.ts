import type { AdviceNote, AdviceSeverity, AdvisorSessionState } from "./types.js";
declare const SEVERITY_WEIGHT: Record<AdviceSeverity, number>;
export interface GuardOptions {
    maxNotes: number;
    /** When true, a blocker without evidence is downgraded to concern. */
    requireEvidence: boolean;
}
/**
 * Filter, deduplicate, and de-escalate raw reviewer notes before delivery.
 *
 * Order of enforcement:
 *  1. content-free phrase suppression
 *  2. evidence requirement (blocker → concern when unverified)
 *  3. severity-aware dedupe (by note hash and by evidence location)
 *  4. immuneTurns cooldown downgrade
 *  5. per-update quota
 */
export declare function filterAndGuardNotes(notes: AdviceNote[], state: AdvisorSessionState, options: GuardOptions): AdviceNote[];
export { SEVERITY_WEIGHT };
//# sourceMappingURL=guard.d.ts.map