/**
 * Gitea Actions 相关的 API 操作。
 *
 * 路径与字段依据实例的 `/swagger.v1.json` 逐一核对（Gitea 1.26.4）。
 *
 * 两处能力边界值得记住：
 *   - **没有「取消运行」接口**。Gitea 1.26.4 只提供 `rerun` / `rerun-failed-jobs`，
 *     以及 `DELETE /actions/runs/{run}`（那是**删除记录**，语义完全不同，不要当成取消）。
 *   - 作业**日志**由 `/actions/jobs/{job_id}/logs` 返回**纯文本**，必须走 `responseType: 'text'`，
 *     否则 JSON 解析会直接失败。
 */
import { GiteaApiError } from '../errors';
import type { GiteaClient } from '../giteaClient';
import type {
  GiteaActionArtifact,
  GiteaActionWorkflow,
  GiteaActionWorkflowJob,
  GiteaActionWorkflowRun,
  GiteaListResult,
} from '../types';

/** 工作流列表查询参数。 */
export interface ListWorkflowsOptions {
  owner: string;
  repo: string;
}

/** 运行记录列表查询参数。 */
export interface ListActionRunsOptions {
  owner: string;
  repo: string;
  /** 触发事件，如 `push` / `pull_request` / `workflow_dispatch` / `schedule`。 */
  event?: string;
  /** 分支过滤。 */
  branch?: string;
  /** 状态过滤，如 `success` / `failure` / `running` / `waiting`。 */
  status?: string;
  /** 触发者用户名过滤。 */
  actor?: string;
  /** 提交 SHA 过滤。 */
  headSha?: string;
  page?: number;
  limit?: number;
}

/** 触发工作流参数。 */
export interface DispatchWorkflowOptions {
  owner: string;
  repo: string;
  /** 工作流 ID（数字或文件名），如 `ci.yml`。 */
  workflowId: string;
  /** 目标引用：分支名 / 标签名 / 提交 SHA。 */
  ref: string;
  /** 传给工作流的输入，对应 `workflow_dispatch` 声明的 `inputs`。 */
  inputs?: Record<string, string>;
}

/** 运行产物列表查询参数。 */
export interface ListArtifactsOptions {
  owner: string;
  repo: string;
  /** 按产物名精确过滤。 */
  name?: string;
  page?: number;
  limit?: number;
}

/** `GET /actions/workflows` 的响应包装。 */
interface WorkflowsResponse {
  total_count?: number;
  workflows?: GiteaActionWorkflow[];
}

/** `GET /actions/runs` 的响应包装。 */
interface RunsResponse {
  total_count?: number;
  workflow_runs?: GiteaActionWorkflowRun[];
}

/** `GET /actions/runs/{run}/jobs` 的响应包装。 */
interface JobsResponse {
  total_count?: number;
  jobs?: GiteaActionWorkflowJob[];
}

/** `GET /actions/artifacts` 的响应包装。 */
interface ArtifactsResponse {
  total_count?: number;
  artifacts?: GiteaActionArtifact[];
}

/**
 * Actions 操作集合。
 */
export class ActionOperations {
  constructor(private readonly client: GiteaClient) {}

  /**
   * 列出仓库的全部工作流。
   * @param options 查询参数
   * @returns 工作流数组
   */
  public async listWorkflows(options: ListWorkflowsOptions): Promise<GiteaActionWorkflow[]> {
    const response = await this.client.request<WorkflowsResponse>(
      'GET',
      actionsPath(options.owner, options.repo, '/workflows'),
    );
    return response.workflows ?? [];
  }

  /**
   * 启用或禁用一个工作流。
   * @param owner 所属者
   * @param repo 仓库名
   * @param workflowId 工作流 ID 或文件名
   * @param enabled 是否启用
   */
  public async setWorkflowEnabled(
    owner: string,
    repo: string,
    workflowId: string,
    enabled: boolean,
  ): Promise<void> {
    const action = enabled ? 'enable' : 'disable';
    await this.client.request<unknown>(
      'PUT',
      actionsPath(owner, repo, `/workflows/${enc(workflowId)}/${action}`),
    );
  }

  /**
   * 触发一次 `workflow_dispatch`。
   *
   * 注意：只有声明了 `on: workflow_dispatch` 的工作流才能被触发，否则服务端会报错。
   * @param options 触发参数
   */
  public async dispatchWorkflow(options: DispatchWorkflowOptions): Promise<void> {
    const body: Record<string, unknown> = { ref: options.ref };
    if (options.inputs && Object.keys(options.inputs).length > 0) {
      body.inputs = options.inputs;
    }
    await this.client.request<unknown>(
      'POST',
      actionsPath(options.owner, options.repo, `/workflows/${enc(options.workflowId)}/dispatches`),
      { body },
    );
  }

