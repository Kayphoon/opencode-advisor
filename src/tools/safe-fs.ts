import { resolve, normalize, relative } from "node:path";
import { realpathSync, existsSync } from "node:fs";

export function resolveSafePath(workspaceDir: string, targetPath: string): string {
  const normWorkspace = normalize(resolve(workspaceDir));
  const candidate = resolve(normWorkspace, targetPath);

  // Check prefix
  const rel = relative(normWorkspace, candidate);
  if (rel.startsWith("..") || resolve(candidate) !== candidate) {
    throw new Error(`Access denied: path '${targetPath}' escapes workspace '${workspaceDir}'`);
  }

  // If path exists on disk, check realpath (symlinks)
  if (existsSync(candidate)) {
    try {
      const real = realpathSync(candidate);
      const realRel = relative(normWorkspace, real);
      if (realRel.startsWith("..")) {
        throw new Error(`Access denied: symlink points outside workspace '${workspaceDir}'`);
      }
      return real;
    } catch {
      // If stat fails, fall back to resolved candidate
    }
  }

  return candidate;
}
