import { readdir } from 'node:fs/promises'
import Fastify from 'fastify'
import type { RuntimeEvent, RuntimeHealth } from '@wiwana/protocol'
import { loadRuntimeConfig } from './config.js'
import { SessionRegistry, type RuntimeSessionState } from './session.js'
import { LocalDriver } from './drivers/local.js'
import { DshDriver } from './drivers/dsh.js'
import type { RuntimeDriver } from './drivers/types.js'
import { startPreviewServer } from './preview.js'
import { inferMime } from './drivers/artifacts.js'

async function main(): Promise<void> {
  const config = loadRuntimeConfig()
  const registry = new SessionRegistry()

  const dshAvailable = config.dsh.enabled && (await DshDriver.probe(config.dsh))
  const driver: RuntimeDriver = dshAvailable ? new DshDriver(config.dsh) : new LocalDriver()
  console.log(
    `[runtime-agent] driver=${driver.kind} dsh=${dshAvailable ? 'available' : 'unavailable (local driver)'} ` +
      `workspace=${config.workspace} capabilities=${config.capabilitiesRoot}`,
  )

  const app = Fastify({ logger: false })

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/healthz') return
    const header = request.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    if (token !== config.token) {
      await reply.code(401).send({ error: { code: 'unauthorized', message: 'runtime token 无效' } })
    }
  })

  app.get('/healthz', async (): Promise<RuntimeHealth> => ({
    ok: true,
    version: '0.1.0',
    driver: driver.kind,
    dsh: {
      available: dshAvailable,
      profile: dshAvailable ? config.dsh.profile : null,
      binary: dshAvailable ? config.dsh.binary : null,
    },
    browser: { available: false },
  }))

  app.post('/v1/sessions', async (request, reply) => {
    const body = (request.body ?? {}) as {
      taskId?: string
      type?: string
      prompt?: string
      capabilityPacks?: string[]
    }
    const session = registry.create({
      taskId: body.taskId ?? config.task.taskId,
      type: body.type ?? config.task.type,
      prompt: body.prompt ?? '',
      capabilityPacks: body.capabilityPacks ?? config.task.capabilityPacks,
    })
    const context = makeContext(session)
    void driver.start(context).catch((error) => {
      registry.emit(session, {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      })
    })
    return reply.code(201).send({ sessionId: session.id, previewPort: config.previewPort })
  })

  app.post('/v1/sessions/:id/messages', async (request, reply) => {
    const session = registry.get((request.params as { id: string }).id)
    if (!session) return reply.code(404).send({ error: { code: 'not_found', message: 'session 不存在' } })
    const body = (request.body ?? {}) as { text?: string }
    await driver.send(makeContext(session), body.text ?? '')
    return { ok: true }
  })

  app.post('/v1/sessions/:id/cancel', async (request, reply) => {
    const session = registry.get((request.params as { id: string }).id)
    if (!session) return reply.code(404).send({ error: { code: 'not_found', message: 'session 不存在' } })
    await driver.cancel(makeContext(session))
    return { ok: true }
  })

  app.get('/v1/sessions/:id/events', async (request, reply) => {
    const session = registry.get((request.params as { id: string }).id)
    if (!session) return reply.code(404).send({ error: { code: 'not_found', message: 'session 不存在' } })

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    const write = (event: RuntimeEvent) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    for (const event of session.events) write(event)
    if (session.finished) {
      reply.raw.end()
      return reply
    }
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15000)
    const unsubscribe = registry.subscribe(session, (event) => {
      write(event)
      if (event.type === 'done' || event.type === 'error') {
        clearInterval(heartbeat)
        unsubscribe()
        reply.raw.end()
      }
    })
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
    return reply
  })

  app.get('/v1/artifacts', async () => {
    const entries = await readdir(config.workspace, { withFileTypes: true }).catch(() => [])
    return {
      artifacts: entries
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .map((entry) => ({
          name: entry.name,
          path: entry.name,
          mime: inferMime(entry.name),
        })),
    }
  })

  await startPreviewServer(config.workspace, config.previewPort)
  await app.listen({ port: config.port, host: config.host })
  console.log(`[runtime-agent] listening on http://${config.host}:${config.port}, preview on :${config.previewPort}`)

  const shutdown = async () => {
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  function makeContext(session: RuntimeSessionState) {
    return {
      session,
      workspace: config.workspace,
      capabilitiesRoot: config.capabilitiesRoot,
      emit: (event: RuntimeEvent) => registry.emit(session, event),
    }
  }
}

main().catch((error) => {
  console.error('[runtime-agent] fatal', error)
  process.exit(1)
})
