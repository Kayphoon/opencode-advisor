import { getOrCreateSessionState, resetConsecutiveAdvisorTurns, recordDiagnostics } from "./state.js";
import { extractSessionDelta } from "./transcript.js";
import { runReviewerAgent } from "./reviewer.js";
import { filterAndGuardNotes } from "./guard.js";
import { deliverNotes } from "./delivery.js";
import { removeAdvisorInstruction } from "./instructions.js";
import { collectDeterministicSignals } from "./enrich.js";
function isDiagnosticEvent(type) {
    return type.toLowerCase().includes("diagnostic");
}
function extractDiagnostics(event) {
    const data = event.data ?? {};
    const list = [];
    const push = (value) => {
        if (typeof value === "string" && value.trim()) {
            list.push(value.trim());
            return;
        }
        if (value && typeof value === "object") {
            const obj = value;
            const file = typeof obj["file"] === "string" ? obj["file"] : typeof obj["uri"] === "string" ? obj["uri"] : "";
            const message = typeof obj["message"] === "string"
                ? obj["message"]
                : typeof obj["text"] === "string"
                    ? obj["text"]
                    : "";
            const line = typeof obj["line"] === "number" ? obj["line"] : undefined;
            if (message) {
                list.push(`${file}${line !== undefined ? `:${line}` : ""} ${message}`.trim());
            }
        }
    };
    for (const key of ["diagnostics", "items", "errors", "problems"]) {
        const value = data[key];
        if (Array.isArray(value))
            value.forEach(push);
    }
    if (typeof data["diagnostic"] === "string")
        push(data["diagnostic"]);
    return list;
}
export function extractSessionID(event) {
    const candidate = event.durable?.aggregateID ||
        event.data?.["sessionID"] ||
        event.data?.["id"] ||
        event["sessionID"] ||
        "";
    if (typeof candidate === "string" && candidate.startsWith("ses")) {
        return candidate;
    }
    return "";
}
export function startEventObserver(ctx, deps, rootSignal) {
    const { config, watchdog } = deps;
    const reviewInterval = Math.max(1, config.reviewInterval ?? 1);
    const debounceTimers = new Map();
    async function scheduleReview(sessionID, workspaceDir) {
        const state = getOrCreateSessionState(sessionID, workspaceDir);
        if (state.isReviewing)
            return;
        const existing = debounceTimers.get(sessionID);
        if (existing)
            clearTimeout(existing);
        const timer = setTimeout(async () => {
            debounceTimers.delete(sessionID);
            if (rootSignal.aborted || state.isReviewing)
                return;
            // reviewInterval: review every Nth eligible update. Skipped deltas are held
            // (the cursor is not advanced) and merged into the next review.
            state.eligibleUpdates += 1;
            if (state.eligibleUpdates % reviewInterval !== 0)
                return;
            state.isReviewing = true;
            const reviewAbort = new AbortController();
            state.abortController = reviewAbort;
            const timeout = setTimeout(() => reviewAbort.abort(), watchdog.timeoutMs);
            try {
                const raw = await ctx.session.context({ sessionID });
                const messages = Array.isArray(raw)
                    ? raw
                    : (raw?.data || []);
                if (!messages || messages.length === 0)
                    return;
                const signals = await collectDeterministicSignals(ctx, state, reviewAbort.signal);
                const { deltaText, newLastID, hasMeaningfulWork } = extractSessionDelta(messages, state.lastEvaluatedMessageID, state.rollingSummary, state.seenHashes, signals);
                if (!hasMeaningfulWork || !deltaText.trim()) {
                    state.lastEvaluatedMessageID = newLastID;
                    return;
                }
                console.log(`[advisor] Reviewing delta for session ${sessionID} (${deltaText.length} chars)...`);
                const rawNotes = await runReviewerAgent(deltaText, workspaceDir || ctx.location?.directory || process.cwd(), watchdog, config.requireEvidence !== false, reviewAbort.signal);
                const guardedNotes = filterAndGuardNotes(rawNotes, state, {
                    maxNotes: config.maxNotesPerUpdate ?? 3,
                    requireEvidence: config.requireEvidence !== false,
                });
                if (guardedNotes.length > 0) {
                    console.log(`[advisor] Delivering ${guardedNotes.length} notes to session ${sessionID}.`);
                    await deliverNotes(guardedNotes, sessionID, state, config, ctx);
                }
                else {
                    // All clear: remove any lingering advisor context instructions
                    await removeAdvisorInstruction(sessionID);
                }
                state.lastEvaluatedMessageID = newLastID;
            }
            catch (err) {
                if (!reviewAbort.signal.aborted) {
                    console.error(`[advisor] Error in review loop:`, err);
                }
            }
            finally {
                clearTimeout(timeout);
                state.isReviewing = false;
                state.abortController = null;
            }
        }, 600);
        debounceTimers.set(sessionID, timer);
    }
    void (async () => {
        try {
            for await (const event of ctx.event.subscribe({ signal: rootSignal })) {
                if (rootSignal.aborted)
                    break;
                const sessionID = extractSessionID(event);
                if (!sessionID)
                    continue;
                const eventDir = event.location?.directory || ctx.location?.directory || process.cwd();
                // Deterministic signals: capture LSP diagnostics as they stream.
                if (isDiagnosticEvent(event.type)) {
                    const diagnostics = extractDiagnostics(event);
                    if (diagnostics.length > 0)
                        recordDiagnostics(sessionID, diagnostics);
                }
                // Genuine user input resets the circuit breaker.
                if (event.type === "session.inbox.enqueued" ||
                    event.type === "session.prompt" ||
                    event.type === "session.message.content.updated") {
                    const payloadMeta = event.data?.["item"]?.["payload"]?.["metadata"];
                    const meta = event.data?.["metadata"] || payloadMeta;
                    if (!meta || meta["advisor"] !== true) {
                        resetConsecutiveAdvisorTurns(sessionID);
                    }
                }
                // Turn completion triggers a (debounced, interval-gated) review.
                if (event.type === "session.step.ended" ||
                    event.type === "session.execution.succeeded" ||
                    event.type === "session.idle") {
                    await scheduleReview(sessionID, eventDir);
                }
            }
        }
        catch (err) {
            if (!rootSignal.aborted) {
                console.warn(`[advisor] event stream disconnected:`, err instanceof Error ? err.message : String(err));
            }
        }
    })();
}
//# sourceMappingURL=trigger.js.map