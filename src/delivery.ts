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
export function formatNote(item: AdviceNote): string {
  let text = `[advisor:${item.severity}] ${item.note}`;
  if (item.evidence) {
    const loc = item.evidence.line ? `${item.evidence.file}:${item.evidence.line}` : item.evidence.file;
    text += `\n  evidence: ${loc} — ${item.evidence.observedFact}`;
  }
  if (item.suggestedPatch) {
    text += `\n  suggested fix:\n${item.suggestedPatch}`;
  }
  return text;
}

export async function deliverNotes(
  notes: AdviceNote[],
  sessionID: string,
  state: AdvisorSessionState,
  config: AdvisorConfig,
  client: SessionClientLike
): Promise<void> {
  for (const item of notes) {
    const formattedText = formatNote(item);

    if (item.severity === "blocker") {
      // HARD CIRCUIT BREAKER: at most one waking interrupt per user turn.
      if (state.consecutiveAdvisorTurns >= 1) {
        console.warn(
          `[advisor] Circuit breaker tripped for session ${sessionID}. Degrading blocker to non-waking synthetic.`
        );
        await client.session.synthetic({
          sessionID,
          text: `${formattedText}\n  (auto-wake suppressed by circuit breaker until the next user message)`,
          metadata: { advisor: true, severity: "blocker", degraded: true },
          resume: false,
          delivery: "queue",
        });
        continue;
      }

      try {
        await client.session.prompt({
          sessionID,
          text: formattedText,
          metadata: { advisor: true, severity: "blocker" },
          delivery: "steer",
          resume: true,
        });
        state.consecutiveAdvisorTurns += 1;
        state.immuneUntilUserTurn = state.userTurnCount + (config.immuneTurns ?? 3);
        console.log(`[advisor] Waking blocker delivered to ${sessionID}.`);
      } catch (err: unknown) {
        console.error(`[advisor] Failed to deliver waking prompt:`, err);
      }
    } else {
      try {
        await client.session.synthetic({
          sessionID,
          text: formattedText,
          metadata: { advisor: true, severity: item.severity },
          resume: false,
          delivery: "steer",
        });
        console.log(`[advisor] Non-waking ${item.severity} delivered to ${sessionID}.`);
      } catch (err: unknown) {
        console.error(`[advisor] Failed to deliver synthetic message:`, err);
      }
    }
  }
}

export type { SessionMessageLike };
