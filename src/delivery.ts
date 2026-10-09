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

export async function deliverNotes(
  notes: AdviceNote[],
  sessionID: string,
  state: AdvisorSessionState,
  config: AdvisorConfig,
  client: SessionClientLike
): Promise<void> {
  for (const item of notes) {
    const formattedText = `[advisor:${item.severity}] ${item.note}`;

    if (item.severity === "blocker") {
      // 1. HARD CIRCUIT BREAKER
      // If advisor already woke the session once in this user turn, MUST NOT wake again
      if (state.consecutiveAdvisorTurns >= 1) {
        console.warn(`[advisor] Circuit breaker tripped for session ${sessionID}. Degrading blocker to non-waking synthetic.`);
        await client.session.synthetic({
          sessionID,
          text: `${formattedText} (Notice: auto-wake suppressed by circuit breaker until next user message)`,
          metadata: { advisor: true, severity: "blocker", degraded: true },
          resume: false,
          delivery: "queue",
        });
        continue;
      }

      // Waking steer delivery
      try {
        await client.session.prompt({
          sessionID,
          text: formattedText,
          metadata: { advisor: true, severity: "blocker" },
          delivery: "steer",
          resume: true,
        });

        state.consecutiveAdvisorTurns += 1;
        state.immuneUntilUserTurn = state.userTurnCount + (config.immuneTurns || 3);
        console.log(`[advisor] Waking blocker delivered to ${sessionID}.`);
      } catch (err: unknown) {
        console.error(`[advisor] Failed to deliver waking prompt:`, err);
      }
    } else {
      // 2. Non-waking synthetic delivery (nit & concern)
      try {
        await client.session.synthetic({
          sessionID,
          text: formattedText,
          metadata: { advisor: true, severity: item.severity },
          resume: false,
          delivery: "queue",
        });
        console.log(`[advisor] Non-waking ${item.severity} delivered to ${sessionID}.`);
      } catch (err: unknown) {
        console.error(`[advisor] Failed to deliver synthetic message:`, err);
      }
    }
  }
}
