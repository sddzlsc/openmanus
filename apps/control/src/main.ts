import { buildServer } from './server.js'
import { loadConfig } from './config.js'
import { MemoryStore } from './store/memory.js'
import { PostgresStore } from './store/postgres.js'
import { TaskEventBus } from './services/bus.js'
import { QuotaService } from './services/quota.js'
import { TaskRunner } from './services/taskRunner.js'
import { MockRuntimeProvider } from './runtime/mock.js'
import { DockerRuntimeProvider } from './runtime/docker.js'
import type { RuntimeProvider } from './runtime/provider.js'
import { ConsoleOtpSender } from './auth/otp.js'
import { AutomationScheduler } from './services/automationScheduler.js'
import type { Store } from './store/types.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const store: Store =
    config.store === 'postgres' && config.databaseUrl
      ? new PostgresStore(config.databaseUrl)
      : new MemoryStore()

  const runtime: RuntimeProvider =
    config.sandboxProvider === 'docker'
      ? new DockerRuntimeProvider({
          image: config.sandbox.image,
          workspaceRoot: config.workspaceRoot,
          cpus: config.sandbox.cpus,
          memoryMb: config.sandbox.memoryMb,
          agentPort: config.sandbox.agentPort,
          previewPort: config.sandbox.previewPort,
          network: process.env.SANDBOX_NETWORK ?? 'wiwana-sandbox',
          previewDomain: config.previewDomain,
          connectMode: process.env.SANDBOX_CONNECT_MODE === 'container-dns' ? 'container-dns' : 'host-port',
          // Model/provider credentials only; product secrets stay in the control
          // plane. Codex and Claude Code inside the sandbox both run on DeepSeek,
          // so a single key drives the orchestrator and both executors — no
          // OpenAI/Anthropic account or overseas network path is required.
          envPassthrough: [
            'DEEPSEEK_API_KEY',
            'DASHSCOPE_API_KEY',
            'KELING_API_KEY',
            'MUSIC_API_KEY',
            'MUSIC_API_BASE',
          ],
        })
      : new MockRuntimeProvider({
          workspaceRoot: config.workspaceRoot,
          durationMs: config.mockTaskDurationMs,
        })

  const bus = new TaskEventBus()
  const quota = QuotaService.fromConfig(store, config)
  const runner = new TaskRunner({
    store,
    runtime,
    quota,
    bus,
    config,
    logger: { info: (msg, meta) => console.log(msg, meta ?? ''), warn: (msg, meta) => console.warn(msg, meta ?? '') },
  })

  const logger = { info: (msg: string, meta?: unknown) => console.log(msg, meta ?? ''), warn: (msg: string, meta?: unknown) => console.warn(msg, meta ?? '') }
  const scheduler = new AutomationScheduler(
    { store, config, enqueue: (taskId) => runner.enqueue(taskId), logger },
    Number(process.env.AUTOMATION_TICK_MS ?? 30_000),
  )

  const app = await buildServer(
    { store, config, runner, quota, bus, otpSender: new ConsoleOtpSender(), scheduler },
    { logger: true },
  )

  await runner.recover()
  scheduler.start()
  await app.listen({ port: config.port, host: config.host })
  console.log(`[control] listening on http://${config.host}:${config.port} (store=${config.store}, sandbox=${runtime.kind})`)

  const shutdown = async (signal: string) => {
    console.log(`[control] received ${signal}, shutting down`)
    scheduler.stop()
    await app.close()
    await runtime.dispose()
    await store.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  console.error('[control] fatal', error)
  process.exit(1)
})
