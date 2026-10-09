import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveSafePath } from "./safe-fs.js";
import type { ToolDefinition } from "../types.js";

function walkFiles(dir: string, workspaceDir: string, maxFiles: number, signal: AbortSignal): string[] {
  const list: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (signal.aborted) break;
    if (list.length >= maxFiles) break;

    const fullPath = join(dir, entry.name);
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
        const sub = walkFiles(fullPath, workspaceDir, maxFiles - list.length, signal);
        list.push(...sub);
      } catch {
        // Skip inaccessible dirs
      }
    } else if (entry.isFile()) {
      list.push(relative(workspaceDir, fullPath));
    }
  }

  return list;
}

export const globTool: ToolDefinition = {
  name: "glob",
  description: "Find files matching a substring or wildcard pattern in the workspace.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "File pattern or extension filter (e.g. '.ts', 'test', 'schema').",
      },
      path: {
        type: "string",
        description: "Subdirectory to search (optional).",
      },
      maxResults: {
        type: "number",
        description: "Maximum matches to return (default 50, max 100).",
      },
    },
    required: ["pattern"],
  },
  async execute(args, context) {
    const rawPattern = String(args["pattern"] || "").toLowerCase();
    const subPath = String(args["path"] || ".");
    const maxResults = Math.min(100, Math.max(1, Number(args["maxResults"] || 50)));

    try {
      const searchDir = resolveSafePath(context.workspaceDir, subPath);
      const allFiles = walkFiles(searchDir, context.workspaceDir, 500, context.signal);
      const filtered = allFiles
        .filter((file) => file.toLowerCase().includes(rawPattern))
        .slice(0, maxResults);

      if (filtered.length === 0) {
        return `No files matched pattern '${rawPattern}'.`;
      }
      return `[Glob matched ${filtered.length} files]:\n${filtered.join("\n")}`;
    } catch (err: unknown) {
      return `Error in glob: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
