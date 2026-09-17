/**
 * Git 命令封装（VS Code 侧）。
 *
 * 使用 `execFile` 直接调用 git，避免依赖内置 Git 扩展的内部行为，
 * 同时保证命令可预期、出错信息可回传。
 */
import { execFile } from 'node:child_process';
import * as vscode from 'vscode';

/** git 命令执行结果。 */
export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * 在当前工作区根目录执行一条 git 命令。
 * @param args git 参数
 * @returns 执行结果
 */
export async function runGit(args: string[]): Promise<GitResult> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return runGitIn(cwd, args);
}

/**
 * 在指定目录执行 git 命令。
 * @param cwd 工作目录；未提供时使用进程当前目录
 * @param args git 参数
 * @returns 执行结果
 */
export function runGitIn(cwd: string | undefined, args: string[]): Promise<GitResult> {
  return new Promise<GitResult>((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
      resolve({ exitCode, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

/**
 * 判断当前工作区是否处于 git 仓库中。
 * @returns 是否为 git 仓库
 */
export async function isGitRepository(): Promise<boolean> {
  const result = await runGit(['rev-parse', '--is-inside-work-tree']);
  return result.exitCode === 0 && result.stdout.trim() === 'true';
}
