#!/usr/bin/env node
/**
 * MCP 广场提交字段校验：README 里的「服务介绍」与「服务配置」。
 *
 * 为什么需要它：把本项目提交到 MCP 广场（魔搭 ModelScope 等）时，「从 GitHub 仓库快速创建」
 * 会**从仓库根 README 里按名字提取**这两段，且把它们当**强制校验字段** —— 解析不到就直接
 * 中断快速创建，只能改走「自定义创建」逐项手填。也就是说：这两段的标题名与内容一旦被
 * 顺手改掉（改名、挪位置、把 JSON 改成带注释的 jsonc），功能一切正常，但**提交会失败**，
 * 而且失败原因在仓库里看不出来。
 *
 * 这类「不影响功能、却直接出现在用户看得见的地方」的坑，本项目一贯用机械校验兜住
 * （参见 check-changelog.mjs / check-workflows.mjs）。已接入 `npm run ci`。
 *
 * 平台侧的硬性要求（摘自 https://www.modelscope.cn/docs/mcp/create）：
 *   1. 服务配置必须是 **STDIO** 类型，`command` 只能是 `npx` 或 `uvx`；
 *   2. `args` 里要有**包名**，不能是远程 URL、本地绝对路径或要求用户自己填的参数；
 *   3. JSON 代码块里**不能有注释**；
 *   4. 提供多个服务配置时，平台**只用第一个**。
 *
 * 用法：node scripts/check-mcp-manifest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 会被判为「平台解析不到」的标题写法：标题名必须与平台字段名逐字一致。 */
const REQUIRED_SECTIONS = ['服务介绍', '服务配置'];

/** 平台支持的 STDIO command。 */
const ALLOWED_COMMANDS = ['npx', 'uvx'];

const problems = [];

/**
 * 记录一个问题。
 * @param file 文件名
 * @param line 行号（1 起）；无行号时传 null
 * @param message 描述
 */
function report(file, line, message) {
  problems.push(line === null ? `${file}: ${message}` : `${file}:${line}: ${message}`);
}

/**
 * 去掉包名后面的版本 / tag（`@latest`、`@0.9.1` 等），只留包名。
 *
 * 注意**作用域包**：`@echo-note/gitea-toolkit-mcp` 开头的 `@` 是名字的一部分，
 * 只有它后面还有内容时才是 tag —— 直接 `split('@')[0]` 会把作用域名切掉。
 * @param spec 形如 `@scope/name@latest` 或 `name@latest`
 */
function stripVersionTag(spec) {
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}

const readmePath = path.join(projectRoot, 'README.md');
if (!fs.existsSync(readmePath)) {
  console.error('[check-mcp-manifest] 未找到 README.md');
  process.exit(1);
}
const lines = fs.readFileSync(readmePath, 'utf8').split('\n');

/**
 * 找标题所在行（标题级别不限，但整行必须只有该标题名）。
 * @param name 标题名
 * @returns 0 起的行索引；找不到返回 -1
 */
function findHeading(name) {
  return lines.findIndex((line) => new RegExp(`^#{2,4}\\s*${name}\\s*$`).test(line.trim()));
}

const indices = {};
for (const name of REQUIRED_SECTIONS) {
  const index = findHeading(name);
  indices[name] = index;
  if (index === -1) {
    report(
      'README.md',
      null,
      `缺少「${name}」小节（标题必须就是这个字段名）。MCP 广场把它当强制校验字段，` +
        '解析不到会中断「从 GitHub 仓库快速创建」。',
    );
  }
}

