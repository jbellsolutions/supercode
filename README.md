# SuperCode

> Multi-model CLI coding agent — all the power of Claude Code, none of the vendor lock-in.

SuperCode replicates the Claude Code architecture (streaming agent loop, tool harness, context injection, permission model, sub-agents) but routes prompts across **Gemini**, **OpenAI Codex**, and **OpenRouter** models. Run most sessions at near-zero cost on Gemini's free tier.

---

## Quick Start

```bash
# Install globally
npm install -g supercode

# Set your API keys (at least one required)
export GEMINI_API_KEY=your_key_here
export OPENAI_API_KEY=your_key_here       # optional
export OPENROUTER_API_KEY=your_key_here   # optional

# Interactive REPL
supercode

# Single-shot task
supercode "add input validation to the login form"

# Pipe from stdin
cat error.log | supercode "explain this error and suggest a fix"

# With options
supercode "migrate database schema" \
  --model gemini-2.5-pro \
  --mode acceptEdits \
  --max-turns 50 \
  --max-cost 0.25
```

---

## Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Prompts for approval before risky tools (Write, Bash, etc.) |
| `acceptEdits` | Auto-approves file edits; prompts for Bash |
| `plan` | No tool execution — produces a plan only |
| `dontAsk` | Never prompts; all tools run silently |

```bash
supercode "refactor auth module" --mode acceptEdits
supercode "what does this codebase do" --mode plan
supercode "run tests and fix failures" --mode dontAsk
```

---

## REPL Commands

```
/help           Show available commands
/model <name>   Switch model mid-session
/cost           Show current session cost
/memory         Show loaded SUPERCODE.md context
/tools          List registered tools
/mode <mode>    Change permission mode
/clear          Clear conversation history
/exit           End session
```

---

## Model Routing

SuperCode automatically routes each task to the best available model:

| Task | Primary | Fallback |
|------|---------|----------|
| Long-context read | `gemini-2.5-pro` | `openrouter/deepseek-r1` |
| Code editing | `codex-latest` | `gemini-2.5-flash` |
| Planning/reasoning | `openrouter/claude-3.5-haiku` | `gemini-2.5-flash` |
| Sub-agent tasks | `gemini-2.5-flash` | `openrouter/mistral-nemo` |

Override anytime: `--model gemini-2.5-pro` or `/model codex-latest` mid-session.

---

## Configuration

Create `~/.supercode/config.yaml`:

```yaml
version: 1

models:
  default: gemini-2.5-flash
  longContext: gemini-2.5-pro
  codeEdit: codex-latest
  subAgent: gemini-2.5-flash

providers:
  gemini:
    apiKey: $GEMINI_API_KEY
    rpmLimit: 60
  openai:
    apiKey: $OPENAI_API_KEY
  openrouter:
    apiKey: $OPENROUTER_API_KEY

costs:
  maxPerSessionCents: 50
  warnAtCents: 10
  preferFreeModels: true

permissions:
  defaultMode: default
  alwaysAllow:
    - Read
    - Glob
    - Grep
    - TodoRead
    - TodoWrite
```

---

## Project Context (SUPERCODE.md)

Place a `SUPERCODE.md` file in your project root to inject persistent context:

```markdown
# My Project

## Tech Stack
- Next.js 14, TypeScript, Prisma, PostgreSQL

## Never touch
- prisma/migrations/
- .env

## Style
- Use server components by default
- Prefer named exports
```

SuperCode loads this at session start and when files in that directory are accessed.

---

## Hooks

Create `.supercode/hooks/config.yaml` to intercept tool calls:

```yaml
hooks:
  - event: pre-tool
    matcher: Bash
    action: notify
    script: ./hooks/log-bash.sh
  - event: pre-tool
    matcher: Write
    action: deny
    condition: "input.path.startsWith('/etc')"
```

---

## Available Tools

| Tool | Description | Permission |
|------|-------------|------------|
| `Read` | Read file contents | Auto |
| `Write` | Create/overwrite files | Approval |
| `Edit` | Targeted string replacements | acceptEdits auto |
| `Glob` | Pattern-match file paths | Auto |
| `Grep` | Regex search across files | Auto |
| `Bash` | Shell command execution | Approval |
| `WebFetch` | HTTP GET with text extraction | Approval |
| `TodoRead` | Read task list | Auto |
| `TodoWrite` | Update task list | Auto |
| `SubAgent` | Spawn a child agent | Approval |

---

## Cost Comparison

| Provider | Model | ~Price (per 1M tokens) | Free Tier |
|----------|-------|------------------------|-----------|
| Google | Gemini 2.5 Flash | $0.15 / $0.60 | 60 RPM |
| Google | Gemini 2.5 Pro | $1.25 / $10 | 25 RPM |
| OpenAI | Codex / GPT-4o | $3 / $15 | None |
| OpenRouter | deepseek-r1 | $0.55 / $2.19 | None |
| OpenRouter | mistral-nemo | $0.035 / $0.035 | None |

By routing everyday tasks to Gemini Flash (free tier), most sessions run at **near-zero cost**.

---

## Development

```bash
# Clone
git clone https://github.com/jbellsolutions/supercode
cd supercode

# Install
pnpm install

# Build all packages
pnpm build

# Run locally
node packages/cli/dist/index.js

# Run tests
pnpm test
```

---

## License

MIT — [github.com/jbellsolutions/supercode](https://github.com/jbellsolutions/supercode)
