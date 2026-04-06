import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Session, Message, Tool, PermissionMode } from "../types.js";

const SESSION_DIR = join(homedir(), ".supercode", "sessions");

export function createSession(opts: {
  workingDirectory: string;
  mode: PermissionMode;
  maxTurns?: number;
  tools: Tool[];
  systemPrompt: string;
  model?: string;
  sessionId?: string;
}): Session {
  return {
    id: opts.sessionId ?? randomUUID(),
    workingDirectory: opts.workingDirectory,
    mode: opts.mode,
    maxTurns: opts.maxTurns ?? 100,
    messages: [],
    tools: opts.tools,
    systemPrompt: opts.systemPrompt,
    model: opts.model,
    startTime: new Date(),
  };
}

export function saveSession(session: Session): void {
  mkdirSync(SESSION_DIR, { recursive: true });
  const path = join(SESSION_DIR, `${session.id}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        ...session,
        tools: session.tools.map((t) => t.name), // serialize only names
      },
      null,
      2
    ),
    "utf-8"
  );
}

export interface SavedSession {
  id: string;
  workingDirectory: string;
  mode: PermissionMode;
  maxTurns: number;
  messages: Message[];
  model?: string;
  startTime: string;
}

export function loadSavedSession(sessionId: string): SavedSession | null {
  const path = join(SESSION_DIR, `${sessionId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SavedSession;
  } catch {
    return null;
  }
}

export function listSessions(): Array<{ id: string; startTime: string; workingDirectory: string }> {
  mkdirSync(SESSION_DIR, { recursive: true });
  const { readdirSync } = require("fs");
  const files: string[] = readdirSync(SESSION_DIR).filter((f: string) => f.endsWith(".json"));

  return files.map((f: string) => {
    try {
      const data = JSON.parse(readFileSync(join(SESSION_DIR, f), "utf-8"));
      return { id: data.id, startTime: data.startTime, workingDirectory: data.workingDirectory };
    } catch {
      return { id: f.replace(".json", ""), startTime: "", workingDirectory: "" };
    }
  });
}
