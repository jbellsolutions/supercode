# SuperCode — Project Context

## What is SuperCode?

SuperCode is a self-hosted, CLI-native agentic coding assistant that replicates the Claude Code architecture but runs across Gemini, OpenAI Codex, and OpenRouter-routed models.

## Tech Stack

- **Language**: TypeScript (ESM, Node 18+)
- **Monorepo**: Turborepo + pnpm workspaces
- **Packages**: `@supercode/core` (engine), `supercode` (CLI)
- **CLI**: Commander.js for arg parsing
- **Model adapters**: `@google/generative-ai`, `openai` SDK (Codex + OpenRouter)
- **Schema validation**: Zod
- **Testing**: Vitest

## Directory Structure

```
packages/
  core/src/
    agent/     — agent loop, session management, sub-agents
    router/    — model router, adapters (Gemini, Codex, OpenRouter), cost tracker
    tools/     — all tool implementations
    permissions/ — permission gate, hooks runner
    context/   — SUPERCODE.md loader, memory manager
    config/    — config.yaml reader
  cli/src/
    index.ts   — CLI entry, arg parsing
    repl.ts    — interactive REPL
    commands/  — /help, /model, /cost, etc.
    display/   — terminal renderer
```

## Code Style

- All TypeScript, strict mode
- ESM modules (`.js` extensions in imports)
- Zod for all external input validation
- Async generators for streaming
- No `any` unless absolutely necessary (comment why)

## Files to Never Touch

- `node_modules/`
- `dist/`
- `.turbo/`

## Model Routing

Default routing by task type (see `packages/core/src/router/index.ts`):
- Long-context read → `gemini-2.5-pro`
- Code edit → `codex-latest`
- Planning → `openrouter/claude-3.5-haiku`
- Sub-agents → `gemini-2.5-flash`
