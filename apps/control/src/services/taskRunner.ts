import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { Artifact, ArtifactKind, Project, RuntimeEvent, Task, TaskEvent } from '@wiwana/protocol'
import type { AppConfig } from '../config.js'
import { newId } from '../lib/ids.js'
import type { Store } from '../store/types.js'
import { capabilityPacksForTask, type RuntimeHandle, type RuntimeProvider } from '../runtime/provider.js'
import { TaskEventBus } from './bus.js'
import { QuotaService } from './quota.js'

export interface TaskRunnerDeps {
  store: Store
  runtime: RuntimeProvider
  quota: QuotaService
  bus: TaskEventBus
  config: AppConfig
  logger?: { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void }
}

const TERMINAL_STATUSES: Task['status'][] = ['done', 'failed', 'cancelled']

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type TaskEventInput = DistributiveOmit<TaskEvent, 'seq' | 'at'>

export class TaskRunner {
  private queue: string[] = []
  private running = new Set<string>()
  private handles = new Map<string, RuntimeHandle>()
  private completions = new Map<string, () => void>()
  private maxConcurrent: number

  constructor(private readonly deps: TaskRunnerDeps) {
    this.maxConcurrent = Number(process.env.MAX_CONCURRENT_TASKS ?? 4)
  }

  /** Requeue work after a control-plane restart. */
  async recover(): Promise<void> {
    for (const task of await this.deps.store.listTasksByStatus('queued')) this.enqueue(task.id)
    for (const task of await this.deps.store.listTasksByStatus('running')) {
      await this.finish(task.id, {
        status: 'failed',
        error: '控制面重启导致任务中断，请重新发起。',
      })
    }
  }

  enqueue(taskId: string): void {
    if (!this.queue.includes(taskId)) this.queue.push(taskId)
    void this.drain()
  }

  async sendMessage(taskId: string, text: string): Promise<void> {
    const handle = this.handles.get(taskId)
    await this.appendEvent(taskId, { type: 'message', role: 'user', text })
    await this.deps.store.addMessage({ id: newId('msg'), taskId, role: 'user', text })
    if (handle) await handle.send(text)
    else {
      const task = await this.deps.store.getTask(taskId)
      if (task && !TERMINAL_STATUSES.includes(task.status)) {
        await this.deps.store.updateTask(taskId, { prompt: `${task.prompt}\n\n补充说明：${text}` })
      } else {
        throw new Error('task is not running; start a new task instead')
      }
    }
  }

  async cancel(taskId: string): Promise<void> {
    const handle = this.handles.get(taskId)
    if (handle) await handle.cancel()
    const task = await this.deps.store.getTask(taskId)
    if (task && task.status === 'queued') {
      this.queue = this.queue.filter((id) => id !== taskId)
      await this.finish(taskId, { status: 'cancelled', error: null, summary: '任务已取消' })
    }
  }

