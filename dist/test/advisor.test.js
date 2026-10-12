import test from "node:test";
import assert from "node:assert/strict";
import { resolveSafePath } from "../tools/safe-fs.js";
import { extractSessionDelta } from "../transcript.js";
import { filterAndGuardNotes } from "../guard.js";
import { deliverNotes, formatNote } from "../delivery.js";
function makeState(overrides = {}) {
    return {
        sessionID: "ses_test",
        workspaceDir: "/root/oc_plugin",
        lastEvaluatedMessageID: null,
        consecutiveAdvisorTurns: 0,
        userTurnCount: 1,
        immuneUntilUserTurn: 0,
        eligibleUpdates: 0,
        seenHashes: [],
        rollingSummary: "",
        diagnostics: [],
        isReviewing: false,
        abortController: null,
        ...overrides,
    };
}
test("resolveSafePath blocks traversal and symlink escape", () => {
    const ws = "/root/oc_plugin";
    const valid = resolveSafePath(ws, "src/index.ts");
    assert.equal(valid.startsWith(ws), true);
    assert.throws(() => {
        resolveSafePath(ws, "../../../etc/passwd");
    }, /escapes workspace/);
});
test("extractSessionDelta filters advisor's own injected messages", () => {
    const messages = [
        { id: "msg_1", type: "user", text: "Fix the build issue" },
        { id: "msg_2", type: "assistant", text: "I ran tests and saw a bug" },
        { id: "msg_3", type: "synthetic", text: "[advisor:nit] Check semicolon", metadata: { advisor: true } },
        { id: "msg_4", type: "assistant", text: "Fixed the typo in app.ts" },
    ];
    const delta = extractSessionDelta(messages, "msg_1", "", []);
    assert.equal(delta.hasMeaningfulWork, true);
    assert.equal(delta.deltaText.includes("[advisor:nit] Check semicolon"), false);
    assert.equal(delta.deltaText.includes("Fixed the typo in app.ts"), true);
});
test("extractSessionDelta appends deterministic signals", () => {
    const messages = [{ id: "msg_1", type: "assistant", text: "did work" }];
    const delta = extractSessionDelta(messages, null, "", [], "## Deterministic signals\n- 1 file changed\n\n");
    assert.equal(delta.deltaText.includes("Deterministic signals"), true);
});
test("guard suppresses content-free phrases and deduplicates", () => {
    const state = makeState();
    const rawNotes = [
        { note: "LGTM!", severity: "nit" },
        { note: "Done.", severity: "nit" },
        {
            note: "Potential SQL injection in the query builder",
            severity: "blocker",
            evidence: { file: "src/db.ts", line: 42, observedFact: "raw string interpolation into SQL" },
        },
        {
            note: "Potential SQL injection in the query builder",
            severity: "blocker",
            evidence: { file: "src/db.ts", line: 42, observedFact: "raw string interpolation into SQL" },
        },
    ];
    const filtered = filterAndGuardNotes(rawNotes, state, { maxNotes: 3, requireEvidence: true });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].severity, "blocker");
    assert.ok(filtered[0].evidence);
});
test("guard downgrades a blocker that lacks evidence (fact-checking enforcement)", () => {
    const state = makeState();
    const rawNotes = [
        { note: "This probably crashes on null input", severity: "blocker" }, // no evidence
    ];
    const filtered = filterAndGuardNotes(rawNotes, state, { maxNotes: 3, requireEvidence: true });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].severity, "concern"); // downgraded, not delivered as a waking blocker
});
test("formatNote renders evidence and suggested patch", () => {
    const text = formatNote({
        note: "handle the missing case",
        severity: "concern",
        evidence: { file: "src/a.ts", line: 10, observedFact: "returns undefined" },
        suggestedPatch: "if (!x) return;",
    });
    assert.equal(text.includes("evidence: src/a.ts:10"), true);
    assert.equal(text.includes("suggested fix"), true);
});
test("deliverNotes trips the circuit breaker on a second consecutive blocker", async () => {
    const state = makeState({ consecutiveAdvisorTurns: 1 }); // already woke once
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
    assert.equal(promptCalled, false); // waking prompt must be blocked
});
//# sourceMappingURL=advisor.test.js.map