// 1. 服务介绍不能是空壳：标题之后、下一个标题之前要有正文
const introIndex = indices['服务介绍'];
if (introIndex !== -1) {
  const body = [];
  for (let i = introIndex + 1; i < lines.length; i++) {
    if (/^#{2,4}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  // 去掉引用块与空行后仍有内容才算非空（引用块常用于写「不要改标题」的提示）
  const meaningful = body
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('>'));
  if (meaningful.length === 0) {
    report('README.md', introIndex + 1, '「服务介绍」为空，平台会判定解析失败（它是强制校验字段）。');
  }
}

// 2. 服务配置：取该小节里第一个 ```json 代码块，按平台要求逐条校验
const configIndex = indices['服务配置'];
if (configIndex !== -1) {
  let fenceStart = -1;
  for (let i = configIndex + 1; i < lines.length; i++) {
    if (/^#{2,4}\s/.test(lines[i])) break;
    if (/^```json\s*$/.test(lines[i].trim())) {
      fenceStart = i;
      break;
    }
  }

  if (fenceStart === -1) {
    report('README.md', configIndex + 1, '「服务配置」里没有 ```json 代码块，平台解析不到服务配置。');
  } else {
    let fenceEnd = -1;
    for (let i = fenceStart + 1; i < lines.length; i++) {
      if (/^```\s*$/.test(lines[i].trim())) {
        fenceEnd = i;
        break;
      }
    }
    if (fenceEnd === -1) {
      report('README.md', fenceStart + 1, '```json 代码块没有闭合。');
    } else {
      const raw = lines.slice(fenceStart + 1, fenceEnd).join('\n');
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        report(
          'README.md',
          fenceStart + 1,
          `服务配置不是合法 JSON：${error.message}。` +
            '注意平台不支持 JSON 里写注释，也无法解析带注释的 jsonc。',
        );
      }

      const servers = parsed?.mcpServers;
      if (parsed && (!servers || typeof servers !== 'object' || Object.keys(servers).length === 0)) {
        report('README.md', fenceStart + 1, '服务配置里没有 mcpServers。');
      } else if (parsed) {
        // 平台只用第一个服务配置，所以只校验第一个
        const [name, server] = Object.entries(servers)[0];
        const where = `mcpServers.${name}`;

        if (!ALLOWED_COMMANDS.includes(server.command)) {
          report(
            'README.md',
            fenceStart + 1,
            `${where}：command 是 ${JSON.stringify(server.command)}，` +
              `平台只支持 ${ALLOWED_COMMANDS.join(' / ')}。`,
          );
        }

        const args = Array.isArray(server.args) ? server.args : [];
        /**
         * 判断某个 arg 看起来是不是包名。
         *
         * ⚠️ 必须排除**短横线开头的开关**：`npx -y <包名>` 里的 `-y` 完全符合
         * 「不是路径、不是 URL」的特征，会被误认成包名（本脚本第一版就栽在这，
         * 导致正向场景误报）。同时排除远程 URL 与本地路径。
         */
        const looksLikePackage = (value) =>
          typeof value === 'string' &&
          value.length > 0 &&
          !value.startsWith('-') &&
          !value.startsWith('/') &&
          !value.startsWith('~') &&
          !value.startsWith('.') &&
          !/^https?:\/\//.test(value);
        const packageArg = args.find(looksLikePackage);

        if (!packageArg) {
          report('README.md', fenceStart + 1, `${where}：args 里找不到包名（平台要从 args 取包名去装）。`);
        } else {
          // 包名必须与仓库里真实的包名一致（否则平台装不到包）
          const npxName = JSON.parse(
            fs.readFileSync(path.join(projectRoot, 'packages/mcp-server/package.json'), 'utf8'),
          ).name;
          const pyproject = fs.readFileSync(path.join(projectRoot, 'python/pyproject.toml'), 'utf8');
          const uvxName = /^name\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1];
          const expected = server.command === 'uvx' ? uvxName : npxName;
          const declared = stripVersionTag(packageArg);

          if (expected && declared !== expected) {
            report(
              'README.md',
              fenceStart + 1,
              `${where}：args 里的包名是 ${JSON.stringify(packageArg)}，` +
                `但真实包名是 ${JSON.stringify(expected)}（${server.command === 'uvx' ? 'python/pyproject.toml' : 'packages/mcp-server/package.json'}）。`,
            );
          }
        }

        if (args.some((arg) => typeof arg === 'string' && (arg.startsWith('/') || arg.startsWith('~')))) {
          report('README.md', fenceStart + 1, `${where}：args 里有本地绝对路径，平台无法安装。`);
        }

        const env = server.env && typeof server.env === 'object' ? server.env : {};
        if (!Object.keys(env).length) {
          report(
            'README.md',
            fenceStart + 1,
            `${where}：没有 env。平台会从 env 提取环境变量配置，` +
              '我们的 GITEA_TOKEN / GITEA_SERVER_URL 应当写在这里。',
          );
        } else if (!('GITEA_TOKEN' in env)) {
          report('README.md', fenceStart + 1, `${where}：env 里缺 GITEA_TOKEN，用户接不上自己的实例。`);
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`[check-mcp-manifest] 发现 ${problems.length} 个问题：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('[check-mcp-manifest] 校验通过（服务介绍 / 服务配置 齐全，且可被 MCP 广场解析）');
