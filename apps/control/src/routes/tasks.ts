import type { FastifyInstance } from 'fastify'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { zipSync } from 'fflate'
import { z } from 'zod'
import { newId } from '../lib/ids.js'
import { NotFoundError } from '../lib/errors.js'
import { requireAuth, type RouteDeps } from '../routeDeps.js'
import { scanWorkspaceFiles } from '../services/workspaceScanner.js'
import { createTaskForUser } from '../services/taskFactory.js'
import type { Artifact, TaskEvent } from '@wiwana/protocol'

const createSchema = z.object({
  projectId: z.string().optional(),
  type: z.enum(['office', 'data', 'web', 'fullstack', 'media', 'research', 'automation']),
  title: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(20000),
  attachmentIds: z.array(z.string()).optional(),
})

const messageSchema = z.object({ text: z.string().min(1).max(8000) })

export async function registerTaskRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post('/api/tasks', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const body = createSchema.parse(request.body ?? {})

    const attachmentNote =
      body.attachmentIds && body.attachmentIds.length > 0
        ? `\n\n（随任务上传的附件：${body.attachmentIds.join(', ')}，位于工作区 uploads/ 目录）`
        : ''

    const { task, project } = await createTaskForUser(
      { store: deps.store, config: deps.config, enqueue: (taskId) => deps.runner.enqueue(taskId) },
      {
        userId: auth.userId,
        type: body.type,
        prompt: body.prompt + attachmentNote,
        title: body.title ?? defaultTitle(body.prompt),
        projectId: body.projectId ?? null,
        origin: 'web',
      },
    )
    return reply.code(201).send({ task, project })
  })

  app.get('/api/tasks', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const limit = Number((request.query as { limit?: string }).limit ?? 50)
    return { tasks: await deps.store.listTasks(auth.userId, Number.isFinite(limit) ? limit : 50) }
  })

  app.get('/api/tasks/:id', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const task = await deps.store.getTask(id)
    if (!task || task.userId !== auth.userId) throw new NotFoundError('任务不存在')
    const project = await deps.store.getProject(task.projectId)
    if (!project) throw new NotFoundError('项目不存在')
    const artifacts = await deps.store.listArtifacts({ taskId: task.id })
    return { task, project, artifacts }
  })

  app.post('/api/tasks/:id/messages', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const body = messageSchema.parse(request.body ?? {})
    const task = await deps.store.getTask(id)
    if (!task || task.userId !== auth.userId) throw new NotFoundError('任务不存在')
    await deps.runner.sendMessage(id, body.text)
    return reply.code(202).send({ ok: true })
  })

  app.post('/api/tasks/:id/cancel', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const task = await deps.store.getTask(id)
    if (!task || task.userId !== auth.userId) throw new NotFoundError('任务不存在')
    await deps.runner.cancel(id)
    return { ok: true }
  })

  app.get('/api/tasks/:id/stream', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const task = await deps.store.getTask(id)
    if (!task || task.userId !== auth.userId) throw new NotFoundError('任务不存在')

    const headerSeq = Number(request.headers['last-event-id'] ?? 0)
    const querySeq = Number((request.query as { from?: string }).from ?? 0)
    const fromSeq = Number.isFinite(headerSeq) && headerSeq > 0 ? headerSeq : Number.isFinite(querySeq) ? querySeq : 0
    const once = (request.query as { once?: string }).once === '1'

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    reply.raw.write(': connected\n\n')

    const write = (event: TaskEvent) => {
      reply.raw.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    }
    for (const event of await deps.store.listTaskEvents(id, fromSeq)) write(event)
    if (once) {
      reply.raw.end()
      return reply
    }

    const unsubscribe = deps.bus.subscribe(id, write)
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15000)
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
    return reply
  })

  /**
   * Re-scan the workspace and register files the agent produced but never
   * reported (late writes, nested output dirs, unknown extensions). Safe to
   * call repeatedly: already-registered paths are skipped.
   */
  app.post('/api/tasks/:id/rescan', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const task = await deps.store.getTask(id)
    if (!task || task.userId !== auth.userId) throw new NotFoundError('任务不存在')
    const project = await deps.store.getProject(task.projectId)
    if (!project) throw new NotFoundError('项目不存在')

    const root = path.join(deps.config.workspaceRoot, project.workspaceKey)
    const scanned = await scanWorkspaceFiles(root)
    const known = new Set((await deps.store.listArtifacts({ taskId: task.id })).map((item) => item.path))

    const added: Artifact[] = []
    for (const file of scanned) {
      if (known.has(file.path)) continue
      const artifactId = newId('art')
      const isWebsiteEntry = file.kind === 'website' || file.path.endsWith('.html')
      const artifact = await deps.store.createArtifact({
        id: artifactId,
        taskId: task.id,
        projectId: project.id,
        userId: task.userId,
        kind: file.kind,
        name: file.name,
        path: file.path,
        mime: file.mime,
        sizeBytes: file.sizeBytes,
        previewUrl: isWebsiteEntry ? `/preview/${project.id}/${file.path}` : `/files/${artifactId}`,
        downloadUrl: `/files/${artifactId}?download=1`,
        shareEnabled: false,
        shareSlug: null,
      })
      const event = await deps.store.appendTaskEvent(task.id, {
        type: 'artifact',
        seq: 0,
        at: new Date().toISOString(),
        artifact,
      } as TaskEvent)
      deps.bus.publish(task.id, event)
      added.push(artifact)
    }
    return { added, scanned: scanned.length }
  })

  /** One-click export of every workspace file for this task. */
  app.get('/api/tasks/:id/export', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const task = await deps.store.getTask(id)
    if (!task || task.userId !== auth.userId) throw new NotFoundError('任务不存在')
    const project = await deps.store.getProject(task.projectId)
    if (!project) throw new NotFoundError('项目不存在')
    return sendWorkspaceZip(reply, deps, project.workspaceKey, task.title)
  })
}

/** Shared by task- and project-level export. */
export async function sendWorkspaceZip(
  reply: import('fastify').FastifyReply,
  deps: RouteDeps,
  workspaceKey: string,
  filename: string,
) {
  const root = path.join(deps.config.workspaceRoot, workspaceKey)
  const files = await scanWorkspaceFiles(root)
  if (files.length === 0) throw new NotFoundError('工作区里没有可导出的文件（可能已随沙箱回收）')

  const entries: Record<string, Uint8Array> = {}
  for (const file of files) {
    entries[file.path] = new Uint8Array(await readFile(path.join(root, file.path)))
  }
  const zipped = zipSync(entries, { level: 6 })
  reply.header('content-type', 'application/zip')
  reply.header('content-length', String(zipped.byteLength))
  reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${filename}.zip`)}`)
  return reply.send(Buffer.from(zipped))
}

function defaultTitle(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim()
  return cleaned.length > 24 ? `${cleaned.slice(0, 24)}…` : cleaned || '新任务'
}

function defaultProjectName(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim()
  return cleaned.length > 16 ? `${cleaned.slice(0, 16)}…` : cleaned || '新项目'
}
