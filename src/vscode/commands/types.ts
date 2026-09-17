/**
 * 命令层共享类型。
 */
import type * as vscode from 'vscode';
import type { GiteaService } from '../service';
import type { IssuesProvider } from '../views/issuesProvider';
import type { NotificationsProvider } from '../views/notificationsProvider';
import type { PullsProvider } from '../views/pullsProvider';
import type { ReposProvider } from '../views/reposProvider';

/** 命令处理器签名。 */
export type CommandHandler = (...args: unknown[]) => unknown | Promise<unknown>;

/** 以命令 ID 为键的处理器集合。 */
export type CommandMap = Record<string, CommandHandler>;

/** 视图提供者集合。 */
export interface ProviderBundle {
  repos: ReposProvider;
  issues: IssuesProvider;
  pulls: PullsProvider;
  notifications: NotificationsProvider;
}

/** 命令层依赖。 */
export interface CommandDeps {
  /** 扩展上下文。 */
  context: vscode.ExtensionContext;
  /** Gitea 服务。 */
  service: GiteaService;
  /** 视图提供者。 */
  providers: ProviderBundle;
}
