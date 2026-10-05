# MCP Self-Healing Coder

A universal **Model Context Protocol (MCP)** server that autonomously executes tests and builds, catches compiler/test errors, parses stack traces into actionable diagnostics, and iterates code repairs until tests pass.

Compatible with any MCP-enabled AI client or desktop environment (**Claude Desktop, Cursor, Antigravity, Windsurf, VS Code, Goose**).

---

## Features

- **Autonomous Self-Healing Loop:** Executes verification commands (`npm test`, `pytest`, `cargo test`, etc.), extracts diagnostics, and invokes an LLM to iteratively repair files until exit code is 0.
- **Multi-Language Diagnostic Parser:** Extracts structured error reports (file, line number, column, severity, error code, message) for:
  - TypeScript & JavaScript (`tsc`, `eslint`, `vitest`, `jest`, `vite`)
  - Python (`pytest`, `mypy`, `flake8`, traceback exceptions)
  - Go compiler errors
  - Rust (`cargo test`, `rustc`)
- **Git Checkpoint & Safe Rollback:** Creates automatic local git checkpoints before making edits; safely reverts changes if self-healing fails.
- **Zero Third-Party Dependency Lock-in:** Supports Anthropic, OpenAI, or local **Ollama** models (e.g. `qwen2.5-coder`).

---

## Exposed MCP Tools

| Tool | Description | Key Arguments |
| :--- | :--- | :--- |
| `self_healing_code_loop` | Autonomously repairs code until the verification command passes. | `projectPath`, `verifyCommand`, `task`, `maxIterations` (default 3), `autoRollbackOnFailure` |
| `verify_and_diagnose` | Runs test/build and returns structured diagnostics without modifying code. | `projectPath`, `verifyCommand`, `timeoutMs` |
| `git_checkpoint` | Manages Git checkpoints, rolls back uncommitted changes, or gets diffs. | `projectPath`, `action` (`create`, `rollback`, `diff`) |
| `apply_safe_patch` | Safely writes or patches files in the project. | `projectPath`, `filePath`, `content` |

---

## Desktop & Client Configuration

### 1. Claude Desktop
Add this to your `claude_desktop_config.json`:

* **Linux:** `~/.config/Claude/claude_desktop_config.json`
* **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "self-healing-coder": {
      "command": "node",
      "args": ["/home/anishb/projects/mcp-self-healing-coder/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### 2. Cursor
1. Go to **Settings** > **Features** > **MCP Servers**.
2. Click **Add New MCP Server**.
3. Name: `self-healing-coder`
4. Type: `command`
5. Command: `node /home/anishb/projects/mcp-self-healing-coder/dist/index.js`

### 3. Antigravity CLI / Sidecars
Add to your Antigravity configuration or launch with:
```json
{
  "mcpServers": {
    "self-healing-coder": {
      "command": "node",
      "args": ["/home/anishb/projects/mcp-self-healing-coder/dist/index.js"]
    }
  }
}
```

---

## Local Ollama Setup (Free / Completely Offline)

If you don't want to use paid API keys, point to a local Ollama instance:

```json
{
  "mcpServers": {
    "self-healing-coder": {
      "command": "node",
      "args": ["/home/anishb/projects/mcp-self-healing-coder/dist/index.js"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "OLLAMA_MODEL": "qwen2.5-coder"
      }
    }
  }
}
```

---

## Development & Build

```bash
# Install dependencies
pnpm install

# Build single-file executable to dist/index.js
pnpm build

# Start directly
pnpm start
```