  /**
   * 列出运行记录。
   * @param options 查询参数
   * @returns 运行记录与分页信息
   */
  public async listRuns(
    options: ListActionRunsOptions,
  ): Promise<GiteaListResult<GiteaActionWorkflowRun>> {
    // 走 requestPaged：服务端单页上限为 max_response_items（默认 50），
    // 想要更多必须真的翻页，只调大 limit 会被静默截断。
    return this.client.requestPaged<GiteaActionWorkflowRun>(
      'GET',
      actionsPath(options.owner, options.repo, '/runs'),
      {
        limit: options.limit ?? 30,
        startPage: options.page ?? 1,
        extract: (data) => (data as RunsResponse | undefined)?.workflow_runs ?? [],
        query: {
          event: options.event,
          branch: options.branch,
          status: options.status,
          actor: options.actor,
          head_sha: options.headSha,
        },
      },
    );
  }

  /**
   * 读取单条运行记录。
   * @param owner 所属者
   * @param repo 仓库名
   * @param run 运行 ID
   * @returns 运行记录
   */
  public getRun(owner: string, repo: string, run: number): Promise<GiteaActionWorkflowRun> {
    return this.client.request<GiteaActionWorkflowRun>(
      'GET',
      actionsPath(owner, repo, `/runs/${run}`),
    );
  }

  /**
   * 重新运行整个 workflow run。
   * @param owner 所属者
   * @param repo 仓库名
   * @param run 运行 ID
   */
  public async rerunRun(owner: string, repo: string, run: number): Promise<void> {
    await this.client.request<unknown>('POST', actionsPath(owner, repo, `/runs/${run}/rerun`));
  }

  /**
   * 只重新运行失败的作业。
   * @param owner 所属者
   * @param repo 仓库名
   * @param run 运行 ID
   */
  public async rerunFailedJobs(owner: string, repo: string, run: number): Promise<void> {
    await this.client.request<unknown>(
      'POST',
      actionsPath(owner, repo, `/runs/${run}/rerun-failed-jobs`),
    );
  }

  /**
   * 列出某次运行下的全部作业。
   * @param owner 所属者
   * @param repo 仓库名
   * @param run 运行 ID
   * @returns 作业数组（含各步骤状态）
   */
  public async listRunJobs(
    owner: string,
    repo: string,
    run: number,
  ): Promise<GiteaActionWorkflowJob[]> {
    const response = await this.client.request<JobsResponse>(
      'GET',
      actionsPath(owner, repo, `/runs/${run}/jobs`),
    );
    return response.jobs ?? [];
  }

  /**
   * 读取单个作业（含步骤明细）。
   * @param owner 所属者
   * @param repo 仓库名
   * @param jobId 作业 ID
   * @returns 作业
   */
  public getJob(owner: string, repo: string, jobId: number): Promise<GiteaActionWorkflowJob> {
    return this.client.request<GiteaActionWorkflowJob>(
      'GET',
      actionsPath(owner, repo, `/jobs/${jobId}`),
    );
  }

  /**
   * 读取作业日志（纯文本）。
   *
   * **404 按「没有日志」处理，不抛错**：作业被取消、或还没开始执行时，服务端根本不存在
   * 日志文件，该接口会返回 404（swagger 里本来就声明了 400/404）。这不是异常，
   * 更不是「无权访问」—— 用户在「最近运行」里点开一个已取消的作业时，本来会看到
   * 一句吓人的「资源不存在，或当前令牌无权访问」。
   *
   * @param owner 所属者
   * @param repo 仓库名
   * @param jobId 作业 ID
   * @returns 日志文本；服务端无内容时返回空串
   */
  public async getJobLogs(owner: string, repo: string, jobId: number): Promise<string> {
    try {
      return await this.client.request<string>('GET', actionsPath(owner, repo, `/jobs/${jobId}/logs`), {
        responseType: 'text',
      });
    } catch (error) {
      if (error instanceof GiteaApiError && error.isNotFound) {
        return '';
      }
      throw error;
    }
  }

  /**
   * 列出运行产物。
   * @param options 查询参数
   * @returns 产物与分页信息
   */
  public async listArtifacts(
    options: ListArtifactsOptions,
  ): Promise<GiteaListResult<GiteaActionArtifact>> {
    return this.client.requestPaged<GiteaActionArtifact>(
      'GET',
      actionsPath(options.owner, options.repo, '/artifacts'),
      {
        limit: options.limit ?? 30,
        startPage: options.page ?? 1,
        extract: (data) => (data as ArtifactsResponse | undefined)?.artifacts ?? [],
        query: { name: options.name },
      },
    );
  }
}

/**
 * 拼接仓库级 Actions API 路径。
 * @param owner 所属者
 * @param repo 仓库名
 * @param suffix `/actions` 之后的部分，需自带前导斜杠
 * @returns API 路径
 */
function actionsPath(owner: string, repo: string, suffix: string): string {
  return `/repos/${enc(owner)}/${enc(repo)}/actions${suffix}`;
}

/**
 * URL 编码路径片段。
 * @param value 原始值
 * @returns 已编码的值
 */
function enc(value: string): string {
  return encodeURIComponent(value);
}
