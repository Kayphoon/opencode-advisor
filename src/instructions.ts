import { execFile } from "node:child_process";

/**
 * Attach or update an advisor instruction entry in the target session.
 * OpenCode V2 announces instruction entries as updates at step boundaries
 * (<context key="advisor">...</context>) WITHOUT triggering a fake user prompt
 * or waking a redundant assistant response turn.
 */
export function putAdvisorInstruction(sessionID: string, text: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      "opencode",
      [
        "api",
        "put",
        `/api/experimental/session/${sessionID}/instructions/entries/advisor`,
        "--data",
        JSON.stringify({ value: text }),
      ],
      (err) => {
        if (err) {
          console.warn("[advisor] failed to put instruction entry:", err.message);
        }
        resolve();
      }
    );
  });
}

/**
 * Remove the advisor instruction entry when all issues are resolved.
 */
export function removeAdvisorInstruction(sessionID: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      "opencode",
      [
        "api",
        "delete",
        `/api/experimental/session/${sessionID}/instructions/entries/advisor`,
      ],
      () => resolve()
    );
  });
}
