import { Diagnostic } from "./types.js";

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
}

export function parseDiagnostics(output: string): Diagnostic[] {
  const clean = stripAnsi(output);
  const lines = clean.split("\n");
  const diagnostics: Diagnostic[] = [];

  // Patterns for different compilers and test runners
  // 1. TypeScript / ESLint: src/file.ts(10,5): error TS2322: Type 'string' is not assignable...
  const tsPattern1 = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*([A-Za-z0-9]+)?:\s*(.+)$/i;

  // 2. TypeScript standard: src/file.ts:10:5 - error TS2322: Type...
  const tsPattern2 = /^(.+?):(\d+):(\d+)\s*-\s*(error|warning)\s*([A-Za-z0-9]+)?:\s*(.+)$/i;

  // 3. Python traceback / pytest: File ".../file.py", line 12, in ...
  const pyPattern = /File\s+"([^"]+)",\s*line\s*(\d+)(?:,\s*in\s*(.+))?/i;

  // 4. Go compiler: file.go:12:5: undefined: foo
  const goPattern = /^(.+?\.go):(\d+):(\d+):\s*(.+)$/i;

  // 5. Rust compiler: --> src/file.rs:12:5
  const rustPattern = /-->\s*(.+?):(\d+):(\d+)/i;

  // 6. Jest / Vitest: ✕ test name or FAIL path/to/file.test.ts
  const testFailPattern = /FAIL\s+(.+)$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let match = line.match(tsPattern1);
    if (match) {
      diagnostics.push({
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: match[4].toLowerCase().includes("warn") ? "warning" : "error",
        code: match[5] || undefined,
        message: match[6].trim(),
        raw: line,
      });
      continue;
    }

    match = line.match(tsPattern2);
    if (match) {
      diagnostics.push({
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: match[4].toLowerCase().includes("warn") ? "warning" : "error",
        code: match[5] || undefined,
        message: match[6].trim(),
        raw: line,
      });
      continue;
    }

    match = line.match(pyPattern);
    if (match) {
      // Look ahead for the error message in the next few lines
      let msg = match[3] || "Python Exception";
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const next = lines[j].trim();
        if (next && (next.endsWith("Error:") || next.includes("Error:") || next.includes("Exception:"))) {
          msg = next;
          break;
        }
      }
      diagnostics.push({
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        severity: "error",
        message: msg,
        raw: line,
      });
      continue;
    }

    match = line.match(goPattern);
    if (match) {
      diagnostics.push({
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: "error",
        message: match[4].trim(),
        raw: line,
      });
      continue;
    }

    match = line.match(rustPattern);
    if (match) {
      // Find the message above or below
      const prev = i > 0 ? lines[i - 1].trim() : "";
      diagnostics.push({
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: "error",
        message: prev || "Rust compiler error",
        raw: line,
      });
      continue;
    }

    match = line.match(testFailPattern);
    if (match) {
      diagnostics.push({
        file: match[1].trim(),
        severity: "error",
        message: `Test suite failed in ${match[1].trim()}`,
        raw: line,
      });
      continue;
    }

    // 7. Node.js stack / standard exceptions: [eval]:1 or file.js:10
    const nodePattern = /^([^\s:]+\.[a-zA-Z0-9]+|\[[a-zA-Z0-9_-]+\]):(\d+)(?::(\d+))?$/i;
    match = line.match(nodePattern);
    if (match) {
      // Find following error message like SyntaxError or TypeError
      let msg = "Runtime execution error";
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const next = lines[j].trim();
        if (next && (/Error:/.test(next) || /Exception:/.test(next))) {
          msg = next;
          break;
        }
      }
      diagnostics.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: match[3] ? parseInt(match[3], 10) : undefined,
        severity: "error",
        message: msg,
        raw: line,
      });
      continue;
    }
  }

  // Fallback: If no structured diagnostics matched but output contains error keywords, capture lines
  if (diagnostics.length === 0) {
    const errorLines = lines.filter((l) =>
      /(error|exception|failed|failure|fatal)/i.test(l) &&
      !l.startsWith("info") &&
      !l.startsWith("debug")
    );
    for (const el of errorLines.slice(0, 10)) {
      diagnostics.push({
        severity: "error",
        message: el.trim(),
        raw: el.trim(),
      });
    }
  }

  return diagnostics;
}
