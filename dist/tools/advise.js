function parseEvidence(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const obj = raw;
    const file = typeof obj["file"] === "string" ? obj["file"].trim() : "";
    const observedFact = typeof obj["observedFact"] === "string" ? obj["observedFact"].trim() : "";
    if (!file || !observedFact)
        return undefined;
    const lineRaw = obj["line"];
    const line = typeof lineRaw === "number" && Number.isFinite(lineRaw) ? Math.trunc(lineRaw) : undefined;
    return { file, line, observedFact };
}
/**
 * The reviewer's single emission tool. When `requireEvidence` is on, a `blocker`
 * without cited evidence is rejected with an instruction to verify first — the
 * model gets a chance to self-correct before the guard also downgrades it.
 */
export function createAdviseTool(collectedNotes, requireEvidence) {
    return {
        name: "advise",
        description: "Submit a concrete advisory note. Only use when you have an actionable, verified flaw. " +
            "For concern/blocker you MUST cite evidence you actually read (file, line, observedFact).",
        parameters: {
            type: "object",
            properties: {
                note: {
                    type: "string",
                    description: "One concrete, terse, and actionable piece of advice.",
                },
                severity: {
                    type: "string",
                    description: "Severity: 'nit' (minor), 'concern' (material risk), or 'blocker' (severe flaw).",
                },
                evidence: {
                    type: "object",
                    description: "Verified evidence from the real codebase. Required for concern/blocker. " +
                        "file = workspace-relative path; line = 1-based line; observedFact = what the code actually does.",
                    properties: {
                        file: { type: "string" },
                        line: { type: "number" },
                        observedFact: { type: "string" },
                    },
                    required: ["file", "observedFact"],
                },
                suggestedPatch: {
                    type: "string",
                    description: "Optional minimal fix sketch for the issue.",
                },
            },
            required: ["note"],
        },
        async execute(args) {
            const note = String(args["note"] || "").trim();
            if (!note)
                return "Error: note cannot be empty";
            let rawSeverity = String(args["severity"] || "nit").toLowerCase();
            if (rawSeverity !== "nit" && rawSeverity !== "concern" && rawSeverity !== "blocker") {
                rawSeverity = "nit";
            }
            const evidence = parseEvidence(args["evidence"]);
            const suggestedPatchRaw = String(args["suggestedPatch"] || "").trim();
            if (requireEvidence && rawSeverity === "blocker" && !evidence) {
                return ("Rejected: a 'blocker' requires verified evidence. Use read/grep to confirm the issue against the " +
                    "actual code, then call advise again with evidence { file, line?, observedFact }. " +
                    "If you cannot verify it, report it as 'concern' or drop it.");
            }
            collectedNotes.push({
                note,
                severity: rawSeverity,
                evidence,
                suggestedPatch: suggestedPatchRaw || undefined,
            });
            return `Recorded advisory note (${rawSeverity}).`;
        },
    };
}
//# sourceMappingURL=advise.js.map