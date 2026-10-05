import { runCommand } from "./executor.js";

export async function isGitRepo(projectPath: string): Promise<boolean> {
  const result = await runCommand("git rev-parse --is-inside-work-tree", projectPath, 5000);
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

export async function createCheckpoint(projectPath: string): Promise<string | null> {
  const isRepo = await isGitRepo(projectPath);
  if (!isRepo) return null;

  const checkpointTag = `mcp-heal-${Date.now()}`;
  // Stash any dirty changes or create a commit on a temporary branch/tag
  await runCommand(`git stash create`, projectPath, 5000);
  return checkpointTag;
}

export async function rollbackChanges(projectPath: string): Promise<boolean> {
  const isRepo = await isGitRepo(projectPath);
  if (!isRepo) return false;

  const resetResult = await runCommand("git checkout . && git clean -fd", projectPath, 10000);
  return resetResult.exitCode === 0;
}

export async function getGitDiff(projectPath: string): Promise<string> {
  const isRepo = await isGitRepo(projectPath);
  if (!isRepo) return "";

  const diffResult = await runCommand("git diff", projectPath, 5000);
  return diffResult.stdout;
}
