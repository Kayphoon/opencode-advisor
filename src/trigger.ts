import { getOrCreateSessionState, resetConsecutiveAdvisorTurns, recordDiagnostics } from "./state.js";
import { extractSessionDelta, type RawMessage } from "./transcript.js";
import { runReviewerAgent } from "./reviewer.js";
import { filterAndGuardNotes } from "./guard.js";
import { deliverNotes } from "./delivery.js";
import { removeAdvisorInstruction } from "./instructions.js";
import { collectDeterministicSignals } from "./enrich.js";
import type { AdvisorConfig, OpenCodeV2Event, PluginContextLike, ResolvedModelConfig, SessionMessageLike } from "./types.js";

export type { PluginContextLike };

export interface ObserverDeps {
  config: AdvisorConfig;
  watchdog: ResolvedModelConfig;
}

function isDiagnosticEvent(type: string): boolean {
  return type.toLowerCase().includes("diagnostic");
}

function extractDiagnostics(event: OpenCodeV2Event): string[] {
  const data = event.data ?? {};
  const list: string[] = [];

  const push = (value: unknown): void => {
    if (typeof value === "string" && value.trim()) {
      list.push(value.trim());
      return;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const file = typeof obj["file"] === "string" ? obj["file"] : typeof obj["uri"] === "string" ? obj["uri"] : "";
      const message =
        typeof obj["message"] === "string"
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
    if (Array.isArray(value)) value.forEach(push);
  }
  if (typeof data["diagnostic"] === "string") push(data["diagnostic"]);

  return list;
}

export function extractSessionID(event: OpenCodeV2Event): string {
  const candidate =
    (event.durable?.aggregateID as string) ||
    (event.data?.["sessionID"] as string) ||
    (event.data?.["id"] as string) ||
    ((event as unknown as Record<string, unknown>)["sessionID"] as string) ||
    "";
  if (typeof candidate === "string" && candidate.startsWith("ses")) {
    return candidate;
  }
  return "";
}

export function startEventObserver(ctx: PluginContextLike, deps: ObserverDeps, rootSignal: AbortSignal): void {
  const { config, watchdog } = deps;
  const reviewInterval = Math.max(1, config.reviewInterval ?? 1);
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function scheduleReview(sessionID: string, workspaceDir: string): Promise<void> {
    const state = getOrCreateSessionState(sessionID, workspaceDir);
    if (state.isReviewing) return;

    const existing = debounceTimers.get(sessionID);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      debounceTimers.delete(sessionID);
      if (rootSignal.aborted || state.isReviewing) return;

      // reviewInterval: review every Nth eligible update. Skipped deltas are held
      // (the cursor is not advanced) and merged into the next review.
      state.eligibleUpdates += 1;
      if (state.eligibleUpdates % reviewInterval !== 0) return;

      state.isReviewing = true;
      const reviewAbort = new AbortController();
      state.abortController = reviewAbort;

      const timeout = setTimeout(() => reviewAbort.abort(), watchdog.timeoutMs);

      try {
        const raw = await ctx.session.context({ sessionID });
        const messages = Array.isArray(raw)
          ? raw
          : ((raw as { data?: SessionMessageLike[] })?.data || []);
        if (!messages || messages.length === 0) return;

        const signals = await collectDeterministicSignals(ctx, state, reviewAbort.signal);

        const { deltaText, newLastID, hasMeaningfulWork } = extractSessionDelta(
          messages as RawMessage[],
          state.lastEvaluatedMessageID,
          state.rollingSummary,
          state.seenHashes,
          signals
        );

        if (!hasMeaningfulWork || !deltaText.trim()) {
          state.lastEvaluatedMessageID = newLastID;
          return;
        }

        console.log(`[advisor] Reviewing delta for session ${sessionID} (${deltaText.length} chars)...`);

        const rawNotes = await runReviewerAgent(
          deltaText,
          workspaceDir || ctx.location?.directory || process.cwd(),
          watchdog,
          config.requireEvidence !== false,
          reviewAbort.signal
        );

        const guardedNotes = filterAndGuardNotes(rawNotes, state, {
          maxNotes: config.maxNotesPerUpdate ?? 3,
          requireEvidence: config.requireEvidence !== false,
        });

        if (guardedNotes.length > 0) {
          console.log(`[advisor] Delivering ${guardedNotes.length} notes to session ${sessionID}.`);
          await deliverNotes(guardedNotes, sessionID, state, config, ctx);
        } else {
          // All clear: remove any lingering advisor context instructions
          await removeAdvisorInstruction(sessionID);
        }

        state.lastEvaluatedMessageID = newLastID;
      } catch (err: unknown) {
        if (!reviewAbort.signal.aborted) {
          console.error(`[advisor] Error in review loop:`, err);
        }
      } finally {
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
        if (rootSignal.aborted) break;

        const sessionID = extractSessionID(event);
        if (!sessionID) continue;

        const eventDir = event.location?.directory || ctx.location?.directory || process.cwd();

        // Deterministic signals: capture LSP diagnostics as they stream.
        if (isDiagnosticEvent(event.type)) {
          const diagnostics = extractDiagnostics(event);
          if (diagnostics.length > 0) recordDiagnostics(sessionID, diagnostics);
        }

        // Genuine user input resets the circuit breaker.
        if (
          event.type === "session.inbox.enqueued" ||
          event.type === "session.prompt" ||
          event.type === "session.message.content.updated"
        ) {
          const payloadMeta = (
            (event.data?.["item"] as Record<string, unknown> | undefined)?.["payload"] as
              | Record<string, unknown>
              | undefined
          )?.["metadata"] as Record<string, unknown> | undefined;
          const meta = (event.data?.["metadata"] as Record<string, unknown> | undefined) || payloadMeta;
          if (!meta || meta["advisor"] !== true) {
            resetConsecutiveAdvisorTurns(sessionID);
          }
        }

        // Turn completion triggers a (debounced, interval-gated) review.
        if (
          event.type === "session.step.ended" ||
          event.type === "session.execution.succeeded" ||
          event.type === "session.idle"
        ) {
          await scheduleReview(sessionID, eventDir);
        }
      }
    } catch (err: unknown) {
      if (!rootSignal.aborted) {
        console.warn(
          `[advisor] event stream disconnected:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  })();
}
