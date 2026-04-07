#!/usr/bin/env node
/**
 * SuperCode — single-file, zero-dependency AI coding agent
 * Requires: Node.js 18+  |  Set OPENROUTER_API_KEY env var
 * Usage: node supercode.mjs [prompt]
 */

import readline from "readline";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";

const MODEL    = process.env.SUPERCODE_MODEL    || "deepseek/deepseek-r1";
const API_KEY  = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || "";
const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const CWD      = process.cwd();

// ── Colours ───────────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",  bold: "\x1b[1m",
  purple: "\x1b[35m", cyan: "\x1b[36m",
  green: "\x1b[32m",  red: "\x1b[31m",
  grey: "\x1b[90m",   yellow: "\x1b[33m",
};
const p = (color, txt) => process.stdout.write(color + txt + c.reset);

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM = `You are SuperCode, an expert AI coding agent running in ${CWD}.

You can use these tools by outputting JSON blocks:
<tool>{"name":"read","path":"src/index.ts"}</tool>
<tool>{"name":"write","path":"src/foo.ts","content":"..."}</tool>
<tool>{"name":"edit","path":"src/foo.ts","old":"old text","new":"new text"}</tool>
<tool>{"name":"bash","cmd":"npm test"}</tool>
<tool>{"name":"glob","pattern":"**/*.ts"}</tool>
<tool>{"name":"grep","pattern":"TODO","path":"."}</tool>

Rules:
- Always read files before editing them
- Use bash to run tests after making changes
- Make targeted edits, not full rewrites
- Think step by step before acting`;

// ── Tools ─────────────────────────────────────────────────────────────────────
function runTool(call) {
  try {
    switch (call.name) {
      case "read": {
        const abs = path.resolve(CWD, call.path);
        if (!fs.existsSync(abs)) return `File not found: ${abs}`;
        const lines = fs.readFileSync(abs, "utf8").split("\n");
        const start = (call.offset || 1) - 1;
        const end   = call.limit ? start + call.limit : lines.length;
        return lines.slice(start, end).map((l,i)=>`${start+i+1}: ${l}`).join("\n");
      }
      case "write": {
        const abs = path.resolve(CWD, call.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, call.content, "utf8");
        return `Written ${call.content.length} bytes to ${call.path}`;
      }
      case "edit": {
        const abs = path.resolve(CWD, call.path);
        if (!fs.existsSync(abs)) return `File not found: ${abs}`;
        let content = fs.readFileSync(abs, "utf8");
        if (!content.includes(call.old)) return `oldString not found in ${call.path}`;
        content = content.replace(call.old, call.new);
        fs.writeFileSync(abs, content, "utf8");
        return `Edited ${call.path}`;
      }
      case "bash": {
        const out = execSync(call.cmd, { cwd: CWD, timeout: 30000, encoding: "utf8", stdio: ["pipe","pipe","pipe"] });
        return out || "(no output)";
      }
      case "glob": {
        const result = execSync(`find ${CWD} -type f -name "${call.pattern.replace("**/*","*")}" 2>/dev/null | grep -v node_modules | grep -v .git | grep -v dist | head -50`, { encoding:"utf8" });
        return result || "No files found";
      }
      case "grep": {
        try {
          const result = execSync(`grep -rn "${call.pattern}" ${path.resolve(CWD, call.path||".")} --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.py" -l 2>/dev/null | head -20`, { encoding:"utf8" });
          return result || "No matches";
        } catch { return "No matches"; }
      }
      default:
        return `Unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

// ── Parse tool calls from model output ───────────────────────────────────────
function parseTools(text) {
  const calls = [];
  const re = /<tool>([\s\S]*?)<\/tool>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    try { calls.push(JSON.parse(m[1])); } catch {}
  }
  return calls;
}

// ── Stream from OpenRouter ────────────────────────────────────────────────────
async function streamChat(messages) {
  if (!API_KEY) {
    console.error(`\n${c.red}✗ No API key found.${c.reset}`);
    console.error(`  Set your OpenRouter key:\n  export OPENROUTER_API_KEY=sk-or-v1-...\n`);
    process.exit(1);
  }

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/jbellsolutions/supercode",
      "X-Title": "SuperCode",
    },
    body: JSON.stringify({ model: MODEL, messages, stream: true }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  let fullText = "";
  const decoder = new TextDecoder();
  let buf = "";

  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content || "";
        if (delta) {
          process.stdout.write(c.reset + delta);
          fullText += delta;
        }
      } catch {}
    }
  }
  console.log();
  return fullText;
}

// ── Agent loop ────────────────────────────────────────────────────────────────
async function runAgent(userPrompt, messages = []) {
  messages.push({ role: "user", content: userPrompt });

  let turns = 0;
  const MAX = 20;

  while (turns++ < MAX) {
    p(c.grey, `\n[${MODEL}] `);

    const reply = await streamChat([
      { role: "system", content: SYSTEM },
      ...messages,
    ]);

    messages.push({ role: "assistant", content: reply });

    const tools = parseTools(reply);
    if (tools.length === 0) break; // done

    for (const call of tools) {
      p(c.cyan, `\n⚙ ${call.name}`);
      if (call.path) p(c.grey, ` ${call.path}`);
      if (call.cmd)  p(c.grey, ` ${call.cmd}`);
      console.log();

      const result = runTool(call);
      const preview = result.split("\n").slice(0, 5).join("\n");
      p(c.green, `  ✓ ${preview.slice(0, 200)}\n`);

      messages.push({ role: "user", content: `<tool_result name="${call.name}">${result}</tool_result>` });
    }
  }

  return messages;
}

// ── REPL ──────────────────────────────────────────────────────────────────────
async function repl() {
  console.log(`\n${c.bold}${c.purple}  ⚡ SuperCode${c.reset}  ${c.grey}${MODEL} · ${CWD}${c.reset}`);
  console.log(`${c.grey}  Type your prompt. /exit to quit. /model <name> to switch.\n${c.reset}`);

  if (!API_KEY) {
    console.log(`${c.yellow}  ⚠  No OPENROUTER_API_KEY set.${c.reset}`);
    console.log(`${c.grey}  Get a free key at https://openrouter.ai/keys${c.reset}`);
    console.log(`${c.grey}  Then run: OPENROUTER_API_KEY=sk-or-v1-... node supercode.mjs\n${c.reset}`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let messages = [];

  const prompt = () => {
    rl.question(`\n${c.purple}❯${c.reset} `, async (input) => {
      const line = input.trim();
      if (!line) return prompt();
      if (line === "/exit" || line === "/quit") { rl.close(); return; }
      if (line === "/clear") { messages = []; p(c.grey, "  History cleared.\n"); return prompt(); }
      if (line.startsWith("/model ")) {
        process.env.SUPERCODE_MODEL = line.slice(7).trim();
        p(c.green, `  Model: ${process.env.SUPERCODE_MODEL}\n`);
        return prompt();
      }
      try {
        messages = await runAgent(line, messages);
      } catch (err) {
        p(c.red, `\n✗ ${err.message}\n`);
      }
      prompt();
    });
  };

  prompt();
}

// ── Entry point ───────────────────────────────────────────────────────────────
const prompt = process.argv.slice(2).join(" ");
if (prompt) {
  runAgent(prompt).catch(err => { console.error(err.message); process.exit(1); });
} else {
  repl();
}
