import { spawn } from "node:child_process";
import { ExecutionResult } from "./types.js";
import { parseDiagnostics } from "./parser.js";

export async function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number = 60000
): Promise<ExecutionResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Use bash or sh to execute the full command string
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000);
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
      // Cap at 500KB to prevent memory exhaustion
      if (stdout.length > 500000) {
        stdout = stdout.slice(-500000);
      }
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > 500000) {
        stderr = stderr.slice(-500000);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const exitCode = timedOut ? 124 : (code ?? 1);
      const durationMs = Date.now() - startTime;
      const combinedOutput = `${stdout}\n${stderr}`;
      const diagnostics = exitCode !== 0 ? parseDiagnostics(combinedOutput) : [];

      resolve({
        command,
        exitCode,
        stdout,
        stderr: timedOut ? `${stderr}\nCommand timed out after ${timeoutMs}ms` : stderr,
        durationMs,
        diagnostics,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: 1,
        stdout,
        stderr: `${stderr}\nProcess error: ${err.message}`,
        durationMs: Date.now() - startTime,
        diagnostics: [{ severity: "error", message: err.message, raw: err.message }],
      });
    });
  });
}
