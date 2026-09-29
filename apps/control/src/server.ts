import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { AppError } from './lib/errors.js'
import type { RouteDeps } from './routeDeps.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerArtifactRoutes } from './routes/artifacts.js'
import { registerMiscRoutes } from './routes/misc.js'

export async function buildServer(deps: RouteDeps, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 64 * 1024 * 1024 })

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  /**
   * Fastify rejects a JSON content-type with an empty body (400), which silently
   * broke every body-less POST from the browser — logout, task cancel, rescan,
   * notification read. Treat an empty JSON body as `{}` instead.
   */
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : ''
    if (text.length === 0) {
      done(null, {})
      return
    }
    try {
      done(null, JSON.parse(text))
    } catch (error) {
      done(error as Error, undefined)
    }
  })

  app.get('/healthz', async () => ({
    ok: true,
    sandbox: deps.config.sandboxProvider,
    store: deps.config.store,
  }))

  await registerProjectRoutes(app, deps)
  await registerTaskRoutes(app, deps)
  await registerArtifactRoutes(app, deps)
  await registerMiscRoutes(app, deps)

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })
    }
    if (error instanceof ZodError) {
      const first = error.issues[0]
      return reply.code(400).send({
        error: { code: 'invalid_request', message: first ? `${first.path.join('.')}: ${first.message}` : '请求参数不合法' },
      })
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500
    if (status >= 500) console.error('[control] unhandled error', error)
    return reply.code(status).send({
      error: {
        code: status >= 500 ? 'internal_error' : 'request_failed',
        message: status >= 500 ? '服务内部错误' : error instanceof Error ? error.message : '请求失败',
      },
    })
  })

  return app
}
