import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { newId } from '../lib/ids.js'
import { AppError, NotFoundError } from '../lib/errors.js'
import { requireAuth, type RouteDeps } from '../routeDeps.js'
import { sendWorkspaceZip } from './tasks.js'

const createSchema = z.object({
  name: z.string().min(1).max(80),
  environment: z.enum(['task-sandbox', 'project-workspace']).optional(),
})

export async function registerProjectRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get('/api/projects', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    return { projects: await deps.store.listProjects(auth.userId) }
  })

  app.post('/api/projects', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const body = createSchema.parse(request.body ?? {})
    const id = newId('prj')
    const project = await deps.store.createProject({
      id,
      userId: auth.userId,
      name: body.name,
      workspaceKey: `ws_${id}`,
      environment: body.environment ?? 'project-workspace',
      previewDomain: `s-${id}.${deps.config.previewDomain}`,
    })
    return reply.code(201).send({ project })
  })

  app.get('/api/projects/:id', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const project = await deps.store.getProject(id)
    if (!project || project.userId !== auth.userId) throw new NotFoundError('项目不存在')
    const [tasks, artifacts] = await Promise.all([
      deps.store.listTasks(auth.userId),
      deps.store.listArtifacts({ projectId: project.id }),
    ])
    return { project, tasks: tasks.filter((task) => task.projectId === project.id), artifacts }
  })

  app.delete('/api/projects/:id', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const project = await deps.store.getProject(id)
    if (!project || project.userId !== auth.userId) throw new NotFoundError('项目不存在')
    await deps.store.deleteProject(id)
    return { ok: true }
  })

  /** Export every workspace file of the project as one zip. */
  app.get('/api/projects/:id/export', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const project = await deps.store.getProject(id)
    if (!project || project.userId !== auth.userId) throw new NotFoundError('项目不存在')
    return sendWorkspaceZip(reply, deps, project.workspaceKey, project.name)
  })

  /**
   * Cloud computer: a project-owned runtime that stays up between tasks, so
   * installed tools, background services and long-running work persist.
   */
  app.post('/api/projects/:id/runtime', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    let project = await deps.store.getProject(id)
    if (!project || project.userId !== auth.userId) throw new NotFoundError('项目不存在')
    if (!deps.runtimeProvider.ensureProjectRuntime) {
      throw new AppError('unsupported', '当前沙箱提供者不支持常驻环境（需要 SANDBOX_PROVIDER=docker）', 400)
    }
    if (project.environment !== 'cloud-computer') {
      project = (await deps.store.touchProject(id, { environment: 'cloud-computer' })) ?? project
    }
    const runtime = await deps.runtimeProvider.ensureProjectRuntime(project)
    await deps.store.upsertContainer(runtime)
    return { runtime, project }
  })

  app.get('/api/projects/:id/runtime', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const project = await deps.store.getProject(id)
    if (!project || project.userId !== auth.userId) throw new NotFoundError('项目不存在')
    return { project, runtime: await deps.store.findRunningContainerForProject(id) }
  })

  app.delete('/api/projects/:id/runtime', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const project = await deps.store.getProject(id)
    if (!project || project.userId !== auth.userId) throw new NotFoundError('项目不存在')
    await deps.runtimeProvider.stopProjectRuntime?.(id)
    await deps.store.touchProject(id, { environment: 'task-sandbox' })
    return { ok: true }
  })
}
