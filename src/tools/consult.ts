import type {
  NativeToolDefinition,
  ResolvedModelConfig,
  SessionMessageLike,
} from "../types.js";
import { callChatCompletion, normalizeBaseURL, type ChatMessage } from "../llm.js";
import { DEFAULT_BASE_URL } from "../config.js";
import { truncateToolOutput } from "../transcript.js";

export interface ConsultDeps {
  consult: ResolvedModelConfig;
  /** Fetch recent session messages for context. */
  getContextMessages: (sessionID: string) => Promise<SessionMessageLike[]>;
  /** How many recent messages to attach. 0 disables context attachment. */
  includeContextMessages: number;
}

function renderContext(messages: SessionMessageLike[], limit: number): string {
  if (limit <= 0) return "";
  const recent = messages.slice(-limit);
  const parts: string[] = [];
  for (const msg of recent) {
    if (msg.metadata?.["advisor"] === true) continue;
    const role = (msg.type || "message").toUpperCase();
    let body = msg.text || "";
    const items = (msg.content || msg.parts || []) as Array<Record<string, unknown>>;
    if (items.length > 0) {
      const sub: string[] = [];
      for (const p of items) {
        if ((p.metadata as Record<string, unknown>)?.["advisor"] === true) continue;
        if (typeof p["text"] === "string" && p["text"]) sub.push(p["text"]);
        if (p["type"] === "tool" || p["name"]) {
          const toolName = p["name"] || p["type"];
          const state = p["state"] as Record<string, unknown> | undefined;
          let outputText = "";
          if (Array.isArray(state?.["content"])) {
            outputText = (state["content"] as Array<Record<string, unknown>>)
              .map((c) => String(c["text"] || ""))
              .join("\n");
          } else if (typeof p["output"] === "string") {
            outputText = p["output"];
          }
          sub.push(`[Tool ${toolName} Output]:\n${truncateToolOutput(outputText, 12, 4)}`);
        } else if (typeof p["output"] === "string") {
          sub.push(`[Tool Output]:\n${truncateToolOutput(p["output"], 12, 4)}`);
        }
      }
      if (sub.length > 0) body = sub.join("\n");
    }
    if (body.trim()) parts.push(`**${role}**:\n${body}`);
  }
  return parts.join("\n\n");
}

/**
 * Intrinsic consultation tool (Claude Code "advisor tool" pattern).
 *
 * Registered with OpenCode so the *primary agent* can request guidance from a
 * stronger model at decision points — before committing to an approach, when
 * stuck on a recurring error, or before declaring a task done.
 */
export function createConsultTool(deps: ConsultDeps): NativeToolDefinition {
  const { consult, getContextMessages, includeContextMessages } = deps;

  return {
    name: "consult_advisor",
    description:
      "Escalate a hard decision to a stronger advisor model. Use before committing to a " +
      "significant approach, when stuck on a recurring error, or before declaring a task " +
      "complete. Returns concrete guidance. Advisory only — you decide what to apply.",
    input: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The specific decision or problem you want guidance on.",
        },
        context: {
          type: "string",
          description: "Optional extra context (files, constraints, what you already tried).",
        },
      },
      required: ["question"],
    },
    async execute(input, context) {
      const question = String(input["question"] || "").trim();
      if (!question) {
        return { content: "Error: question is required." };
      }
      const extra = String(input["context"] || "").trim();

      const baseURL = normalizeBaseURL(consult.provider, DEFAULT_BASE_URL);
      const apiKey = consult.provider.apiKey || "default-key";

      let renderedContext = "";
      try {
        const raw = await getContextMessages(context.sessionID);
        const messages = Array.isArray(raw)
          ? raw
          : ((raw as unknown as { data?: SessionMessageLike[] })?.data || []);
        renderedContext = renderContext(messages, includeContextMessages);
      } catch {
        renderedContext = "";
      }

      const userParts = [`## Decision\n${question}`];
      if (extra) userParts.push(`## Additional context\n${extra}`);
      if (renderedContext) userParts.push(`## Recent session context\n${renderedContext}`);

      const messages: ChatMessage[] = [
        { role: "system", content: consult.systemPrompt },
        { role: "user", content: userParts.join("\n\n") },
      ];

      const { message, error } = await callChatCompletion({
        baseURL,
        apiKey,
        modelName: consult.modelName,
        messages,
        temperature: consult.temperature,
        maxTokens: consult.maxTokens,
        signal: context.signal,
      });

      if (error || !message?.content) {
        return {
          content: `Advisor unavailable (${error ?? "empty response"}). Proceed using your own judgment.`,
        };
      }

      return { content: message.content };
    },
  };
}
