/** Strip a `provider/` prefix from a model slug. */
export function resolveModelName(slug) {
    const parts = slug.split("/");
    return parts.length > 1 ? parts.slice(1).join("/") : slug;
}
export function normalizeBaseURL(provider, fallback) {
    return (provider?.baseURL || fallback).replace(/\/+$/, "");
}
/**
 * One OpenAI-compatible chat completion. Never throws for transport/HTTP errors —
 * returns `{ message: null, error }` so callers can fail open without blocking.
 */
export async function callChatCompletion(options) {
    const { baseURL, apiKey, modelName, messages, tools, temperature, maxTokens, signal } = options;
    const payload = {
        model: modelName,
        messages,
        temperature: temperature ?? 0.1,
    };
    if (typeof maxTokens === "number" && maxTokens > 0) {
        payload["max_tokens"] = maxTokens;
    }
    if (tools && tools.length > 0) {
        payload["tools"] = tools;
        payload["tool_choice"] = "auto";
    }
    let response;
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
    }
    catch (err) {
        return { message: null, error: `fetch error: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        return { message: null, error: `HTTP ${response.status}: ${errText.slice(0, 200)}` };
    }
    try {
        const json = (await response.json());
        const message = json?.choices?.[0]?.message ?? null;
        if (message && !message.content && message.reasoning_content) {
            message.content = message.reasoning_content;
        }
        return { message };
    }
    catch {
        return { message: null, error: "invalid JSON response" };
    }
}
//# sourceMappingURL=llm.js.map