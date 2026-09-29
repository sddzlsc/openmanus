import postgres from 'postgres'
import { newId, today } from '../lib/ids.js'
import { emptyUsage, type Store, type UsageDelta, type UserQuotaOverride } from './types.js'
import type {
  Artifact,
  Automation,
  Connector,
  ContainerInstance,
  Notification,
  Project,
  Task,
  TaskEvent,
  UsageRecord,
  User,
} from '@wiwana/protocol'

/**
 * PostgreSQL implementation of the control-plane store.
 *
 * The schema lives in `deploy/sql/001_init.sql`; run it before switching
 * `STORE=postgres`. JSON-shaped columns (events, trigger, payloads) are stored
 * as jsonb and mapped 1:1 onto the shared protocol types.
 */
export class PostgresStore implements Store {
  private sql: postgres.Sql

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 10, onnotice: () => {} })
  }

  /**
   * Idempotent schema migrations. `deploy/sql/001_init.sql` only runs when the
   * database is first created, so every later column/add-on is applied here at
   * boot — self-hosters never have to remember a manual migration step.
   */
  async migrate(): Promise<void> {
    await this.sql`alter table containers add column if not exists runtime_token text`
  }

  async createUser(input: { phone?: string | null; wechatOpenId?: string | null; displayName?: string }) {
    const rows = await this.sql<User[]>`
      insert into users (id, phone, wechat_open_id, display_name)
      values (${newId('usr')}, ${input.phone ?? null}, ${input.wechatOpenId ?? null}, ${input.displayName ?? '新用户'})
      returning ${this.userColumns}`
    return rows[0]!
  }

  async getUser(id: string) {
    const rows = await this.sql<User[]>`select ${this.userColumns} from users where id = ${id}`
    return rows[0] ?? null
  }

  async getUserByPhone(phone: string) {
    const rows = await this.sql<User[]>`select ${this.userColumns} from users where phone = ${phone} limit 1`
    return rows[0] ?? null
  }

  async getUserByWechat(openId: string) {
    const rows = await this.sql<User[]>`select ${this.userColumns} from users where wechat_open_id = ${openId} limit 1`
    return rows[0] ?? null
  }

  async listUsers() {
    return this.sql<User[]>`select ${this.userColumns} from users order by created_at desc limit 500`
  }

  async setUserRole(userId: string, role: User['role']) {
    await this.sql`update users set role = ${role} where id = ${userId}`
  }

  async setUserQuota(userId: string, quota: UserQuotaOverride | null) {
    if (!quota) {
      await this.sql`delete from user_quotas where user_id = ${userId}`
      return
    }
    await this.sql`
      insert into user_quotas (user_id, daily_tokens, daily_images, daily_videos, max_running_tasks)
      values (${userId}, ${quota.dailyTokens ?? null}, ${quota.dailyImages ?? null}, ${quota.dailyVideos ?? null}, ${quota.maxRunningTasks ?? null})
      on conflict (user_id) do update set
        daily_tokens = excluded.daily_tokens,
        daily_images = excluded.daily_images,
        daily_videos = excluded.daily_videos,
        max_running_tasks = excluded.max_running_tasks`
  }

  async getUserQuota(userId: string) {
    const rows = await this.sql<Array<Record<string, number | null>>>`
      select daily_tokens, daily_images, daily_videos, max_running_tasks from user_quotas where user_id = ${userId}`
    const row = rows[0]
    if (!row) return null
    return {
      dailyTokens: row.daily_tokens ?? undefined,
      dailyImages: row.daily_images ?? undefined,
      dailyVideos: row.daily_videos ?? undefined,
      maxRunningTasks: row.max_running_tasks ?? undefined,
    }
  }

  async createProject(input: Omit<Project, 'createdAt' | 'updatedAt'>) {
    const rows = await this.sql<Project[]>`
      insert into projects (id, user_id, name, workspace_key, environment, preview_domain)
      values (${input.id}, ${input.userId}, ${input.name}, ${input.workspaceKey}, ${input.environment}, ${input.previewDomain})
      returning ${this.projectColumns}`
    return rows[0]!
  }

  async getProject(id: string) {
    const rows = await this.sql<Project[]>`select ${this.projectColumns} from projects where id = ${id}`
    return rows[0] ?? null
  }

  async listProjects(userId: string) {
    return this.sql<Project[]>`
      select ${this.projectColumns} from projects where user_id = ${userId} order by updated_at desc limit 200`
  }

  async deleteProject(id: string) {
    await this.sql`delete from projects where id = ${id}`
  }

  async touchProject(id: string, patch: Partial<Pick<Project, 'previewDomain' | 'name' | 'environment'>> = {}) {
    const rows = await this.sql<Project[]>`
      update projects set
        name = coalesce(${patch.name ?? null}, name),
        environment = coalesce(${patch.environment ?? null}, environment),
        preview_domain = coalesce(${patch.previewDomain ?? null}, preview_domain),
        updated_at = now()
      where id = ${id}
      returning ${this.projectColumns}`
    return rows[0] ?? null
  }

  async createTask(input: Omit<Task, 'createdAt' | 'updatedAt'>) {
    const rows = await this.sql<Task[]>`
      insert into tasks (id, user_id, project_id, type, title, prompt, status, progress, session_id, container_id, error, result_summary)
      values (${input.id}, ${input.userId}, ${input.projectId}, ${input.type}, ${input.title}, ${input.prompt},
              ${input.status}, ${input.progress}, ${input.sessionId}, ${input.containerId}, ${input.error}, ${input.resultSummary})
      returning ${this.taskColumns}`
    return rows[0]!
  }

  async getTask(id: string) {
    const rows = await this.sql<Task[]>`select ${this.taskColumns} from tasks where id = ${id}`
    return rows[0] ?? null
  }

  async listTasks(userId: string, limit = 50) {
    return this.sql<Task[]>`
      select ${this.taskColumns} from tasks where user_id = ${userId} order by created_at desc limit ${limit}`
  }

  async listTasksByStatus(status: Task['status']) {
    return this.sql<Task[]>`select ${this.taskColumns} from tasks where status = ${status}`
  }

  async updateTask(id: string, patch: Partial<Task>) {
    const rows = await this.sql<Task[]>`
      update tasks set
        status = coalesce(${patch.status ?? null}, status),
        progress = coalesce(${patch.progress ?? null}, progress),
        session_id = coalesce(${patch.sessionId ?? null}, session_id),
        container_id = coalesce(${patch.containerId ?? null}, container_id),
        error = ${patch.error === undefined ? this.sql`error` : patch.error},
        result_summary = coalesce(${patch.resultSummary ?? null}, result_summary),
        title = coalesce(${patch.title ?? null}, title),
        started_at = coalesce(${patch.startedAt ?? null}, started_at),
        finished_at = coalesce(${patch.finishedAt ?? null}, finished_at),
        updated_at = now()
      where id = ${id}
      returning ${this.taskColumns}`
    return rows[0] ?? null
  }

  async addMessage(input: { id: string; taskId: string; role: 'user' | 'agent' | 'system'; text: string }) {
    await this.sql`
      insert into messages (id, task_id, role, text) values (${input.id}, ${input.taskId}, ${input.role}, ${input.text})`
  }

  async listMessages(taskId: string) {
    const rows = await this.sql<Array<{ id: string; task_id: string; role: string; text: string; created_at: string }>>`
      select id, task_id, role, text, created_at from messages where task_id = ${taskId} order by created_at asc`
    return rows.map((r) => ({ id: r.id, taskId: r.task_id, role: r.role, text: r.text, createdAt: r.created_at }))
  }

  async appendTaskEvent(taskId: string, event: TaskEvent) {
    const rows = await this.sql<Array<{ seq: number; event: TaskEvent }>>`
      with next as (select coalesce(max(seq), 0) + 1 as seq from task_events where task_id = ${taskId})
      insert into task_events (task_id, seq, event)
      select ${taskId}, next.seq, ${this.sql.json(event as never)} from next
      returning seq, event`
    return { ...(rows[0]!.event as TaskEvent), seq: rows[0]!.seq } as TaskEvent
  }

  async listTaskEvents(taskId: string, fromSeq = 0) {
    const rows = await this.sql<Array<{ seq: number; event: TaskEvent }>>`
      select seq, event from task_events where task_id = ${taskId} and seq > ${fromSeq} order by seq asc`
    return rows.map((r) => ({ ...(r.event as TaskEvent), seq: r.seq }) as TaskEvent)
  }

  async createArtifact(input: Omit<Artifact, 'createdAt'>) {
    const rows = await this.sql<Artifact[]>`
      insert into artifacts (id, task_id, project_id, user_id, kind, name, path, mime, size_bytes, preview_url, download_url, share_enabled, share_slug)
      values (${input.id}, ${input.taskId}, ${input.projectId}, ${input.userId}, ${input.kind}, ${input.name}, ${input.path},
              ${input.mime}, ${input.sizeBytes}, ${input.previewUrl}, ${input.downloadUrl}, ${input.shareEnabled}, ${input.shareSlug})
      returning ${this.artifactColumns}`
    return rows[0]!
  }

  async getArtifact(id: string) {
    const rows = await this.sql<Artifact[]>`select ${this.artifactColumns} from artifacts where id = ${id}`
    return rows[0] ?? null
  }

  async getArtifactByShareSlug(slug: string) {
    const rows = await this.sql<Artifact[]>`
      select ${this.artifactColumns} from artifacts where share_slug = ${slug} and share_enabled = true limit 1`
    return rows[0] ?? null
  }

  async listArtifacts(filter: { userId?: string; projectId?: string; taskId?: string }) {
    return this.sql<Artifact[]>`
      select ${this.artifactColumns} from artifacts
      where (${filter.userId ?? null}::text is null or user_id = ${filter.userId ?? null})
        and (${filter.projectId ?? null}::text is null or project_id = ${filter.projectId ?? null})
        and (${filter.taskId ?? null}::text is null or task_id = ${filter.taskId ?? null})
      order by created_at desc limit 500`
  }

  async updateArtifact(id: string, patch: Partial<Artifact>) {
    const rows = await this.sql<Artifact[]>`
      update artifacts set
        share_enabled = coalesce(${patch.shareEnabled ?? null}, share_enabled),
        share_slug = coalesce(${patch.shareSlug ?? null}, share_slug),
        preview_url = coalesce(${patch.previewUrl ?? null}, preview_url),
        download_url = coalesce(${patch.downloadUrl ?? null}, download_url)
      where id = ${id}
      returning ${this.artifactColumns}`
    return rows[0] ?? null
  }

  async upsertContainer(input: ContainerInstance) {
    const rows = await this.sql<ContainerInstance[]>`
      insert into containers (id, project_id, task_id, provider, external_id, state, endpoint, runtime_token, preview_port, started_at, last_activity_at, stopped_at)
      values (${input.id}, ${input.projectId}, ${input.taskId}, ${input.provider}, ${input.externalId}, ${input.state},
              ${input.endpoint}, ${input.runtimeToken}, ${input.previewPort}, ${input.startedAt}, ${input.lastActivityAt}, ${input.stoppedAt})
      on conflict (id) do update set
        state = excluded.state, endpoint = excluded.endpoint, runtime_token = excluded.runtime_token,
        preview_port = excluded.preview_port,
        last_activity_at = excluded.last_activity_at, stopped_at = excluded.stopped_at, task_id = excluded.task_id
      returning ${this.containerColumns}`
    return rows[0]!
  }

  async getContainer(id: string) {
    const rows = await this.sql<ContainerInstance[]>`select ${this.containerColumns} from containers where id = ${id}`
    return rows[0] ?? null
  }

  async listContainers() {
    return this.sql<ContainerInstance[]>`select ${this.containerColumns} from containers order by started_at desc limit 500`
  }

  async findRunningContainerForProject(projectId: string) {
    const rows = await this.sql<ContainerInstance[]>`
      select ${this.containerColumns} from containers
      where project_id = ${projectId} and state not in ('destroyed', 'error')
      order by started_at desc limit 1`
    return rows[0] ?? null
  }

  async getUsage(userId: string, day: string = today()) {
    const rows = await this.sql<Array<Record<string, unknown>>>`
      select tokens, images, videos, container_minutes, tasks from usage_daily where user_id = ${userId} and day = ${day}`
    const row = rows[0]
    if (!row) return emptyUsage(userId, day)
    return {
      userId,
      day,
      tokens: Number(row.tokens ?? 0),
      images: Number(row.images ?? 0),
      videos: Number(row.videos ?? 0),
      containerMinutes: Number(row.container_minutes ?? 0),
      tasks: Number(row.tasks ?? 0),
    } satisfies UsageRecord
  }

  async addUsage(userId: string, day: string, delta: UsageDelta) {
    const rows = await this.sql<Array<Record<string, unknown>>>`
      insert into usage_daily (user_id, day, tokens, images, videos, container_minutes, tasks)
      values (${userId}, ${day}, ${delta.tokens ?? 0}, ${delta.images ?? 0}, ${delta.videos ?? 0}, ${delta.containerMinutes ?? 0}, ${delta.tasks ?? 0})
      on conflict (user_id, day) do update set
        tokens = usage_daily.tokens + excluded.tokens,
        images = usage_daily.images + excluded.images,
        videos = usage_daily.videos + excluded.videos,
        container_minutes = usage_daily.container_minutes + excluded.container_minutes,
        tasks = usage_daily.tasks + excluded.tasks
      returning tokens, images, videos, container_minutes, tasks`
    const row = rows[0]!
    return {
      userId,
      day,
      tokens: Number(row.tokens),
      images: Number(row.images),
      videos: Number(row.videos),
      containerMinutes: Number(row.container_minutes),
      tasks: Number(row.tasks),
    } satisfies UsageRecord
  }

  async addNotification(input: Omit<Notification, 'createdAt' | 'readAt'>) {
    const rows = await this.sql<Notification[]>`
      insert into notifications (id, user_id, task_id, level, title, body)
      values (${input.id}, ${input.userId}, ${input.taskId}, ${input.level}, ${input.title}, ${input.body})
      returning id, user_id as "userId", task_id as "taskId", level, title, body, read_at as "readAt", created_at as "createdAt"`
    return rows[0]!
  }

  async listNotifications(userId: string, limit = 50) {
    return this.sql<Notification[]>`
      select id, user_id as "userId", task_id as "taskId", level, title, body, read_at as "readAt", created_at as "createdAt"
      from notifications where user_id = ${userId} order by created_at desc limit ${limit}`
  }

  async markNotificationRead(id: string, userId: string) {
    await this.sql`update notifications set read_at = now() where id = ${id} and user_id = ${userId}`
  }

  async createAutomation(input: Omit<Automation, 'createdAt' | 'lastRunAt' | 'nextRunAt'>) {
    const rows = await this.sql<Automation[]>`
      insert into automations (id, user_id, project_id, name, enabled, trigger, action_prompt)
      values (${input.id}, ${input.userId}, ${input.projectId}, ${input.name}, ${input.enabled}, ${this.sql.json(input.trigger as never)}, ${input.actionPrompt})
      returning id, user_id as "userId", project_id as "projectId", name, enabled, trigger,
                action_prompt as "actionPrompt", last_run_at as "lastRunAt", next_run_at as "nextRunAt", created_at as "createdAt"`
    return rows[0]!
  }

  async listAutomations(userId: string) {
    return this.sql<Automation[]>`
      select id, user_id as "userId", project_id as "projectId", name, enabled, trigger,
             action_prompt as "actionPrompt", last_run_at as "lastRunAt", next_run_at as "nextRunAt", created_at as "createdAt"
      from automations where user_id = ${userId} order by created_at desc`
  }

  async setAutomationEnabled(id: string, userId: string, enabled: boolean) {
    const rows = await this.sql<Automation[]>`
      update automations set enabled = ${enabled} where id = ${id} and user_id = ${userId}
      returning id, user_id as "userId", project_id as "projectId", name, enabled, trigger,
                action_prompt as "actionPrompt", last_run_at as "lastRunAt", next_run_at as "nextRunAt", created_at as "createdAt"`
    return rows[0] ?? null
  }

  async getAutomation(id: string) {
    const rows = await this.sql<Automation[]>`
      select id, user_id as "userId", project_id as "projectId", name, enabled, trigger,
             action_prompt as "actionPrompt", last_run_at as "lastRunAt", next_run_at as "nextRunAt", created_at as "createdAt"
      from automations where id = ${id}`
    return rows[0] ?? null
  }

  async deleteAutomation(id: string, userId: string) {
    const rows = await this.sql`delete from automations where id = ${id} and user_id = ${userId} returning id`
    return rows.length > 0
  }

  async setAutomationNextRun(id: string, nextRunAt: string | null) {
    await this.sql`update automations set next_run_at = ${nextRunAt} where id = ${id}`
  }

  async listDueAutomations(now: Date) {
    return this.sql<Automation[]>`
      select id, user_id as "userId", project_id as "projectId", name, enabled, trigger,
             action_prompt as "actionPrompt", last_run_at as "lastRunAt", next_run_at as "nextRunAt", created_at as "createdAt"
      from automations
      where enabled = true
        and trigger->>'kind' = 'schedule'
        and next_run_at is not null
        and next_run_at <= ${now}
      order by next_run_at asc
      limit 50`
  }

  async updateAutomationRun(id: string, lastRunAt: string, nextRunAt: string | null) {
    await this.sql`
      update automations set last_run_at = ${lastRunAt}, next_run_at = ${nextRunAt} where id = ${id}`
  }

  async listConnectors(userId: string) {
    return this.sql<Connector[]>`
      select id, user_id as "userId", provider, status, credential_ref as "credentialRef", created_at as "createdAt"
      from connectors where user_id = ${userId}`
  }

  async upsertConnector(input: Omit<Connector, 'createdAt'>) {
    const rows = await this.sql<Connector[]>`
      insert into connectors (id, user_id, provider, status, credential_ref)
      values (${input.id}, ${input.userId}, ${input.provider}, ${input.status}, ${input.credentialRef})
      on conflict (id) do update set status = excluded.status, credential_ref = excluded.credential_ref
      returning id, user_id as "userId", provider, status, credential_ref as "credentialRef", created_at as "createdAt"`
    return rows[0]!
  }

  async putOtp(phone: string, code: string, expiresAt: number) {
    await this.sql`
      insert into otps (phone, code, expires_at) values (${phone}, ${code}, ${new Date(expiresAt)})
      on conflict (phone) do update set code = excluded.code, expires_at = excluded.expires_at`
  }

  async takeOtp(phone: string) {
    const rows = await this.sql<Array<{ code: string; expires_at: Date }>>`
      delete from otps where phone = ${phone} returning code, expires_at`
    const row = rows[0]
    if (!row) return null
    return { code: row.code, expiresAt: new Date(row.expires_at).getTime() }
  }

  async close() {
    await this.sql.end({ timeout: 5 })
  }

  private get userColumns() {
    return this.sql`
      id, phone, wechat_open_id as "wechatOpenId", display_name as "displayName", role, status, created_at as "createdAt"`
  }

  private get projectColumns() {
    return this.sql`
      id, user_id as "userId", name, workspace_key as "workspaceKey", environment,
      preview_domain as "previewDomain", created_at as "createdAt", updated_at as "updatedAt"`
  }

  private get taskColumns() {
    return this.sql`
      id, user_id as "userId", project_id as "projectId", type, title, prompt, status, progress,
      session_id as "sessionId", container_id as "containerId", error, result_summary as "resultSummary",
      created_at as "createdAt", started_at as "startedAt", finished_at as "finishedAt", updated_at as "updatedAt"`
  }

  private get artifactColumns() {
    return this.sql`
      id, task_id as "taskId", project_id as "projectId", user_id as "userId", kind, name, path, mime,
      size_bytes as "sizeBytes", preview_url as "previewUrl", download_url as "downloadUrl",
      share_enabled as "shareEnabled", share_slug as "shareSlug", created_at as "createdAt"`
  }

  private get containerColumns() {
    return this.sql`
      id, project_id as "projectId", task_id as "taskId", provider, external_id as "externalId", state,
      endpoint, runtime_token as "runtimeToken", preview_port as "previewPort", started_at as "startedAt",
      last_activity_at as "lastActivityAt",
      stopped_at as "stoppedAt"`
  }
}
