import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveSafePath } from "./safe-fs.js";
import type { ToolDefinition } from "../types.js";

function walkAndGrep(
  dir: string,
  workspaceDir: string,
  regex: RegExp,
  maxMatches: number,
  signal: AbortSignal
): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (signal.aborted) break;
    if (results.length >= maxMatches) break;

    const fullPath = join(dir, entry.name);
    // Ignore heavy or hidden folders
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === ".turbo" ||
        entry.name === ".cache"
      ) {
        continue;
      }
      try {
        const sub = walkAndGrep(fullPath, workspaceDir, regex, maxMatches - results.length, signal);
        results.push(...sub);
      } catch {
        // Skip inaccessible dirs
      }
    } else if (entry.isFile()) {
      try {
        const stat = statSync(fullPath);
        if (stat.size > 1024 * 1024) continue; // skip files > 1MB

        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split(/\r?\n/);
        const relPath = relative(workspaceDir, fullPath);

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push(`${relPath}:${i + 1}: ${lines[i].trimEnd().slice(0, 160)}`);
            if (results.length >= maxMatches) break;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return results;
}

export const grepTool: ToolDefinition = {
  name: "grep",
  description: "Search file contents for regex or literal patterns within the workspace.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern or keyword to search for.",
      },
      path: {
        type: "string",
        description: "Directory path relative to workspace to narrow search (optional, defaults to root).",
      },
      maxResults: {
        type: "number",
        description: "Maximum matches to return (default 50, max 100).",
      },
    },
    required: ["pattern"],
  },
  async execute(args, context) {
    const rawPattern = String(args["pattern"] || "");
    if (!rawPattern) return "Error: pattern is required";

    const subPath = String(args["path"] || ".");
    const maxResults = Math.min(100, Math.max(1, Number(args["maxResults"] || 50)));

    try {
      const searchDir = resolveSafePath(context.workspaceDir, subPath);
      const regex = new RegExp(rawPattern, "i");
      const matches = walkAndGrep(searchDir, context.workspaceDir, regex, maxResults, context.signal);

      if (matches.length === 0) {
        return `No matches found for '${rawPattern}'.`;
      }
      return `[Grep matches for '${rawPattern}' (${matches.length} matches)]:\n${matches.join("\n")}`;
    } catch (err: unknown) {
      return `Error in grep: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
