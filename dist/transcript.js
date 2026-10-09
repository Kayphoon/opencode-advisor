export function truncateToolOutput(text, headLines = 30, tailLines = 10) {
    const lines = text.split(/\r?\n/);
    if (lines.length <= headLines + tailLines + 5) {
        return text;
    }
    const head = lines.slice(0, headLines);
    const tail = lines.slice(-tailLines);
    const omitted = lines.length - headLines - tailLines;
    return `${head.join("\n")}\n... [${omitted} lines of output truncated for review] ...\n${tail.join("\n")}`;
}
export function extractSessionDelta(allMessages, lastEvaluatedID, rollingSummary, recentNotes) {
    if (!allMessages || allMessages.length === 0) {
        return { deltaText: "", newLastID: null, hasMeaningfulWork: false };
    }
    // Find cursor index
    let startIndex = 0;
    if (lastEvaluatedID) {
        const idx = allMessages.findIndex((m) => m.id === lastEvaluatedID);
        if (idx !== -1) {
            startIndex = idx + 1;
        }
    }
    const deltaMessages = allMessages.slice(startIndex);
    if (deltaMessages.length === 0) {
        return { deltaText: "", newLastID: lastEvaluatedID, hasMeaningfulWork: false };
    }
    const newLastID = deltaMessages[deltaMessages.length - 1].id;
    // Extract Goal Header (very first user message in full history)
    let goalHeader = "";
    const firstUser = allMessages.find((m) => m.type === "user" || (!m.type && m.text));
    if (firstUser && firstUser.text) {
        goalHeader = `### Initial Session Goal:\n${firstUser.text.slice(0, 1000)}\n\n`;
    }
    // Format delta
    const formattedParts = [];
    let meaningfulAssistantText = false;
    for (const msg of deltaMessages) {
        // 1. Filter out advisor's own injected messages (Self-review guard)
        if (msg.metadata?.["advisor"] === true) {
            continue;
        }
        const role = msg.type || "message";
        const body = msg.text || "";
        if (role === "assistant" || role === "shell") {
            meaningfulAssistantText = true;
        }
        let renderedText = body;
        if (msg.parts && msg.parts.length > 0) {
            const partTexts = [];
            for (const p of msg.parts) {
                if (p.metadata?.["advisor"] === true)
                    continue;
                if (p.text)
                    partTexts.push(p.text);
                if (p.output) {
                    partTexts.push(`[Tool Output]:\n${truncateToolOutput(p.output)}`);
                }
            }
            if (partTexts.length > 0) {
                renderedText = partTexts.join("\n");
            }
        }
        if (renderedText.trim()) {
            formattedParts.push(`**${role.toUpperCase()}**:\n${renderedText}`);
        }
    }
    if (formattedParts.length === 0) {
        return { deltaText: "", newLastID, hasMeaningfulWork: false };
    }
    let finalTranscript = goalHeader;
    if (rollingSummary.trim()) {
        finalTranscript += `### Story So Far (Summary):\n${rollingSummary}\n\n`;
    }
    if (recentNotes.length > 0) {
        finalTranscript += `### Previously Raised Advice (Do NOT repeat these):\n${recentNotes.map((n) => `- ${n}`).join("\n")}\n\n`;
    }
    finalTranscript += `### Current Turn Transcript Delta:\n${formattedParts.join("\n\n")}`;
    return {
        deltaText: finalTranscript,
        newLastID,
        hasMeaningfulWork: meaningfulAssistantText,
    };
}
//# sourceMappingURL=transcript.js.map