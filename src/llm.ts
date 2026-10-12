import type { AdvisorProviderConfig } from "./types.js";

export interface ChatMessage {
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

export interface ChatCompletionOptions {
  baseURL: string;
  apiKey: string;
  modelName: string;
  messages: ChatMessage[];
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  temperature?: number;
  maxTokens?: number;
  signal: AbortSignal;
}

export interface ChatCompletionResult {
  message: ChatMessage | null;
  error?: string;
}

/** Strip a `provider/` prefix from a model slug. */
export function resolveModelName(slug: string): string {
  const parts = slug.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : slug;
}

export function normalizeBaseURL(provider: AdvisorProviderConfig | undefined, fallback: string): string {
  return (provider?.baseURL || fallback).replace(/\/+$/, "");
}

/**
 * One OpenAI-compatible chat completion. Never throws for transport/HTTP errors —
 * returns `{ message: null, error }` so callers can fail open without blocking.
 */
export async function callChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const { baseURL, apiKey, modelName, messages, tools, temperature, maxTokens, signal } = options;

  const payload: Record<string, unknown> = {
    model: modelName,
    messages,
    temperature: temperature ?? 0.1,
    max_tokens: maxTokens ?? 768,
  };
  if (tools && tools.length > 0) {
    payload["tools"] = tools;
    payload["tool_choice"] = "auto";
  }

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
    return { message: null, error: `fetch error: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    return { message: null, error: `HTTP ${response.status}: ${errText.slice(0, 200)}` };
  }

  try {
    const json = (await response.json()) as { choices?: Array<{ message?: ChatMessage }> };
    const message = json?.choices?.[0]?.message ?? null;
    return { message };
  } catch {
    return { message: null, error: "invalid JSON response" };
  }
}
