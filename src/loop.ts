import fs from "node:fs/promises";
import path from "node:path";
import { SelfHealingInput, SelfHealingResult, IterationRecord } from "./types.js";
import { runCommand } from "./executor.js";
import { createCheckpoint, rollbackChanges, getGitDiff } from "./git.js";
import { requestFixFromLLM } from "./llm.js";

export async function runSelfHealingLoop(input: SelfHealingInput): Promise<SelfHealingResult> {
  const {
    projectPath,
    task,
    verifyCommand,
    targetFiles = [],
    maxIterations = 3,
    autoRollbackOnFailure = true,
    llmConfig,
  } = input;

  await createCheckpoint(projectPath);
  const errorHistory: IterationRecord[] = [];

  // 1. Initial verification run
  let currentRun = await runCommand(verifyCommand, projectPath);

  // If already passing and no specific task modifications requested
  if (currentRun.exitCode === 0 && !task) {
    return {
      success: true,
      iterations: 0,
      finalExitCode: 0,
      errorHistory: [],
      gitDiff: "",
      summary: "Verification command already passing cleanly with exit code 0.",
    };
  }

  // 2. Iteration loop
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // If current run succeeded, we're done!
    if (currentRun.exitCode === 0) {
      const gitDiff = await getGitDiff(projectPath);
      return {
        success: true,
        iterations: iteration - 1,
        finalExitCode: 0,
        errorHistory,
        gitDiff,
        summary: `Self-healing succeeded after ${iteration - 1} repair iteration(s). Verification command '${verifyCommand}' passed with exit code 0.`,
      };
    }

    // Determine which files to inspect
    const filesToRead = new Set<string>(targetFiles);
    for (const d of currentRun.diagnostics) {
      if (d.file) {
        // Strip project path prefix if present
        const rel = path.isAbsolute(d.file) ? path.relative(projectPath, d.file) : d.file;
        filesToRead.add(rel);
      }
    }

    // Read current content of relevant files
    const fileContents: { path: string; content: string }[] = [];
    for (const relPath of filesToRead) {
      const fullPath = path.resolve(projectPath, relPath);
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        fileContents.push({ path: relPath, content });
      } catch {
        // File may be new or unreadable, ignore
      }
    }

    // Build prompt for the LLM
    const prompt = `Project Task:
${task || "Fix all compiler, linter, or test failures so that the verification command passes."}

Verification Command:
\`${verifyCommand}\`

Execution Exit Code: ${currentRun.exitCode}

Detected Diagnostics:
${
  currentRun.diagnostics.length > 0
    ? currentRun.diagnostics
        .map(
          (d) =>
            `- [${d.severity.toUpperCase()}] ${d.file || "unknown"}:${d.line || "?"}:${d.column || "?"} ${d.code || ""} ${d.message}`
        )
        .join("\n")
    : currentRun.stderr || currentRun.stdout.slice(-1000)
}

Relevant Files:
${fileContents
  .map(
    (f) => `### File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``
  )
  .join("\n\n")}

Please provide the corrected file contents to fix these errors.`;

    try {
      const fix = await requestFixFromLLM(prompt, llmConfig);

      // Apply the fixes
      const modifiedFiles: string[] = [];
      for (const file of fix.files) {
        const fullPath = path.resolve(projectPath, file.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content, "utf-8");
        modifiedFiles.push(file.path);
      }

      // Re-run the verification command
      const nextRun = await runCommand(verifyCommand, projectPath);

      errorHistory.push({
        iteration,
        diagnostics: currentRun.diagnostics,
        modifiedFiles,
        notes: fix.explanation,
      });

      currentRun = nextRun;

      if (currentRun.exitCode === 0) {
        const gitDiff = await getGitDiff(projectPath);
        return {
          success: true,
          iterations: iteration,
          finalExitCode: 0,
          errorHistory,
          gitDiff,
          summary: `Self-healing succeeded on iteration ${iteration}. All checks passed with exit code 0.`,
        };
      }
    } catch (err) {
      errorHistory.push({
        iteration,
        diagnostics: currentRun.diagnostics,
        modifiedFiles: [],
        notes: `LLM repair invocation failed: ${(err as Error).message}`,
      });
      break;
    }
  }

  // If we reached here, iterations exhausted without reaching exitCode 0
  const finalDiff = await getGitDiff(projectPath);
  if (autoRollbackOnFailure) {
    await rollbackChanges(projectPath);
  }

  return {
    success: false,
    iterations: maxIterations,
    finalExitCode: currentRun.exitCode,
    errorHistory,
    gitDiff: autoRollbackOnFailure ? "" : finalDiff,
    summary: `Self-healing exhausted ${maxIterations} iteration(s) without resolving errors.${
      autoRollbackOnFailure ? " Changes were safely rolled back." : ""
    }`,
  };
}
