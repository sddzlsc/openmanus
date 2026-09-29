import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { newId } from '../lib/ids.js'
import { NotFoundError } from '../lib/errors.js'
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
}
