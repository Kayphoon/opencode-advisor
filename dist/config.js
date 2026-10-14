import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveModelName } from "./llm.js";
const DEFAULT_WATCHDOG_MODEL = "deepseek/deepseek-flash";
const DEFAULT_BASE_URL = "http://127.0.0.1:8084/v1";
export const WATCHDOG_SYSTEM_PROMPT = `You are an autonomous Watchdog Advisor reviewing an ongoing OpenCode programming session.
Your role is strictly to detect architecture flaws, bugs, security vulnerabilities, and violations of user constraints.

FACT-CHECKING IS MANDATORY (whoever asserts must prove):
- Never raise an issue from the diff alone. Before advising, use the read/grep/glob tools to inspect the ACTUAL code.
- If you suspect a null dereference, missing validation, or wrong signature, READ the callee and its call sites to confirm.
- If your suspicion is refuted by the real code, stay silent. Do not report it.

When you find a real, verified issue, call the advise tool with:
- note: one concise, actionable sentence
- severity: nit | concern | blocker
- evidence: { file, line?, observedFact } — required for concern/blocker; cite what you actually read
- suggestedPatch: optional, a minimal fix sketch

If everything looks correct or there is nothing important to say, do NOT call advise.`;
export const CONSULT_SYSTEM_PROMPT = `You are a senior technical advisor consulted by a coding agent at a decision point.
You receive the agent's question plus recent session context.
Give a decisive, concrete recommendation: the recommended path, the key trade-off, and the immediate next step.
Be brief. Prefer specific file/API/approach guidance over generic advice.
If the question is unanswerable without more information, say exactly what is missing.
Do not restate the question. Do not use filler.`;
function tryReadJson(filePath) {
    try {
        if (!existsSync(filePath))
            return null;
        const content = readFileSync(filePath, "utf-8");
        // Strip simple JSONC comments if present
        const stripped = content.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "$1");
        return JSON.parse(stripped);
    }
    catch {
        return null;
    }
}
function resolveProviderFromGlobalOpencode(modelSlug) {
    const home = homedir();
    const candidates = [
        join(home, ".config", "opencode", "opencode.jsonc"),
        join(home, ".config", "opencode", "opencode.json"),
    ];
    for (const file of candidates) {
        const data = tryReadJson(file);
        if (!data)
            continue;
        const providerObj = data["provider"];
        if (!providerObj || typeof providerObj !== "object")
            continue;
        const [providerId] = modelSlug.split("/");
        const target = providerObj[providerId];
        if (target && typeof target === "object") {
            const opts = target["options"];
            if (opts) {
                return {
                    baseURL: typeof opts["baseURL"] === "string" ? opts["baseURL"] : undefined,
                    apiKey: typeof opts["apiKey"] === "string" ? opts["apiKey"] : undefined,
                };
            }
        }
    }
    return {};
}
function mergeProvider(explicit, modelSlug) {
    const auto = resolveProviderFromGlobalOpencode(modelSlug);
    return {
        baseURL: explicit?.baseURL || auto.baseURL,
        apiKey: explicit?.apiKey || auto.apiKey,
    };
}
/** Load and merge plugin options over the on-disk advisor config over defaults. */
export function loadAdvisorConfig(options) {
    const home = homedir();
    const advisorJsonPath = join(home, ".config", "opencode", "advisor.json");
    const fileConfig = (tryReadJson(advisorJsonPath) || {});
    return {
        enabled: true,
        reviewMode: "step",
        reviewInterval: 1,
        maxToolSteps: 3,
        maxNotesPerUpdate: 3,
        immuneTurns: 3,
        timeoutMs: 25000,
        tools: ["read", "grep", "glob"],
        requireEvidence: true,
        delivery: {
            nit: "synthetic_noreply",
            concern: "synthetic_noreply",
            blocker: "steer_waking",
        },
        ...fileConfig,
        ...options,
    };
}
/** Resolve the background watchdog model. */
export function resolveWatchdog(config) {
    const model = config.watchdogModel || config.model || DEFAULT_WATCHDOG_MODEL;
    return {
        role: "watchdog",
        model,
        modelName: resolveModelName(model),
        provider: mergeProvider(config.provider, model),
        systemPrompt: config.systemPrompt || WATCHDOG_SYSTEM_PROMPT,
        maxToolSteps: Math.min(5, Math.max(1, config.maxToolSteps ?? 3)),
        timeoutMs: config.timeoutMs ?? 25000,
        tools: config.tools ?? ["read", "grep", "glob"],
        maxTokens: config.maxTokens,
        temperature: 0.1,
    };
}
/** Resolve the intrinsic consultation model (falls back to the watchdog model). */
export function resolveConsult(config) {
    const watchdogModel = config.watchdogModel || config.model || DEFAULT_WATCHDOG_MODEL;
    const consult = config.consult ?? {};
    const model = consult.model || watchdogModel;
    return {
        role: "consult",
        model,
        modelName: resolveModelName(model),
        provider: mergeProvider(consult.provider || config.provider, model),
        systemPrompt: consult.systemPrompt || CONSULT_SYSTEM_PROMPT,
        maxToolSteps: 0,
        timeoutMs: config.timeoutMs ?? 25000,
        tools: [],
        maxTokens: consult.maxTokens ?? config.maxTokens,
        temperature: 0.2,
    };
}
export function isConsultEnabled(config) {
    return config.consult?.enabled !== false && config.enabled !== false;
}
export { DEFAULT_BASE_URL };
//# sourceMappingURL=config.js.map