  activeHandle(taskId: string): RuntimeHandle | undefined {
    return this.handles.get(taskId)
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      const taskId = this.queue.shift()!
      if (this.running.has(taskId)) continue
      this.running.add(taskId)
      void this.run(taskId).finally(() => {
        this.running.delete(taskId)
        void this.drain()
      })
    }
  }

  private async run(taskId: string): Promise<void> {
    const task = await this.deps.store.getTask(taskId)
    if (!task || TERMINAL_STATUSES.includes(task.status)) return
    const project = await this.deps.store.getProject(task.projectId)
    if (!project) {
      await this.finish(taskId, { status: 'failed', error: '项目不存在' })
      return
    }

    try {
      await this.deps.quota.assertCanStartTask(task.userId)
    } catch (error) {
      this.deps.logger?.warn('task run failed', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      await this.finish(taskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    await this.setStatus(task, 'running', 3, '已进入执行队列')

    const capabilityPacks = capabilityPacksForTask(task.type, task.prompt)
    const limits = { maxSteps: 40, maxTokens: (await this.deps.quota.limitsFor(task.userId)).dailyTokens }

    try {
      const handle = await this.deps.runtime.startTask({ task, project, capabilityPacks, limits })
      this.handles.set(taskId, handle)
      const unsubscribe = handle.onEvent((event) => {
        void this.onRuntimeEvent(task, project, event).catch((error) => {
          this.deps.logger?.warn('runtime event handling failed', {
            taskId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      })
      await this.deps.store.updateTask(taskId, {
        sessionId: handle.sessionId,
        containerId: handle.containerId,
        progress: 6,
      })
      if (handle.containerId) {
        await this.deps.store.upsertContainer({
          id: newId('ctr'),
          projectId: project.id,
          taskId,
          provider: this.deps.runtime.kind,
          externalId: handle.containerId,
          state: 'busy',
          endpoint: null,
          runtimeToken: null,
          previewPort: handle.previewPort,
          startedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          stoppedAt: null,
        })
      }

      await new Promise<void>((resolve) => this.completions.set(taskId, resolve))
      unsubscribe()
      const done = await this.deps.store.getTask(taskId)
      if (done && !TERMINAL_STATUSES.includes(done.status)) {
        await this.finish(taskId, { status: 'failed', error: '任务意外结束' })
      }
    } catch (error) {
      await this.finish(taskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.completions.delete(taskId)
      const handle = this.handles.get(taskId)
      this.handles.delete(taskId)
      // Cloud computers are a project's home: keep them running between tasks.
      if (handle && !handle.persistent) await handle.dispose().catch(() => {})
    }
  }

  private async onRuntimeEvent(task: Task, project: Project, event: RuntimeEvent): Promise<void> {
    switch (event.type) {
      case 'status': {
        await this.deps.store.updateTask(task.id, {
          status: event.status,
          progress: event.progress,
        })
        await this.appendEvent(task.id, {
          type: 'status',
          status: event.status,
          progress: event.progress,
          note: event.note,
        })
        if (event.status === 'done' || event.status === 'failed' || event.status === 'cancelled') {
          this.completions.get(task.id)?.()
        }
        return
      }
      case 'thought':
        await this.appendEvent(task.id, { type: 'thought', text: event.text })
        return
      case 'tool':
        await this.appendEvent(task.id, { type: 'tool', name: event.name, summary: event.summary, status: event.status })
        return
      case 'terminal':
        await this.appendEvent(task.id, { type: 'terminal', text: event.text })
        return
      case 'screenshot':
        await this.appendEvent(task.id, { type: 'screenshot', dataUrl: event.dataUrl, caption: event.caption })
        return
      case 'usage':
        await this.deps.quota.record(task.userId, {
          tokens: event.tokens,
          images: event.images,
          videos: event.videos,
        })
        await this.appendEvent(task.id, {
          type: 'usage',
          tokens: event.tokens,
          images: event.images,
          videos: event.videos,
        })
        return
      case 'message':
        await this.deps.store.addMessage({ id: newId('msg'), taskId: task.id, role: event.role, text: event.text })
        await this.appendEvent(task.id, { type: 'message', role: event.role, text: event.text })
        return
      case 'artifact': {
        const artifact = await this.materializeArtifact(task, project, event)
        await this.appendEvent(task.id, { type: 'artifact', artifact })
        return
      }
      case 'error':
        await this.finish(task.id, { status: 'failed', error: event.message })
        return
      case 'done':
        await this.finish(task.id, { status: 'done', summary: event.summary })
        return
    }
  }

  private async materializeArtifact(
    task: Task,
    project: Project,
    event: Extract<RuntimeEvent, { type: 'artifact' }>,
  ): Promise<Artifact> {
    const absolute = path.join(this.deps.config.workspaceRoot, project.workspaceKey, event.path)
    let sizeBytes = 0
    try {
      sizeBytes = (await stat(absolute)).size
    } catch {
      this.deps.logger?.warn('artifact file missing on disk', { taskId: task.id, path: event.path })
    }
    const id = newId('art')
    const isWebsiteEntry = event.kind === 'website' || event.path.endsWith('.html')
    const artifact = await this.deps.store.createArtifact({
      id,
      taskId: task.id,
      projectId: project.id,
      userId: task.userId,
      kind: event.kind as ArtifactKind,
      name: event.name,
      path: event.path,
      mime: event.mime,
      sizeBytes,
      previewUrl: isWebsiteEntry ? `/preview/${project.id}/${event.path.replace(/^\.?\//, '')}` : `/files/${id}`,
      downloadUrl: `/files/${id}?download=1`,
      shareEnabled: false,
      shareSlug: null,
    })
    return artifact
  }

  private async setStatus(task: Task, status: Task['status'], progress: number, note?: string): Promise<void> {
    await this.deps.store.updateTask(task.id, { status, progress })
    await this.appendEvent(task.id, { type: 'status', status, progress, note })
  }

  private async finish(
    taskId: string,
    outcome: { status: 'done' | 'failed' | 'cancelled'; error?: string | null; summary?: string },
  ): Promise<void> {
    const task = await this.deps.store.getTask(taskId)
    if (!task || TERMINAL_STATUSES.includes(task.status)) {
      this.completions.get(taskId)?.()
      return
    }
    const finishedAt = new Date().toISOString()
    await this.deps.store.updateTask(taskId, {
      status: outcome.status,
      progress: outcome.status === 'done' ? 100 : task.progress,
      error: outcome.error ?? null,
      resultSummary: outcome.summary ?? task.resultSummary,
      finishedAt,
    })

    if (outcome.status === 'done') {
      await this.deps.quota.record(task.userId, { tasks: 1 })
      await this.appendEvent(taskId, { type: 'done', summary: outcome.summary ?? '任务已完成' })
      await this.deps.store.addNotification({
        id: newId('ntf'),
        userId: task.userId,
        taskId,
        level: 'success',
        title: `任务完成：${task.title}`,
        body: outcome.summary ?? '交付物已生成，可在任务详情中查看。',
      })
      await this.promotePreviewEnvironment(task)
    } else if (outcome.status === 'failed') {
      await this.appendEvent(taskId, {
        type: 'error',
        message: outcome.error ?? '任务执行失败',
        retryable: true,
      })
      await this.deps.store.addNotification({
        id: newId('ntf'),
        userId: task.userId,
        taskId,
        level: 'error',
        title: `任务失败：${task.title}`,
        body: outcome.error ?? '任务执行失败，可重试。',
      })
    } else {
      await this.appendEvent(taskId, { type: 'status', status: 'cancelled', progress: task.progress, note: '任务已取消' })
    }
    this.completions.get(taskId)?.()
  }

  private async appendEvent(taskId: string, event: TaskEventInput): Promise<void> {
    const stored = await this.deps.store.appendTaskEvent(taskId, {
      ...(event as TaskEvent),
      seq: 0,
      at: new Date().toISOString(),
    } as TaskEvent)
    this.deps.bus.publish(taskId, stored)
  }

  /**
   * A finished web/full-suite task leaves behind something to look at, but its
   * task container is disposed right after the run — which would kill the
   * preview (including the project's own API). Promote those projects to a cloud
   * computer so the preview keeps working; the idle sweeper sleeps it later.
   */
  private async promotePreviewEnvironment(task: Task): Promise<void> {
    if (!['web', 'fullstack'].includes(task.type)) return
    const ensure = this.deps.runtime.ensureProjectRuntime?.bind(this.deps.runtime)
    if (!ensure) return
    const project = await this.deps.store.getProject(task.projectId)
    if (!project) return
    try {
      const updated =
        project.environment === 'cloud-computer'
          ? project
          : ((await this.deps.store.touchProject(project.id, { environment: 'cloud-computer' })) ?? project)
      const runtime = await ensure(updated)
      await this.deps.store.upsertContainer({ ...runtime, taskId: null, state: 'ready' })
      await this.appendEvent(task.id, {
        type: 'message',
        role: 'system',
        text: '已为该项目启动常驻预览环境：网站 / 、后台 /admin/ 、接口 /api/ 现在都可以访问；空闲后会自动休眠。',
      })
    } catch (error) {
      this.deps.logger?.warn('preview promotion failed', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
