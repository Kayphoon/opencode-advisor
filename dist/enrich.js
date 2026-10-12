function parseDiffEntries(result) {
    if (!result || typeof result !== "object")
        return [];
    const data = result.data;
    if (!Array.isArray(data))
        return [];
    const entries = [];
    for (const raw of data) {
        if (!raw || typeof raw !== "object")
            continue;
        const obj = raw;
        const file = typeof obj["file"] === "string" ? obj["file"] : "";
        if (!file)
            continue;
        entries.push({
            file,
            additions: typeof obj["additions"] === "number" ? obj["additions"] : 0,
            deletions: typeof obj["deletions"] === "number" ? obj["deletions"] : 0,
            status: typeof obj["status"] === "string" ? obj["status"] : "modified",
        });
    }
    return entries;
}
/**
 * Deterministic enrichment: facts obtained without the model.
 * Cheaper, faster, and hallucination-proof compared to agentic retrieval.
 */
export async function collectDeterministicSignals(ctx, state, signal) {
    const sections = [];
    // 1. Working-tree diff stat (which files changed, how much)
    try {
        const diffFn = ctx.vcs?.diff;
        if (typeof diffFn === "function" && !signal.aborted) {
            const result = await diffFn({ mode: "working", context: 3 });
            const entries = parseDiffEntries(result);
            if (entries.length > 0) {
                const lines = entries
                    .slice(0, 30)
                    .map((e) => `- ${e.status} ${e.file} (+${e.additions}/-${e.deletions})`);
                sections.push(`### Working-tree changes (${entries.length} files):\n${lines.join("\n")}`);
            }
        }
    }
    catch {
        // Enrichment is best-effort; never block the review.
    }
    // 2. Latest LSP diagnostics observed for this session
    if (state.diagnostics.length > 0) {
        sections.push(`### Compiler / LSP diagnostics (verified facts):\n${state.diagnostics.slice(-20).join("\n")}`);
    }
    if (sections.length === 0)
        return "";
    return `## Deterministic signals (obtained without guessing)\n\n${sections.join("\n\n")}\n\n`;
}
//# sourceMappingURL=enrich.js.map