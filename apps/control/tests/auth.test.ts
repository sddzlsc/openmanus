import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { MemoryStore } from '../src/store/memory.js'
import { MockRuntimeProvider } from '../src/runtime/mock.js'
import { TaskEventBus } from '../src/services/bus.js'
import { QuotaService } from '../src/services/quota.js'
import { TaskRunner } from '../src/services/taskRunner.js'
import { AutomationScheduler } from '../src/services/automationScheduler.js'
import { ConsoleOtpSender } from '../src/auth/otp.js'

async function harness(authMode: 'local' | 'phone') {
  const config = loadConfig({ AUTH_MODE: authMode, STORE: 'memory', WORKSPACE_ROOT: '/tmp/wiwana-auth-test' } as NodeJS.ProcessEnv)
  const store = new MemoryStore()
  const bus = new TaskEventBus()
  const quota = QuotaService.fromConfig(store, config)
  const runtime = new MockRuntimeProvider({ workspaceRoot: config.workspaceRoot, durationMs: 200 })
  const runner = new TaskRunner({ store, runtime, quota, bus, config })
  const scheduler = new AutomationScheduler({ store, config, enqueue: (id) => runner.enqueue(id) })
  const app = await buildServer({
    store,
    config,
    runner,
    quota,
    bus,
    otpSender: new ConsoleOtpSender(),
    scheduler,
    runtimeProvider: runtime,
  })
  return { app, store, runtime }
}

describe('auth modes', () => {
  it('local mode is login-free and acts as an admin owner', async () => {
    const subject: { app: FastifyInstance; runtime: MockRuntimeProvider } = await harness('local')
    try {
      // No cookie, no bearer token — yet the whole API is usable.
      const me = await subject.app.inject({ method: 'GET', url: '/api/me' })
      expect(me.statusCode).toBe(200)
      expect((me.json() as { user: { displayName: string } }).user.displayName).toBe('本机用户')

      const created = await subject.app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { type: 'office', prompt: '本地模式冒烟任务' },
      })
      expect(created.statusCode).toBe(201)

      // Admin surfaces are reachable too (this is a single-operator instance).
      const overview = await subject.app.inject({ method: 'GET', url: '/api/admin/overview' })
      expect(overview.statusCode).toBe(200)
    } finally {
      await subject.app.close()
      await subject.runtime.dispose()
    }
  })

  it('phone mode still rejects unauthenticated requests', async () => {
    const subject: { app: FastifyInstance; runtime: MockRuntimeProvider } = await harness('phone')
    try {
      const me = await subject.app.inject({ method: 'GET', url: '/api/me' })
      expect(me.statusCode).toBe(401)
    } finally {
      await subject.app.close()
      await subject.runtime.dispose()
    }
  })
})
