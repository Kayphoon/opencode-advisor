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
function normalizeText(text) {
    return text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}
function hashNote(note) {
    let hash = 0;
    for (let i = 0; i < note.length; i++) {
        hash = (hash << 5) - hash + note.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(36);
}
const SEVERITY_WEIGHT = {
    nit: 1,
    concern: 2,
    blocker: 3,
};
export function filterAndGuardNotes(notes, state, maxNotes) {
    const accepted = [];
    for (const item of notes) {
        if (accepted.length >= maxNotes)
            break;
        const trimmed = item.note.trim();
        if (!trimmed)
            continue;
        // 1. Content-free phrase suppression
        const isContentFree = CONTENT_FREE_PATTERNS.some((re) => re.test(trimmed));
        if (isContentFree)
            continue;
        const normalized = normalizeText(trimmed);
        if (normalized.length < 5)
            continue;
        const hash = hashNote(normalized);
        // 2. Deduplication (check seen hashes)
        const existingIndex = state.seenHashes.indexOf(hash);
        if (existingIndex !== -1) {
            // Allow only if this is an explicit severity upgrade
            continue;
        }
        let effectiveSeverity = item.severity;
        // 3. ImmuneTurns Cooldown
        // If under cooldown, downgrade concern/blocker to avoid repetitive wake storms
        if (state.userTurnCount < state.immuneUntilUserTurn) {
            if (effectiveSeverity === "concern") {
                effectiveSeverity = "nit";
            }
        }
        accepted.push({
            note: trimmed,
            severity: effectiveSeverity,
        });
        // Record into FIFO hash ring (limit 64)
        state.seenHashes.push(hash);
        if (state.seenHashes.length > 64) {
            state.seenHashes.shift();
        }
    }
    return accepted;
}
//# sourceMappingURL=guard.js.map