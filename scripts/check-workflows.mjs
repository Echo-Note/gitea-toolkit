#!/usr/bin/env node
/**
 * GitHub Actions workflow 静态校验。
 *
 * 为什么需要它：workflow 的问题往往在**推送之后**才暴露（YAML 缩进错了 → 整个 workflow
 * 静默不执行；内嵌 shell/JS 语法错了 → 运行到那一步才失败）。本脚本在本地与 CI 里
 * 提前拦住这些错误：
 *
 *   1. YAML 语法（解析失败即报错）
 *   2. 结构约束：必须有 on / jobs；每个 job 必须有 runs-on；每个 uses 必须形如 owner/repo@ref
 *   3. 内嵌 shell（`run:`）用 `bash -n` 校验语法
 *   4. 内嵌 github-script（`with.script`）包进 async 函数后用 `node --check` 校验语法
 *   5. 显式声明 permissions 的 job 若调用了 GitHub REST API，提示可能缺少对应 scope
 *
 * 用法：node scripts/check-workflows.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDir = path.join(projectRoot, '.github', 'workflows');

/** 收集到的问题。 */
const problems = [];

/**
 * 记录一个问题。
 * @param file 文件名
 * @param message 描述
 */
function report(file, message) {
  problems.push(`${file}: ${message}`);
}

/**
 * 用外部命令校验一段文本的语法。
 * @param command 命令
 * @param args 命令参数（最后一个元素为文件路径占位）
 * @param content 待校验内容
 * @param suffix 临时文件后缀
 * @returns 错误信息；通过时返回 undefined
 */
function checkSyntax(command, args, content, suffix) {
  const file = path.join(os.tmpdir(), `wf-check-${process.pid}-${Math.random().toString(36).slice(2)}${suffix}`);
  fs.writeFileSync(file, content, 'utf8');
  try {
    const result = spawnSync(command, [...args, file], { encoding: 'utf8' });
    if (result.status === 0) {
      return undefined;
    }
    return (result.stderr || result.stdout || '未知错误').split('\n').slice(0, 4).join('\n').trim();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * 遍历 workflow 中的全部步骤。
 * @param doc 解析后的 workflow 文档
 * @returns 步骤列表（含所属 job 名）
 */
function* iterateSteps(doc) {
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      yield { jobName, job, step };
    }
  }
}

/**
 * 校验单个 workflow 文件。
 * @param filePath 文件绝对路径
 */
function checkWorkflow(filePath) {
  const fileName = path.basename(filePath);
  const source = fs.readFileSync(filePath, 'utf8');

  let doc;
  try {
    doc = parse(source);
  } catch (error) {
    report(fileName, `YAML 解析失败：${error.message.split('\n')[0]}`);
    return;
  }

  if (!doc || typeof doc !== 'object') {
    report(fileName, '内容为空或不是对象');
    return;
  }
  // YAML 会把裸 on: 解析成布尔键 true，这里两种写法都接受
  if (!doc.on && !doc.true) {
    report(fileName, '缺少 on 触发器声明');
  }
  if (!doc.jobs || Object.keys(doc.jobs).length === 0) {
    report(fileName, '缺少 jobs');
  }

  let shellCount = 0;
  let scriptCount = 0;

  for (const { jobName, job, step } of iterateSteps(doc)) {
    if (!job['runs-on']) {
      report(fileName, `job「${jobName}」缺少 runs-on`);
    }

    if (typeof step.uses === 'string') {
      if (!/^[\w.-]+\/[\w.-]+@[\w.-]+$/.test(step.uses)) {
        report(fileName, `job「${jobName}」的 uses 格式不合法：${step.uses}`);
      }
    } else if (typeof step.run !== 'string') {
      report(fileName, `job「${jobName}」存在既无 uses 也无 run 的步骤：${step.name ?? '(未命名)'}`);
    }

    if (typeof step.run === 'string' && step.run.trim().length > 0) {
      shellCount += 1;
      const error = checkSyntax('bash', ['-n'], `${step.run}\n`, '.sh');
      if (error) {
        report(fileName, `job「${jobName}」步骤「${step.name ?? '(未命名)'}」的 shell 语法错误：${error}`);
      }
    }

    const usesGithubScript = typeof step.uses === 'string' && step.uses.startsWith('actions/github-script@');
    if (usesGithubScript) {
      const script = step.with?.script;
      if (typeof script !== 'string' || script.trim().length === 0) {
        report(fileName, `job「${jobName}」的 github-script 步骤缺少 with.script`);
      } else {
        scriptCount += 1;
        // github-script 会把脚本包进 async 函数，因此顶层 await 合法；这里同样包一层再校验语法
        const wrapped = `(async () => {\n${script}\n})().catch(() => {});\n`;
        const error = checkSyntax('node', ['--check'], wrapped, '.js');
        if (error) {
          report(fileName, `job「${jobName}」的 github-script 语法错误：${error}`);
        }

        // 权限提示：显式声明 permissions 后未列出的 scope 会被置为 none
        const explicit = job.permissions ?? doc.permissions;
        if (explicit && typeof explicit === 'object') {
          const needsActionsRead = /github\.rest\.actions\./.test(script) || /github\.paginate\(\s*github\.rest\.actions\./.test(script);
          if (needsActionsRead && explicit.actions !== 'read' && explicit.actions !== 'write') {
            report(
              fileName,
              `job「${jobName}」调用了 actions REST API 但 permissions 未包含 actions: read（显式声明后未列出的 scope 为 none，会 403）`,
            );
          }
          const needsIssuesWrite = /github\.rest\.issues\.(create|update|createComment|createLabel)/.test(script);
          if (needsIssuesWrite && explicit.issues !== 'write') {
            report(fileName, `job「${jobName}」需要写 issue 但 permissions 未包含 issues: write`);
          }
        }
      }
    }
  }

  console.log(`  ${fileName.padEnd(16)} job ${Object.keys(doc.jobs).length} 个｜shell ${shellCount} 段｜内嵌脚本 ${scriptCount} 段`);
}

function main() {
  if (!fs.existsSync(workflowsDir)) {
    // 没有 workflow 目录不算错误（例如只装了扩展本体）
    console.log('[check-workflows] 未找到 .github/workflows，跳过');
    return;
  }
  const files = fs
    .readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => path.join(workflowsDir, name));

  if (files.length === 0) {
    console.log('[check-workflows] 没有 workflow 文件，跳过');
    return;
  }

  console.log(`[check-workflows] 校验 ${files.length} 个 workflow`);
  for (const file of files) {
    checkWorkflow(file);
  }

  if (problems.length > 0) {
    console.error('\n[check-workflows] 发现以下问题：');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }
  console.log('[check-workflows] 校验通过');
}

main();
