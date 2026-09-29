import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AppConfig } from './config.js'
import type { Store } from './store/types.js'
import type { TaskRunner } from './services/taskRunner.js'
import type { QuotaService } from './services/quota.js'
import type { TaskEventBus } from './services/bus.js'
import type { AutomationScheduler } from './services/automationScheduler.js'
import type { RuntimeProvider } from './runtime/provider.js'

export interface AuthContext {
  userId: string
  role: 'user' | 'admin'
}

export interface RouteDeps {
  store: Store
  config: AppConfig
  runner: TaskRunner
  quota: QuotaService
  bus: TaskEventBus
  scheduler: AutomationScheduler
  runtimeProvider: RuntimeProvider
}

/**
 * This build has **no accounts**: it is a single-operator, self-hosted tool
 * (see README). Every request acts as the machine's owner, which is what makes
 * a login-free local product possible. The owner row exists so tasks, projects
 * and deliverables keep a stable owner id.
 */
let cachedOwnerId: string | null = null

export async function currentOwner(deps: RouteDeps): Promise<AuthContext> {
  if (cachedOwnerId) {
    const existing = await deps.store.getUser(cachedOwnerId)
    if (existing) return { userId: existing.id, role: 'admin' }
  }
  const users = await deps.store.listUsers()
  const owner = users.find((user) => user.role === 'admin') ?? users[0]
  if (owner) {
    cachedOwnerId = owner.id
    return { userId: owner.id, role: 'admin' }
  }
  const created = await deps.store.createUser({ displayName: '本机用户' })
  await deps.store.setUserRole(created.id, 'admin')
  cachedOwnerId = created.id
  return { userId: created.id, role: 'admin' }
}

/** Kept for call sites that still want the request object; accounts are gone. */
export async function authenticate(deps: RouteDeps, _request: FastifyRequest): Promise<AuthContext> {
  return currentOwner(deps)
}

export async function requireAuth(
  deps: RouteDeps,
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<AuthContext> {
  return authenticate(deps, request)
}

export async function requireAdmin(
  deps: RouteDeps,
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<AuthContext> {
  return authenticate(deps, request)
}
