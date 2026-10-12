import { readTool } from "./tools/read.js";
import { grepTool } from "./tools/grep.js";
import { globTool } from "./tools/glob.js";
import { createAdviseTool } from "./tools/advise.js";
import { callChatCompletion, normalizeBaseURL } from "./llm.js";
import { DEFAULT_BASE_URL } from "./config.js";
const TOOL_REGISTRY = {
    read: readTool,
    grep: grepTool,
    glob: globTool,
};
/**
 * Run one reviewer pass: an independent, tool-using model loop over the delta.
 * Emits at most one batch of `advise` notes; terminates as soon as advise fires.
 */
export async function runReviewerAgent(transcriptDelta, workspaceDir, watchdog, requireEvidence, signal) {
    const collectedNotes = [];
    const adviseTool = createAdviseTool(collectedNotes, requireEvidence);
    const activeTools = [adviseTool];
    for (const name of watchdog.tools) {
        const tool = TOOL_REGISTRY[name];
        if (tool)
            activeTools.push(tool);
    }
    const toolMap = new Map();
    for (const t of activeTools)
        toolMap.set(t.name, t);
    const openAiTools = activeTools.map((t) => ({
        type: "function",
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        },
    }));
    const baseURL = normalizeBaseURL(watchdog.provider, DEFAULT_BASE_URL);
    const apiKey = watchdog.provider.apiKey || "default-key";
    const messages = [
        { role: "system", content: watchdog.systemPrompt },
        { role: "user", content: transcriptDelta },
    ];
    for (let step = 0; step < watchdog.maxToolSteps; step++) {
        if (signal.aborted)
            break;
        const { message, error } = await callChatCompletion({
            baseURL,
            apiKey,
            modelName: watchdog.modelName,
            messages,
            tools: openAiTools,
            temperature: watchdog.temperature,
            maxTokens: watchdog.maxTokens,
            signal,
        });
        if (error) {
            console.warn(`[advisor] watchdog model error: ${error}`);
            break;
        }
        if (!message)
            break;
        messages.push(message);
        if (!message.tool_calls || message.tool_calls.length === 0)
            break;
        let hasAdviseCall = false;
        for (const toolCall of message.tool_calls) {
            const fnName = toolCall.function?.name;
            let parsedArgs = {};
            try {
                parsedArgs = JSON.parse(toolCall.function?.arguments || "{}");
            }
            catch {
                parsedArgs = {};
            }
            if (fnName === "advise")
                hasAdviseCall = true;
            const toolDef = toolMap.get(fnName);
            let toolOutput;
            if (toolDef) {
                try {
                    toolOutput = await toolDef.execute(parsedArgs, { workspaceDir, signal });
                }
                catch (execErr) {
                    toolOutput = `Error: ${execErr instanceof Error ? execErr.message : String(execErr)}`;
                }
            }
            else {
                toolOutput = `Error: Tool '${fnName}' not available.`;
            }
            messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: fnName,
                content: toolOutput.slice(0, 4000),
            });
        }
        // After the reviewer emits advice, its job is done for this turn.
        if (hasAdviseCall)
            break;
    }
    return collectedNotes;
}
//# sourceMappingURL=reviewer.js.map