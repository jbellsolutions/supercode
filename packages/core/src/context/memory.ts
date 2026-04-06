import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  sessionId: string;
}

export class MemoryManager {
  private memoryDir: string;
  private entries: MemoryEntry[] = [];

  constructor(private projectDir: string) {
    // Project-level memory: .supercode/memory/
    this.memoryDir = join(projectDir, ".supercode", "memory");
    mkdirSync(this.memoryDir, { recursive: true });
    this.load();
  }

  private memoryPath(): string {
    return join(this.memoryDir, "entries.json");
  }

  private load(): void {
    const path = this.memoryPath();
    if (!existsSync(path)) return;
    try {
      this.entries = JSON.parse(readFileSync(path, "utf-8")) as MemoryEntry[];
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    writeFileSync(this.memoryPath(), JSON.stringify(this.entries, null, 2), "utf-8");
  }

  add(content: string, tags: string[], sessionId: string): MemoryEntry {
    const entry: MemoryEntry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      content,
      tags,
      createdAt: new Date().toISOString(),
      sessionId,
    };
    this.entries.push(entry);
    this.save();
    return entry;
  }

  search(query: string): MemoryEntry[] {
    const q = query.toLowerCase();
    return this.entries.filter(
      (e) =>
        e.content.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  getAll(): MemoryEntry[] {
    return [...this.entries];
  }

  formatForContext(): string {
    if (this.entries.length === 0) return "";
    return (
      "## Persistent Memory\n" +
      this.entries
        .slice(-20) // last 20 entries
        .map((e) => `- [${e.tags.join(",")}] ${e.content}`)
        .join("\n")
    );
  }

  clear(): void {
    this.entries = [];
    this.save();
  }
}
