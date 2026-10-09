import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AdvisorConfig } from "./types.js";

const DEFAULT_CONFIG: Required<Omit<AdvisorConfig, "variant">> = {
  enabled: true,
  model: "deepseek/deepseek-flash",
  provider: {},
  reviewMode: "step",
  maxToolSteps: 3,
  maxNotesPerUpdate: 3,
  immuneTurns: 3,
  timeoutMs: 25000,
  tools: ["read", "grep", "glob"],
  delivery: {
    nit: "synthetic_noreply",
    concern: "synthetic_noreply",
    blocker: "steer_waking",
  },
  systemPrompt: `You are an autonomous Watchdog Advisor reviewing an ongoing OpenCode programming session.
Your role is strictly to detect architecture flaws, bugs, security vulnerabilities, and violations of user constraints.
Before raising an issue, use read/grep/glob to verify the actual codebase facts.
When you identify an issue, invoke the advise tool with a concise, actionable note and severity (nit, concern, blocker).
If everything looks good or there is nothing important to say, do NOT call advise.`,
};

function tryReadJson(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, "utf-8");
    // Strip simple JSONC comments if present
    const stripped = content.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "$1");
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveProviderFromGlobalOpencode(modelSlug: string): { baseURL?: string; apiKey?: string } {
  const home = homedir();
  const candidates = [
    join(home, ".config", "opencode", "opencode.jsonc"),
    join(home, ".config", "opencode", "opencode.json"),
  ];

  for (const file of candidates) {
    const data = tryReadJson(file);
    if (!data) continue;

    const providerObj = data["provider"] as Record<string, unknown> | undefined;
    if (!providerObj || typeof providerObj !== "object") continue;

    const [providerId] = modelSlug.split("/");
    const target = providerObj[providerId] as Record<string, unknown> | undefined;
    if (target && typeof target === "object") {
      const opts = target["options"] as Record<string, unknown> | undefined;
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

export function loadAdvisorConfig(options?: Record<string, unknown>): AdvisorConfig {
  const home = homedir();
  const advisorJsonPath = join(home, ".config", "opencode", "advisor.json");
  const fileConfig = (tryReadJson(advisorJsonPath) || {}) as Partial<AdvisorConfig>;

  const merged: AdvisorConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...(options as Partial<AdvisorConfig>),
  };

  // If provider credentials are empty, auto-resolve from ~/.config/opencode/opencode.jsonc
  if (!merged.provider?.baseURL || !merged.provider?.apiKey) {
    const autoResolved = resolveProviderFromGlobalOpencode(merged.model);
    merged.provider = {
      baseURL: merged.provider?.baseURL || autoResolved.baseURL,
      apiKey: merged.provider?.apiKey || autoResolved.apiKey,
    };
  }

  return merged;
}
