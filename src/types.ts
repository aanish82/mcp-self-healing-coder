export interface Diagnostic {
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
  severity: "error" | "warning";
  raw: string;
}

export interface ExecutionResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  diagnostics: Diagnostic[];
}

export interface LLMConfig {
  provider?: "anthropic" | "openai" | "ollama";
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface SelfHealingInput {
  projectPath: string;
  task: string;
  verifyCommand: string;
  targetFiles?: string[];
  maxIterations?: number;
  autoRollbackOnFailure?: boolean;
  llmConfig?: LLMConfig;
}

export interface IterationRecord {
  iteration: number;
  diagnostics: Diagnostic[];
  modifiedFiles: string[];
  notes?: string;
}

export interface SelfHealingResult {
  success: boolean;
  iterations: number;
  finalExitCode: number;
  errorHistory: IterationRecord[];
  gitDiff: string;
  summary: string;
}
