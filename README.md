# 🌌 Kanon — Autonomous AI Orchestration CLI

[日本語版はこちら](./README.ja.md)

Kanon is an autonomous orchestration tool that integrates multiple AI agents (Gemini, OpenCode-ai, GitHub Copilot) to drive the full software development lifecycle — from planning to code review — through a multi-agent FSM pipeline.

## ✨ Key Features

- **Multi-Agent Orchestration**: Architect → Developer → Reviewer pipeline using configurable AI CLIs
- **Autonomous Gatekeeper**: Automatically validates the generated code (lint/build) and triggers self-correction loops
- **`kanon-cli.json` Configuration**: Per-project customization of agent mapping, worktree path, and retry count
- **Antigravity Dashboard**: Real-time monitoring of agent activity via VS Code sidebar + WebSocket streaming
- **Domain-Driven Core**: Built on Clean Architecture with FSM-based state management

## 🚀 Quick Start

### Installation

```bash
npm install
npm run build:cli
npm link   # makes `kanon` available globally
```

### Run a Task

```bash
# Create an implementation plan
kanon plan --task="Add user authentication to the API"

# Execute the plan (with autonomous review & correction loop)
kanon execute

# Final review
kanon review
```

### Start the Dashboard (VS Code)

```bash
kanon ui   # starts the WebSocket server on port 3001
```

Open VS Code and click the 🚀 icon in the sidebar to open the Antigravity Dashboard.

## ⚙️ Configuration (`.kanon/config.json`)

When you initialize a Kanon project with `kanon init`, a `.kanon/config.json` file is automatically generated.
This file allows you to customize the AI CLI assigned to each agent role, specific models to run, and other runtime behaviors.

```json
{
  "defaultCli": "gemini",
  "agents": {
    "architect": {
      "command": "gemini",
      "model": "gemini-3.1-pro"
    },
    "developer": {
      "command": "opencode",
      "model": "claude-4.6-opus"
    },
    "reviewer": {
      "command": "copilot",
      "model": "gpt-5.3-codex"
    }
  },
  "worktreeDir": "worktree",
  "maxRetries": 3
}
```

| Field | Description | Default |
|---|---|---|
| `defaultCli` | Default AI command CLI to use (e.g. `gemini`, `copilot`, `opencode`) | `"gemini"` |
| `agents.*.command` | Specific CLI assigned to a given agent role. You can also define custom roles like `qa-tester` or `docs-writer`. | (uses `defaultCli`) |
| `agents.*.model` | The specific LLM model passed to the CLI as `--model` | - |
| `worktreeDir` | Directory where separate git worktrees are created for tasks | `"worktree"` |
| `maxRetries` | Maximum number of retries for the self-correction loop when Gatekeeper review fails | `3` |

> ℹ️ **Legacy compatibility**: `kanon-cli.json` and `.kanonrc` placed at the project root are still supported, but `.kanon/config.json` takes precedence if both exist.

**Editor Autocompletion Schema**:
A JSON Schema dictionary for VS Code and other editors is provided at [`kanon-config.schema.json`](./kanon-config.schema.json) to enable IDE autocompletion for your `.kanon/config.json`.

## 🧪 Testing

```bash
# Unit tests (Domain / Use Cases / Infrastructure layers)
npm run test:unit

# Build verification
npm run build:cli
```

The unit test suite covers 58 test cases across 8 test files using [Vitest](https://vitest.dev). See [`docs/TESTING.md`](./docs/TESTING.md) for details.

## 🏗️ Project Structure

```
src/
├── cli/                    # CLI entry point, agent runner, config loader
│   ├── orchestrate.ts      # Main kanon command
│   ├── cli-resolver.ts     # CLI detection & config loading (kanon-cli.json)
│   └── prompts/            # LLM prompt templates
├── domain/                 # Pure business logic (no external deps)
│   ├── models/             # FSM nodes, agent state, feedback, prompt facets
│   └── services/           # MergeGateway (all/any aggregation)
├── usecases/               # Orchestration & prompt use cases
│   ├── orchestration/      # TransitionEngine, ReviewOrchestrator
│   └── prompt/             # PromptSynthesizer, FeedbackInjector
└── infrastructure/         # External integrations
    ├── config/             # YamlWorkflowParser
    └── contextBus/         # InMemoryBlackboard
tests/                      # Vitest unit tests (mirrors src/ structure)
skills/                     # Agent skill definitions (SKILL.md files)
docs/                       # Architecture docs, TODO, testing guide
```

## 📚 Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Testing Strategy](./docs/TESTING.md)
- [TODO / Roadmap](./docs/TODO.md)
- [Getting Started](./docs/GET_STARTED.ja.md)
- [Contributing](./CONTRIBUTING.md)

## 📝 License

MIT — see [LICENSE](./LICENSE) for details.
