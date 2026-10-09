import { readFileSync, statSync, existsSync } from "node:fs";
import { resolveSafePath } from "./safe-fs.js";
export const readTool = {
    name: "read",
    description: "Read contents of a file within the workspace. Supports startLine and lineCount bounds.",
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Path to file relative to the project workspace.",
            },
            startLine: {
                type: "number",
                description: "1-based starting line number (optional).",
            },
            lineCount: {
                type: "number",
                description: "Number of lines to read (optional, default 200, max 500).",
            },
        },
        required: ["path"],
    },
    async execute(args, context) {
        const rawPath = String(args["path"] || "");
        if (!rawPath)
            return "Error: path is required";
        try {
            const fullPath = resolveSafePath(context.workspaceDir, rawPath);
            if (!existsSync(fullPath)) {
                return `Error: file '${rawPath}' does not exist`;
            }
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
                return `Error: '${rawPath}' is a directory`;
            }
            if (stat.size > 2 * 1024 * 1024) {
                return `Error: file exceeds 2MB limit`;
            }
            const raw = readFileSync(fullPath, "utf-8");
            const lines = raw.split(/\r?\n/);
            const start = Math.max(1, Number(args["startLine"] || 1));
            const limit = Math.min(500, Math.max(1, Number(args["lineCount"] || 200)));
            const sliced = lines.slice(start - 1, start - 1 + limit);
            const formatted = sliced.map((line, idx) => `${start + idx}: ${line}`).join("\n");
            return `[File: ${rawPath} (${lines.length} total lines)]\n${formatted}`;
        }
        catch (err) {
            return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};
//# sourceMappingURL=read.js.map