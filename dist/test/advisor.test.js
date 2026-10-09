import test from "node:test";
import assert from "node:assert/strict";
import { resolveSafePath } from "../tools/safe-fs.js";
import { extractSessionDelta } from "../transcript.js";
import { filterAndGuardNotes } from "../guard.js";
import { deliverNotes } from "../delivery.js";
test("resolveSafePath should prevent directory traversal and symlink escape", () => {
    const ws = "/root/oc_plugin";
    const valid = resolveSafePath(ws, "src/index.ts");
    assert.equal(valid.startsWith(ws), true);
    assert.throws(() => {
        resolveSafePath(ws, "../../../etc/passwd");
    }, /escapes workspace/);
});
test("extractSessionDelta should filter out advisor's own injected messages", () => {
    const messages = [
        { id: "msg_1", type: "user", text: "Fix the build issue" },
        { id: "msg_2", type: "assistant", text: "I ran tests and saw a bug" },
        {
            id: "msg_3",
            type: "synthetic",
            text: "[advisor:nit] Check semicolon",
            metadata: { advisor: true },
        },
        { id: "msg_4", type: "assistant", text: "Fixed the typo in app.ts" },
    ];
    const delta = extractSessionDelta(messages, "msg_1", "", []);
    assert.equal(delta.hasMeaningfulWork, true);
    assert.equal(delta.deltaText.includes("[advisor:nit] Check semicolon"), false);
    assert.equal(delta.deltaText.includes("Fixed the typo in app.ts"), true);
});
test("filterAndGuardNotes should suppress content-free phrases and deduplicate", () => {
    const state = {
        sessionID: "ses_test",
        workspaceDir: "/root/oc_plugin",
        lastEvaluatedMessageID: null,
        consecutiveAdvisorTurns: 0,
        userTurnCount: 1,
        immuneUntilUserTurn: 0,
        seenHashes: [],
        rollingSummary: "",
        isReviewing: false,
        abortController: null,
    };
    const rawNotes = [
        { note: "LGTM!", severity: "nit" },
        { note: "Done.", severity: "nit" },
        { note: "Potential SQL injection vulnerability in query builder", severity: "blocker" },
        { note: "Potential SQL injection vulnerability in query builder", severity: "blocker" },
    ];
    const filtered = filterAndGuardNotes(rawNotes, state, 3);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].severity, "blocker");
});
test("deliverNotes should trip circuit breaker and suppress waking on consecutive blocker", async () => {
    const state = {
        sessionID: "ses_test",
        workspaceDir: "/root/oc_plugin",
        lastEvaluatedMessageID: null,
        consecutiveAdvisorTurns: 1, // already woke once
        userTurnCount: 1,
        immuneUntilUserTurn: 0,
        seenHashes: [],
        rollingSummary: "",
        isReviewing: false,
        abortController: null,
    };
    let syntheticCalled = false;
    let promptCalled = false;
    const mockClient = {
        session: {
            synthetic: async () => {
                syntheticCalled = true;
            },
            prompt: async () => {
                promptCalled = true;
            },
        },
    };
    await deliverNotes([{ note: "Critical memory leak", severity: "blocker" }], "ses_test", state, { model: "deepseek/deepseek-flash" }, mockClient);
    assert.equal(syntheticCalled, true);
    assert.equal(promptCalled, false); // Waking prompt must be blocked by circuit breaker
});
//# sourceMappingURL=advisor.test.js.map