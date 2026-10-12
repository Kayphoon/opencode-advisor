import type { AdviceNote, AdviceSeverity, AdvisorSessionState } from "./types.js";

const CONTENT_FREE_PATTERNS = [
  /^stop[.!]*$/i,
  /^done[.!]*$/i,
  /^complete[.!]*$/i,
  /^no issue[.!;,\s\w]*$/i,
  /^lgtm[.!]*$/i,
  /^continue[.!]*$/i,
  /^nothing to add[.!]*$/i,
  /^looks good[.!]*$/i,
  /^all good[.!]*$/i,
];

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function hashNote(note: string): string {
  let hash = 0;
  for (let i = 0; i < note.length; i++) {
    hash = (hash << 5) - hash + note.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

const SEVERITY_WEIGHT: Record<AdviceSeverity, number> = {
  nit: 1,
  concern: 2,
  blocker: 3,
};

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
export function filterAndGuardNotes(
  notes: AdviceNote[],
  state: AdvisorSessionState,
  options: GuardOptions
): AdviceNote[] {
  const accepted: AdviceNote[] = [];

  for (const item of notes) {
    if (accepted.length >= options.maxNotes) break;

    const trimmed = item.note.trim();
    if (!trimmed) continue;

    // 1. Content-free phrase suppression
    if (CONTENT_FREE_PATTERNS.some((re) => re.test(trimmed))) continue;

    const normalized = normalizeText(trimmed);
    if (normalized.length < 5) continue;

    let effectiveSeverity: AdviceSeverity = item.severity;

    // 2. Evidence requirement (fact-checking enforcement)
    if (options.requireEvidence && effectiveSeverity === "blocker" && !item.evidence) {
      effectiveSeverity = "concern";
    }

    // 3. Dedupe by note hash AND by verified evidence location
    const hash = hashNote(normalized);
    const evidenceKey = item.evidence
      ? `ev:${item.evidence.file}:${item.evidence.line ?? ""}`
      : "";
    const evidenceHash = evidenceKey ? hashNote(evidenceKey) : "";

    if (state.seenHashes.includes(hash)) continue;
    if (evidenceHash && state.seenHashes.includes(evidenceHash)) continue;

    // 4. Cooldown downgrade
    if (state.userTurnCount < state.immuneUntilUserTurn && effectiveSeverity === "concern") {
      effectiveSeverity = "nit";
    }

    accepted.push({
      note: trimmed,
      severity: effectiveSeverity,
      evidence: item.evidence,
      suggestedPatch: item.suggestedPatch,
    });

    state.seenHashes.push(hash);
    if (evidenceHash) state.seenHashes.push(evidenceHash);
    while (state.seenHashes.length > 64) {
      state.seenHashes.shift();
    }
  }

  return accepted;
}

export { SEVERITY_WEIGHT };
