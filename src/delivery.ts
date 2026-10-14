import type { AdviceNote, AdvisorConfig, AdvisorSessionState, SessionMessageLike } from "./types.js";
import { putAdvisorInstruction, removeAdvisorInstruction } from "./instructions.js";

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

/**
 * Dual-channel delivery:
 * 1. Non-blockers (`nit`, `concern`) are attached via Instruction Entry
 *    (<context key="advisor">...</context>). This injects the advice into the
 *    model's next-step prompt without triggering a fake user message or redundant chat turn.
 * 2. Blockers are delivered as an immediate steer_waking prompt to halt execution and correct course.
 */
export async function deliverNotes(
  notes: AdviceNote[],
  sessionID: string,
  state: AdvisorSessionState,
  config: AdvisorConfig,
  client: SessionClientLike
): Promise<void> {
  const blockers = notes.filter((n) => n.severity === "blocker");
  const nonBlockers = notes.filter((n) => n.severity !== "blocker");

  // 1. Non-blockers -> Instruction Entry (Context Injection)
  if (nonBlockers.length > 0) {
    const instructionBody = nonBlockers.map(formatNote).join("\n\n");
    await putAdvisorInstruction(sessionID, instructionBody);

    // Keep inbox synthetic record for auditing without waking execution
    for (const item of nonBlockers) {
      try {
        await client.session.synthetic({
          sessionID,
          text: formatNote(item),
          metadata: { advisor: true, severity: item.severity },
          resume: false,
          delivery: "queue",
        });
      } catch {
        // best-effort inbox logging
      }
    }
    console.log(`[advisor] Attached ${nonBlockers.length} advisory notes into instructions for ${sessionID}.`);
  } else if (blockers.length === 0) {
    // Clean review with no blockers: clean up instruction entry
    await removeAdvisorInstruction(sessionID);
  }

  // 2. Blockers -> Direct chat message with immediate waking interrupt
  for (const item of blockers) {
    const formattedText = formatNote(item);

    // HARD CIRCUIT BREAKER: at most one waking interrupt per user turn.
    if (state.consecutiveAdvisorTurns >= 1) {
      console.warn(
        `[advisor] Circuit breaker tripped for session ${sessionID}. Degrading blocker to non-waking instruction.`
      );
      await putAdvisorInstruction(
        sessionID,
        `${formattedText}\n(auto-wake suppressed by circuit breaker until next user turn)`
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
  }
}

export type { SessionMessageLike };
