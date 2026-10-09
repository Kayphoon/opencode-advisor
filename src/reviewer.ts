import { readTool } from "./tools/read.js";
import { grepTool } from "./tools/grep.js";
import { globTool } from "./tools/glob.js";
import { createAdviseTool } from "./tools/advise.js";
import type { AdviceNote, AdvisorConfig, ToolDefinition } from "./types.js";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export async function runReviewerAgent(
  transcriptDelta: string,
  workspaceDir: string,
  config: AdvisorConfig,
  signal: AbortSignal
): Promise<AdviceNote[]> {
  const collectedNotes: AdviceNote[] = [];
  const adviseTool = createAdviseTool(collectedNotes);

  const activeTools: ToolDefinition[] = [adviseTool];
  const allowedToolNames = new Set(config.tools || ["read", "grep", "glob"]);

  if (allowedToolNames.has("read")) activeTools.push(readTool);
  if (allowedToolNames.has("grep")) activeTools.push(grepTool);
  if (allowedToolNames.has("glob")) activeTools.push(globTool);

  const toolMap = new Map<string, ToolDefinition>();
  for (const t of activeTools) {
    toolMap.set(t.name, t);
  }

  // Format tools for OpenAI Chat Completions
  const openAiTools = activeTools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const baseURL = (config.provider?.baseURL || "http://127.0.0.1:8084/v1").replace(/\/+$/, "");
  const apiKey = config.provider?.apiKey || "default-key";
  const modelName = config.model.includes("/") ? config.model.split("/")[1] : config.model;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: config.systemPrompt || "You are an autonomous Watchdog Advisor. Review code and submit advice via advise tool.",
    },
    {
      role: "user",
      content: transcriptDelta,
    },
  ];

  const maxSteps = Math.min(5, Math.max(1, config.maxToolSteps || 3));

  for (let step = 0; step < maxSteps; step++) {
    if (signal.aborted) break;

    const payload = {
      model: modelName,
      messages,
      tools: openAiTools,
      tool_choice: "auto",
      temperature: 0.1,
      max_tokens: 768,
    };

    let response: Response;
    try {
      response = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err: unknown) {
      console.warn("[advisor] fetch error:", err instanceof Error ? err.message : String(err));
      break;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[advisor] HTTP error ${response.status}: ${errText.slice(0, 200)}`);
      break;
    }

    let json: any;
    try {
      json = await response.json();
    } catch {
      break;
    }

    const choice = json?.choices?.[0];
    const assistantMsg = choice?.message;
    if (!assistantMsg) break;

    messages.push(assistantMsg);

    // If no tool calls, model concluded its thoughts
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      break;
    }

    let hasAdviseCall = false;

    // Execute each tool call
    for (const toolCall of assistantMsg.tool_calls) {
      const fnName = toolCall.function?.name;
      const fnArgsRaw = toolCall.function?.arguments || "{}";
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(fnArgsRaw);
      } catch {
        parsedArgs = {};
      }

      if (fnName === "advise") {
        hasAdviseCall = true;
      }

      const toolDef = toolMap.get(fnName);
      let toolOutput = "";
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
        content: toolOutput.slice(0, 4000), // Bounded tool output
      });
    }

    // In OMP watchdog, after emitting advise, review terminates
    if (hasAdviseCall) {
      break;
    }
  }

  return collectedNotes;
}
