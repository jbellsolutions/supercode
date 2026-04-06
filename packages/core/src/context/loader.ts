import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";

/**
 * Loads SUPERCODE.md (or CLAUDE.md as fallback) context files.
 * Walks up from the working directory and loads each context file found.
 * Sub-directory context files are loaded when files in that directory are touched.
 */
export class ContextLoader {
  private cache = new Map<string, string>();

  /**
   * Load project-level context files from the working directory and its parents.
   */
  loadProjectContext(workingDirectory: string): string {
    const parts: string[] = [];
    let dir = resolve(workingDirectory);
    const visited = new Set<string>();

    // Walk up the directory tree
    while (dir && !visited.has(dir)) {
      visited.add(dir);

      const supercodeFile = join(dir, "SUPERCODE.md");
      const claudeFile = join(dir, "CLAUDE.md");

      if (existsSync(supercodeFile)) {
        parts.unshift(this.loadFile(supercodeFile));
      } else if (existsSync(claudeFile)) {
        parts.unshift(this.loadFile(claudeFile));
      }

      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    return parts.join("\n\n---\n\n");
  }

  /**
   * Load context for a specific file path (sub-directory context).
   */
  loadFileContext(filePath: string): string {
    const fileDir = dirname(resolve(filePath));
    return this.loadProjectContext(fileDir);
  }

  private loadFile(path: string): string {
    if (this.cache.has(path)) return this.cache.get(path)!;
    try {
      const content = readFileSync(path, "utf-8");
      this.cache.set(path, content);
      return content;
    } catch {
      return "";
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}
