/**
 * 扩展侧 Gitea 服务。
 *
 * 负责：按当前配置/令牌构造客户端、缓存会话信息（当前用户、默认仓库）、
 * 以及在配置或令牌变化时失效缓存并通知视图刷新。
 */
import * as vscode from 'vscode';
import { GiteaConfigError } from '../core/errors';
import { createGitea } from '../core/index';
import { parseGiteaRemote, type RepoRef } from '../core/repoRef';
import type { GiteaOperations } from '../core/operations';
import type { GiteaUser } from '../core/types';
import type { GiteaToolContext } from '../ai/tools/types';
import {
  buildClientOptions,
  buildUserAgent,
  getToken,
  onSettingsChanged,
  readSettings,
  TOKEN_SECRET_KEY,
} from './config';
import { logDebug, logWarn } from './logger';

/** 内置 Git 扩展的最小结构化类型（@types/vscode 未包含）。 */
interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: { remotes: GitRemote[] };
}

interface GitApi {
  repositories: GitRepository[];
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

/** 令牌 / 配置变化事件源。 */
export class GiteaService implements vscode.Disposable {
  private cachedClient: ReturnType<typeof createGitea> | undefined;
  private cachedUser: GiteaUser | undefined;
  private cachedVersion: { version: string } | undefined;
  private cachedDefaultRepo: RepoRef | null | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  /** 令牌或配置发生变化时触发，供视图刷新。 */
  public readonly onDidChange: vscode.Event<void> = this.changeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      this.changeEmitter,
      this.context.secrets.onDidChange((event) => {
        if (event.key === TOKEN_SECRET_KEY) {
          this.invalidate();
          this.changeEmitter.fire();
        }
      }),
      onSettingsChanged(() => {
        this.invalidate();
        this.changeEmitter.fire();
      }),
    );
  }

  /**
   * 当前是否已具备最小可用配置（实例地址 + 令牌）。
   * @returns 是否可用
   */
  public async isReady(): Promise<boolean> {
    const settings = readSettings();
    if (settings.serverUrl.length === 0) {
      return false;
    }
    return (await getToken(this.context)) !== undefined;
  }

  /**
   * 读取访问令牌。
   * @returns 令牌或 undefined
   */
  public getToken(): Thenable<string | undefined> {
    return getToken(this.context);
  }

  /**
   * 获取 Gitea 操作集合（带缓存）。
   * @returns 操作集合
   * @throws GiteaConfigError 未配置实例地址或令牌时抛出
   */
  public async getOperations(): Promise<GiteaOperations> {
    return (await this.ensureClient()).operations;
  }

  /**
   * 获取当前用户信息（带缓存）。
   * @param force 是否强制刷新
   * @returns 当前用户
   */
  public async getCurrentUser(force = false): Promise<GiteaUser> {
    if (this.cachedUser && !force) {
      return this.cachedUser;
    }
    const { operations } = await this.ensureClient();
    this.cachedUser = await operations.misc.getCurrentUser();
    return this.cachedUser;
  }

  /**
   * 读取服务端 Gitea 版本（带缓存）。
   * @param force 是否强制刷新
   * @returns 版本信息
   */
  public async getGiteaVersion(force = false): Promise<{ version: string }> {
    if (this.cachedVersion && !force) {
      return this.cachedVersion;
    }
    const { operations } = await this.ensureClient();
    this.cachedVersion = await operations.misc.getVersion();
    return this.cachedVersion;
  }

  /**
   * 解析当前工作区对应的 Gitea 仓库（依据 git origin 远端）。
   * 扩展 UI 与 AI 工具均依赖该结果实现「免传 owner/repo」。
   * @param force 是否强制重新解析
   * @returns 仓库坐标；无法解析时返回 undefined
   */
  public async getDefaultRepo(force = false): Promise<RepoRef | undefined> {
    if (this.cachedDefaultRepo !== undefined && !force) {
      return this.cachedDefaultRepo ?? undefined;
    }
    const settings = readSettings();
    const resolved = await this.tryResolveFromGit(settings.serverUrl);
    if (!resolved) {
      logDebug('未能从 git 远端解析出 Gitea 仓库坐标');
    }
    this.cachedDefaultRepo = resolved ?? null;
    return resolved;
  }

  /**
   * 构造 AI 工具执行上下文。
   * @returns 工具上下文
   */
  public async createToolContext(): Promise<GiteaToolContext> {
    const { operations } = await this.ensureClient();
    return {
      operations,
      defaultRepo: await this.getDefaultRepo(),
      openExternal: async (url: string) => {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      },
    };
  }

  /**
   * 清空缓存（令牌或配置变化时调用）。
   */
  public invalidate(): void {
    this.cachedClient = undefined;
    this.cachedUser = undefined;
    this.cachedVersion = undefined;
    this.cachedDefaultRepo = undefined;
  }

  /** 释放资源。 */
  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  /**
   * 获取或惰性构造客户端。
   * @returns 客户端与操作集合
   */
  private async ensureClient(): Promise<ReturnType<typeof createGitea>> {
    if (this.cachedClient) {
      return this.cachedClient;
    }
    const settings = readSettings();
    if (settings.serverUrl.length === 0) {
      throw new GiteaConfigError('未配置 Gitea 实例地址，请在设置中填写 gitea.serverUrl');
    }
    const token = await getToken(this.context);
    if (!token) {
      throw new GiteaConfigError('尚未设置访问令牌，请执行「Gitea: 设置访问令牌」');
    }
    this.cachedClient = createGitea(buildClientOptions(token, buildUserAgent(this.context)));
    return this.cachedClient;
  }

  /**
   * 借助内置 Git 扩展读取 origin 远端并解析仓库坐标。
   * @param serverUrl 已配置的实例地址
   * @returns 仓库坐标或 undefined
   */
  private async tryResolveFromGit(serverUrl: string): Promise<RepoRef | undefined> {
    if (serverUrl.length === 0) {
      return undefined;
    }
    try {
      const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (!gitExtension) {
        return undefined;
      }
      const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
      const repositories = git.getAPI(1).repositories;
      for (const repository of repositories) {
        const origin = repository.state.remotes.find((remote) => remote.name === 'origin');
        const remoteUrl = origin?.fetchUrl ?? origin?.pushUrl;
        if (!remoteUrl) {
          continue;
        }
        const parsed = parseGiteaRemote(remoteUrl, serverUrl);
        if (parsed) {
          return parsed;
        }
      }
    } catch (error) {
      logWarn('读取 git 远端失败', error);
    }
    return undefined;
  }
}
