import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { MemoryStore } from '../src/store/memory.js'
import { MockRuntimeProvider } from '../src/runtime/mock.js'
import { TaskEventBus } from '../src/services/bus.js'
import { QuotaService } from '../src/services/quota.js'
import { TaskRunner } from '../src/services/taskRunner.js'
import { AutomationScheduler } from '../src/services/automationScheduler.js'
import { currentOwner } from '../src/routeDeps.js'

const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'wiwana-test-'))

async function buildHarness() {
  const config = loadConfig({
    STORE: 'memory',
    SANDBOX_PROVIDER: 'mock',
    WORKSPACE_ROOT: workspaceRoot,
    MOCK_TASK_DURATION_MS: '400',
    QUOTA_MAX_RUNNING_TASKS: '1',
    JWT_SECRET: 'test-secret',
  } as NodeJS.ProcessEnv)

  const store = new MemoryStore()
  const bus = new TaskEventBus()
  const quota = QuotaService.fromConfig(store, config)
  const runtime = new MockRuntimeProvider({ workspaceRoot: config.workspaceRoot, durationMs: config.mockTaskDurationMs })
  const runner = new TaskRunner({ store, runtime, quota, bus, config })
  const scheduler = new AutomationScheduler({ store, config, enqueue: (taskId) => runner.enqueue(taskId) })
  const app = await buildServer({
    store,
    config,
    runner,
    quota,
    bus,
    scheduler,
    runtimeProvider: runtime,
  })
  return { app, store, config, runner, runtime, quota, scheduler }
}

async function waitFor<T>(check: () => Promise<T | null>, timeoutMs = 8000, intervalMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await check()
    if (value !== null && value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('condition not met in time')
}

describe('control plane', () => {
  let harness: Awaited<ReturnType<typeof buildHarness>>
  let app: FastifyInstance
  let token: string
  let userId: string

  beforeAll(async () => {
    harness = await buildHarness()
    app = harness.app
    // No accounts in this build: every request is the local owner.
    const owner = await currentOwner({
      store: harness.store,
      config: harness.config,
      runner: harness.runner,
      quota: harness.quota,
      bus: new TaskEventBus(),
      scheduler: harness.scheduler,
      runtimeProvider: harness.runtime,
    })
    userId = owner.userId
    token = ''
  })

  afterAll(async () => {
    await app.close()
    await harness.runtime.dispose()
    await harness.store.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('runs a task end to end and produces artifacts', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: { type: 'office', title: '季度汇报', prompt: '生成一份季度汇报文档和图表' },
    })
    expect(createResponse.statusCode).toBe(201)
    const created = createResponse.json() as { task: { id: string; projectId: string } }

    const detail = await waitFor(async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/tasks/${created.task.id}`,
        headers: { authorization: `Bearer ${token}` },
      })
      const body = response.json() as { task: { status: string }; artifacts: unknown[] }
      return body.task.status === 'done' ? body : null
    })
    expect(detail.artifacts.length).toBeGreaterThan(0)

    const eventsResponse = await app.inject({
      method: 'GET',
      url: `/api/tasks/${created.task.id}/stream?once=1`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(eventsResponse.body).toContain('event: done')
    expect(eventsResponse.body).toContain('event: artifact')

    const usage = await harness.quota.snapshot(userId)
    expect(usage.tasks.used).toBeGreaterThan(0)
    expect(usage.tokens.used).toBeGreaterThan(0)
  })

  it('shares an artifact publicly and blocks unshared access', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/artifacts',
      headers: { authorization: `Bearer ${token}` },
    })
    const artifacts = (list.json() as { artifacts: Array<{ id: string; shareEnabled: boolean }> }).artifacts
    const artifact = artifacts[0]!

    // No accounts in this build: the local owner can always read its own files.
    const ownerRead = await app.inject({ method: 'GET', url: `/files/${artifact.id}` })
    expect(ownerRead.statusCode).toBe(200)

    const shared = await app.inject({
      method: 'POST',
      url: `/api/artifacts/${artifact.id}/share`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    })
    expect(shared.statusCode).toBe(200)
    const body = shared.json() as { shareUrl: string; artifact: { shareSlug: string } }
    // Canonical share links carry the slug as a query parameter because content
    // blockers reject opaque share paths before the app can load.
    expect(body.shareUrl).toContain('/deliverable?slug=')

    const publicView = await app.inject({ method: 'GET', url: `/api/public/artifacts/${body.artifact.shareSlug}` })
    expect(publicView.statusCode).toBe(200)
    // Legacy aliases keep previously shared links working outside blockers.
    const legacyView = await app.inject({ method: 'GET', url: `/s/${body.artifact.shareSlug}` })
    expect(legacyView.statusCode).toBe(200)

    const publicFile = await app.inject({ method: 'GET', url: `/files/${artifact.id}` })
    expect(publicFile.statusCode).toBe(200)

    // Textual deliverables must always declare UTF-8: without a charset the
    // browser falls back to a locale encoding and Chinese turns into mojibake.
    const textual = await app.inject({
      method: 'GET',
      url: '/api/artifacts',
      headers: { authorization: `Bearer ${token}` },
    })
    const candidates = (textual.json() as { artifacts: Array<{ id: string; mime: string }> }).artifacts.filter(
      (item) => item.mime.startsWith('text/') || item.mime === 'image/svg+xml',
    )
    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      const response = await app.inject({
        method: 'GET',
        url: `/files/${candidate.id}`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toMatch(/charset=utf-8/i)
    }
  })

  it('enforces the per-user quota', async () => {
    const store = harness.store
    await store.setUserQuota(userId, { dailyTokens: 0 })

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: { type: 'web', title: '超额度任务', prompt: '生成一个落地页' },
    })
    expect(blocked.statusCode).toBe(201)

    const failed = await waitFor(async () => {
      const tasks = await store.listTasks(userId)
      return tasks.find((task) => task.title === '超额度任务' && task.status === 'failed') ?? null
    })
    expect(failed.error).toContain('Token 额度已用完')

    await store.setUserQuota(userId, null)
  })

  it('accepts body-less JSON POSTs (rescan, cancel)', async () => {
    // Regression: a JSON content-type with an empty body used to 400, which made
    // "退出登录", "取消任务" and "刷新交付物" silently do nothing in the UI.
    const tasks = await harness.store.listTasks(userId)
    const finished = tasks.find((task) => task.status === 'done')
    expect(finished).toBeTruthy()
    const rescan = await app.inject({
      method: 'POST',
      url: `/api/tasks/${finished!.id}/rescan`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    expect(rescan.statusCode).toBe(200)
  })

  it('starts and stops a project cloud computer', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: '常驻项目' },
    })
    const projectId = (created.json() as { project: { id: string } }).project.id

    const started = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runtime`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(started.statusCode).toBe(200)
    const body = started.json() as { runtime: { state: string; projectId: string }; project: { environment: string } }
    expect(body.runtime.state).toBe('ready')
    expect(body.project.environment).toBe('cloud-computer')

    // The runtime row is persisted, so the status endpoint finds it.
    const status = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runtime`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect((status.json() as { runtime: { projectId: string } | null }).runtime?.projectId).toBe(projectId)

    const stopped = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/runtime`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(stopped.statusCode).toBe(200)
    const after = await harness.store.getProject(projectId)
    expect(after?.environment).toBe('task-sandbox')
  })
})
