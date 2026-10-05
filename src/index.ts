import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./executor.js";
import { createCheckpoint, rollbackChanges, getGitDiff } from "./git.js";
import { runSelfHealingLoop } from "./loop.js";

dotenv.config();

const server = new McpServer({
  name: "mcp-self-healing-coder",
  version: "1.0.0",
});

// Tool 1: Autonomous Self-Healing Loop
server.tool(
  "self_healing_code_loop",
  "Autonomously executes tests/builds, catches errors, calls LLM to patch files, and repeats until the command succeeds (exit code 0) or iteration limit is reached.",
  {
    projectPath: z.string().describe("Absolute directory path of the target project"),
    verifyCommand: z
      .string()
      .describe("Command to verify project health (e.g. 'npm test', 'npm run build', 'pytest')"),
    task: z
      .string()
      .optional()
      .describe("Description of what needs to be fixed or built"),
    targetFiles: z
      .array(z.string())
      .optional()
      .describe("List of relative file paths to focus on"),
    maxIterations: z
      .number()
      .min(1)
      .max(10)
      .default(3)
      .describe("Maximum repair iterations (default: 3)"),
    autoRollbackOnFailure: z
      .boolean()
      .default(true)
      .describe("Whether to rollback git changes if verification fails after all iterations"),
    provider: z
      .enum(["anthropic", "openai", "ollama"])
      .optional()
      .describe("LLM provider to use for generating fixes (defaults to auto-detect from ENV)"),
    model: z
      .string()
      .optional()
      .describe("Specific model name (e.g., 'claude-3-5-sonnet-20241022', 'gpt-4o', 'qwen2.5-coder')"),
    apiKey: z
      .string()
      .optional()
      .describe("API key for LLM provider (optional if configured in environment)"),
  },
  async (args) => {
    try {
      const result = await runSelfHealingLoop({
        projectPath: args.projectPath,
        verifyCommand: args.verifyCommand,
        task: args.task || "",
        targetFiles: args.targetFiles,
        maxIterations: args.maxIterations,
        autoRollbackOnFailure: args.autoRollbackOnFailure,
        llmConfig: {
          provider: args.provider,
          model: args.model,
          apiKey: args.apiKey,
        },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Self-healing error: ${(err as Error).message}`,
          },
        ],
      };
    }
  }
);

// Tool 2: Verify & Diagnose
server.tool(
  "verify_and_diagnose",
  "Executes a test/build/lint command and parses stdout/stderr into structured, actionable diagnostics with file and line numbers.",
  {
    projectPath: z.string().describe("Absolute directory path of the target project"),
    verifyCommand: z
      .string()
      .describe("Command to execute (e.g. 'npm test', 'npm run build', 'pytest', 'cargo check')"),
    timeoutMs: z
      .number()
      .optional()
      .default(60000)
      .describe("Execution timeout in milliseconds"),
  },
  async ({ projectPath, verifyCommand, timeoutMs }) => {
    try {
      const result = await runCommand(verifyCommand, projectPath, timeoutMs);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: result.exitCode === 0,
                exitCode: result.exitCode,
                durationMs: result.durationMs,
                diagnosticsCount: result.diagnostics.length,
                diagnostics: result.diagnostics,
                stdoutSnippet: result.stdout.slice(-1000),
                stderrSnippet: result.stderr.slice(-1000),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Execution failed: ${(err as Error).message}`,
          },
        ],
      };
    }
  }
);

// Tool 3: Git Checkpoint & Rollback
server.tool(
  "git_checkpoint",
  "Manages Git checkpoints, rolls back uncommitted changes, or gets the current diff.",
  {
    projectPath: z.string().describe("Absolute directory path of the Git project"),
    action: z
      .enum(["create", "rollback", "diff"])
      .describe("Action to perform: 'create' checkpoint, 'rollback' changes, or inspect 'diff'"),
  },
  async ({ projectPath, action }) => {
    try {
      if (action === "create") {
        const tag = await createCheckpoint(projectPath);
        return {
          content: [
            {
              type: "text",
              text: tag
                ? `Created git checkpoint tag: ${tag}`
                : "Project is not a git repository. Checkpoint skipped.",
            },
          ],
        };
      } else if (action === "rollback") {
        const ok = await rollbackChanges(projectPath);
        return {
          content: [
            {
              type: "text",
              text: ok
                ? "Successfully rolled back all modifications."
                : "Failed to rollback or directory is not a git repository.",
            },
          ],
        };
      } else {
        const diff = await getGitDiff(projectPath);
        return {
          content: [
            {
              type: "text",
              text: diff ? diff : "No changes detected (clean working tree).",
            },
          ],
        };
      }
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Git action error: ${(err as Error).message}`,
          },
        ],
      };
    }
  }
);

// Tool 4: Apply Safe Patch
server.tool(
  "apply_safe_patch",
  "Safely writes or updates a file in the project, automatically creating parent directories.",
  {
    projectPath: z.string().describe("Absolute directory path of the target project"),
    filePath: z.string().describe("Relative path to the file inside the project"),
    content: z.string().describe("Complete new file content"),
  },
  async ({ projectPath, filePath, content }) => {
    try {
      const fullPath = path.resolve(projectPath, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `Successfully wrote ${content.length} bytes to ${filePath}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to write file: ${(err as Error).message}`,
          },
        ],
      };
    }
  }
);

// Start Server with Stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  // Use stderr so we never corrupt the JSON-RPC stdio protocol
  console.error("Fatal error starting MCP Server:", error);
  process.exit(1);
});
