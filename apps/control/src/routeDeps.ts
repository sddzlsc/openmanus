import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AppConfig } from './config.js'
import type { AuthContext } from './auth/tokens.js'
import type { OtpSender } from './auth/otp.js'
import type { Store } from './store/types.js'
import type { TaskRunner } from './services/taskRunner.js'
import type { QuotaService } from './services/quota.js'
import type { TaskEventBus } from './services/bus.js'
import type { AutomationScheduler } from './services/automationScheduler.js'
import type { RuntimeProvider } from './runtime/provider.js'
import { verifyToken } from './auth/tokens.js'

export const AUTH_COOKIE = 'wiwana_token'

export interface RouteDeps {
  store: Store
  config: AppConfig
  runner: TaskRunner
  quota: QuotaService
  bus: TaskEventBus
  otpSender: OtpSender
  scheduler: AutomationScheduler
  runtimeProvider: RuntimeProvider
}

export async function authenticate(
  deps: RouteDeps,
  request: FastifyRequest,
): Promise<AuthContext | null> {
  // Login-free local mode: every request acts as the machine's owner, which is
  // also the admin. Multi-user deployments set AUTH_MODE=phone.
  if (deps.config.authMode === 'local') {
    return { userId: await localUserId(deps), role: 'admin' }
  }
  const header = request.headers.authorization
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null
  const cookie = (request.cookies as Record<string, string | undefined> | undefined)?.[AUTH_COOKIE] ?? null
  const token = bearer ?? cookie
  if (!token) return null
  return verifyToken(deps.config.jwtSecret, token)
}

let cachedLocalUserId: string | null = null

/** The single owner of a self-hosted instance, created on first use. */
async function localUserId(deps: RouteDeps): Promise<string> {
  if (cachedLocalUserId) {
    const existing = await deps.store.getUser(cachedLocalUserId)
    if (existing) return existing.id
  }
  const users = await deps.store.listUsers()
  const owner = users.find((user) => user.role === 'admin') ?? users[0]
  if (owner) {
    cachedLocalUserId = owner.id
    return owner.id
  }
  const created = await deps.store.createUser({ displayName: '本机用户' })
  await deps.store.setUserRole(created.id, 'admin')
  cachedLocalUserId = created.id
  return created.id
}

export async function requireAuth(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const auth = await authenticate(deps, request)
  if (!auth) {
    await reply.code(401).send({ error: { code: 'unauthorized', message: '请先登录' } })
    return null
  }
  return auth
}

export async function requireAdmin(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const auth = await requireAuth(deps, request, reply)
  if (!auth) return null
  if (auth.role !== 'admin') {
    await reply.code(403).send({ error: { code: 'forbidden', message: '需要管理员权限' } })
    return null
  }
  return auth
}
