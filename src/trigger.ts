import { getOrCreateSessionState, resetConsecutiveAdvisorTurns } from "./state.js";
import { extractSessionDelta, type RawMessage } from "./transcript.js";
import { runReviewerAgent } from "./reviewer.js";
import { filterAndGuardNotes } from "./guard.js";
import { deliverNotes, type SessionClientLike } from "./delivery.js";
import type { AdvisorConfig, OpenCodeV2Event } from "./types.js";

export interface PluginContextLike extends SessionClientLike {
  event: {
    subscribe: (options?: { signal?: AbortSignal }) => AsyncIterable<OpenCodeV2Event>;
  };
  location: {
    directory: string;
  };
  session: {
    context: (input: { sessionID: string }) => Promise<RawMessage[]>;
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

export function startEventObserver(ctx: PluginContextLike, config: AdvisorConfig, rootSignal: AbortSignal): void {
  const debounceTimers = new Map<string, NodeJS.Timeout>();

  async function scheduleReview(sessionID: string, workspaceDir: string): Promise<void> {
    const state = getOrCreateSessionState(sessionID, workspaceDir);
    if (state.isReviewing) return;

    // Clear existing timer
    const existing = debounceTimers.get(sessionID);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      debounceTimers.delete(sessionID);
      if (rootSignal.aborted || state.isReviewing) return;

      state.isReviewing = true;
      const reviewAbort = new AbortController();
      state.abortController = reviewAbort;

      const timeout = setTimeout(() => {
        reviewAbort.abort();
      }, config.timeoutMs || 25000);

      try {
        // 1. Fetch messages
        const messages = await ctx.session.context({ sessionID });
        if (!messages || messages.length === 0) return;

        // 2. Extract delta
        const { deltaText, newLastID, hasMeaningfulWork } = extractSessionDelta(
          messages,
          state.lastEvaluatedMessageID,
          state.rollingSummary,
          state.seenHashes
        );

        if (!hasMeaningfulWork || !deltaText.trim()) {
          state.lastEvaluatedMessageID = newLastID;
          return;
        }

        console.log(`[advisor] Reviewing delta for session ${sessionID} (${deltaText.length} chars)...`);

        // 3. Run Reviewer Agent
        const rawNotes = await runReviewerAgent(
          deltaText,
          workspaceDir || ctx.location.directory,
          config,
          reviewAbort.signal
        );

        // 4. Guard & Deduplicate
        const guardedNotes = filterAndGuardNotes(
          rawNotes,
          state,
          config.maxNotesPerUpdate || 3
        );

        // 5. Deliver
        if (guardedNotes.length > 0) {
          console.log(`[advisor] Delivering ${guardedNotes.length} notes to session ${sessionID}.`);
          await deliverNotes(guardedNotes, sessionID, state, config, ctx);
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

        const sessionID =
          (event.data?.["sessionID"] as string) ||
          (event.data?.["id"] as string) ||
          "";

        if (!sessionID || !sessionID.startsWith("ses")) continue;

        // Check workspace directory match
        const eventDir = event.location?.directory || ctx.location.directory;
        if (ctx.location.directory && eventDir !== ctx.location.directory) {
          continue;
        }

        // 1. If genuine user input admitted, reset consecutive advisor turns counter
        if (
          event.type === "session.inbox.enqueued" ||
          event.type === "session.prompt" ||
          event.type === "session.message.content.updated"
        ) {
          const meta = event.data?.["metadata"] as Record<string, unknown> | undefined;
          if (!meta || meta["advisor"] !== true) {
            resetConsecutiveAdvisorTurns(sessionID);
          }
        }

        // 2. Turn completion triggers
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
        console.warn(`[advisor] event stream disconnected:`, err instanceof Error ? err.message : String(err));
      }
    }
  })();
}
