import { readTool } from "./tools/read.js";
import { grepTool } from "./tools/grep.js";
import { globTool } from "./tools/glob.js";
import { createAdviseTool } from "./tools/advise.js";
import type { AdviceNote, ResolvedModelConfig, ToolDefinition } from "./types.js";
import { callChatCompletion, normalizeBaseURL, type ChatMessage } from "./llm.js";
import { DEFAULT_BASE_URL } from "./config.js";

const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  read: readTool,
  grep: grepTool,
  glob: globTool,
};

/**
 * Run one reviewer pass: an independent, tool-using model loop over the delta.
 * Emits at most one batch of `advise` notes; terminates as soon as advise fires.
 */
export async function runReviewerAgent(
  transcriptDelta: string,
  workspaceDir: string,
  watchdog: ResolvedModelConfig,
  requireEvidence: boolean,
  signal: AbortSignal
): Promise<AdviceNote[]> {
  const collectedNotes: AdviceNote[] = [];
  const adviseTool = createAdviseTool(collectedNotes, requireEvidence);

  const activeTools: ToolDefinition[] = [adviseTool];
  for (const name of watchdog.tools) {
    const tool = TOOL_REGISTRY[name];
    if (tool) activeTools.push(tool);
  }

  const toolMap = new Map<string, ToolDefinition>();
  for (const t of activeTools) toolMap.set(t.name, t);

  const openAiTools = activeTools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const baseURL = normalizeBaseURL(watchdog.provider, DEFAULT_BASE_URL);
  const apiKey = watchdog.provider.apiKey || "default-key";

  const messages: ChatMessage[] = [
    { role: "system", content: watchdog.systemPrompt },
    { role: "user", content: transcriptDelta },
  ];

  for (let step = 0; step < watchdog.maxToolSteps; step++) {
    if (signal.aborted) break;

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
    if (!message) break;

    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) break;

    let hasAdviseCall = false;

    for (const toolCall of message.tool_calls) {
      const fnName = toolCall.function?.name;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(toolCall.function?.arguments || "{}");
      } catch {
        parsedArgs = {};
      }

      if (fnName === "advise") hasAdviseCall = true;

      const toolDef = toolMap.get(fnName);
      let toolOutput: string;
      if (toolDef) {
        try {
          toolOutput = await toolDef.execute(parsedArgs, { workspaceDir, signal });
        } catch (execErr: unknown) {
          toolOutput = `Error: ${execErr instanceof Error ? execErr.message : String(execErr)}`;
        }
      } else {
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
    if (hasAdviseCall) break;
  }

  return collectedNotes;
}
