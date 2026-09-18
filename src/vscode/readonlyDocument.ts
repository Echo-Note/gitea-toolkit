/**
 * 只读「虚拟文档」：把任意文本以**只读编辑器标签**的形式打开。
 *
 * 为什么用平台能力，而不是自己实现一套查看器：
 *
 * - **只读由 VS Code 保证**。`TextDocumentContentProvider` 的文档由平台标记为 readonly
 *   （`@types/vscode` 原文：*allows to add **readonly documents** to the editor*，
 *   以及 *The editor will use the returned string-content to create a readonly document*）——
 *   不会变「未保存」、关闭时不会问「是否保存」。我们既不需要、也不应该自己做只读控制。
 * - **标签标题与语言同样由平台从 URI 推导**：路径最后一段是什么文件名，标签就显示什么；
 *   扩展名是 `.yml` 就按 YAML 处理。因此连高亮都不用写 —— 只在需要时用
 *   `setTextDocumentLanguage()` 明确指定一次（自定义 scheme 不保证能按扩展名推断）。
 * - 编辑器自带的查找/替换、并排对比、复制、折叠全部免费可用。
 *
 * 对照两种退化做法：
 * - `openTextDocument({ content })`：生成 `Untitled-1`，占标签且关闭时要问「是否保存」
 * - 输出面板：不占标签，但没有查找/替换、不能并排 diff、同一时刻只能看一份
 */
import * as vscode from 'vscode';

/** 本扩展占用的 URI scheme。一个 scheme 只能注册一个提供器。 */
export const SCHEME = 'gitea-view';

/**
 * 已生成的内容，键为 `uri.toString()`。
 *
 * 内容**在打开之前**就放进来，`provideTextDocumentContent` 只做同步读取 ——
 * 这样打开是原子的，不会出现「先开空白再填内容」的闪动，
 * 也让提供器不必自己处理异步与异常。
 */
const contents = new Map<string, string>();

/** 内容变更通知：重新生成同一份文档时用它让已打开的编辑器刷新内容。 */
const changeEmitter = new vscode.EventEmitter<vscode.Uri>();

/**
 * 注册虚拟文档提供器。扩展激活时调用一次。
 * @param context 扩展上下文（用于登记销毁）
 */
export function registerReadonlyDocuments(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      onDidChange: changeEmitter.event,
      provideTextDocumentContent: (uri) => contents.get(uri.toString()) ?? '',
    }),
    changeEmitter,
  );
}

/**
 * 构造虚拟文档 URI。
 *
 * 路径的**最后一段**决定标签标题与语言高亮，所以调用方要把「文件名」放在最后
 * （例如 `ci.yml`、`build.log`）；前面的目录段用于区分来源，会出现在悬停提示里。
 * @param segments 路径段，最后一段为文件名
 * @returns 虚拟文档 URI
 */
export function buildUri(segments: string[]): vscode.Uri {
  return vscode.Uri.from({
    scheme: SCHEME,
    path: `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`,
  });
}

/**
 * 打开一份只读文档；同一 URI 已打开时刷新内容并聚焦，不会新开标签。
 * @param segments 路径段，最后一段为文件名（决定标题与高亮）
 * @param content 文本内容
 * @param languageId 语言 id；省略时交由平台按扩展名推断
 * @returns 打开的文档
 */
export async function openReadonlyDocument(
  segments: string[],
  content: string,
  languageId?: string,
): Promise<vscode.TextDocument> {
  const uri = buildUri(segments);
  contents.set(uri.toString(), content);
  // 文档已经打开过时，openTextDocument 会直接返回缓存的文档对象，
  // 必须靠 onDidChange 通知它重新向提供器取内容，否则看到的还是上一次的内容。
  changeEmitter.fire(uri);
  const document = await vscode.workspace.openTextDocument(uri);
  if (languageId && document.languageId !== languageId) {
    return vscode.languages.setTextDocumentLanguage(document, languageId);
  }
  return document;
}

/**
 * 把标题里不适合当文件名的字符换掉并限长。
 *
 * 作业名常带括号、逗号、空格且很长（例如 `build (AWS ECR, …, remote)`），
 * 直接拿来当文件名会让标签又长又难读。
 * @param title 原始标题
 * @param maxLength 最大长度，默认 60
 * @returns 可用作文件名片段的字符串
 */
export function safeFileName(title: string, maxLength = 60): string {
  const cleaned = Array.from(title)
    // 控制字符用码点判断，而不是写进正则字符类 —— 后者会触发 no-control-regex
    .map((char) => (/[\\/:*?"<>|]/.test(char) || (char.codePointAt(0) ?? 0) < 32 ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const base = cleaned.length > 0 ? cleaned : 'untitled';
  return base.length > maxLength ? `${base.slice(0, maxLength - 1)}…` : base;
}
