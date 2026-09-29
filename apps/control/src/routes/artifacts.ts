import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { newToken } from '../lib/ids.js'
import { NotFoundError } from '../lib/errors.js'
import { authenticate, requireAuth, type RouteDeps } from '../routeDeps.js'
import { markdownToDocx } from '../services/docx.js'
import { AppError } from '../lib/errors.js'

const shareSchema = z.object({ enabled: z.boolean() })

export async function registerArtifactRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get('/api/artifacts', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { taskId, projectId } = request.query as { taskId?: string; projectId?: string }
    return { artifacts: await deps.store.listArtifacts({ userId: auth.userId, taskId, projectId }) }
  })

  app.get('/api/artifacts/:id', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const artifact = await deps.store.getArtifact(id)
    if (!artifact || artifact.userId !== auth.userId) throw new NotFoundError('交付物不存在')
    return { artifact }
  })

  app.post('/api/artifacts/:id/share', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const { enabled } = shareSchema.parse(request.body ?? {})
    const artifact = await deps.store.getArtifact(id)
    if (!artifact || artifact.userId !== auth.userId) throw new NotFoundError('交付物不存在')
    const shareSlug = enabled ? (artifact.shareSlug ?? newToken(12)) : artifact.shareSlug
    const updated = await deps.store.updateArtifact(id, { shareEnabled: enabled, shareSlug })
    return {
      artifact: updated,
      // `/share/<slug>` — verified against a real content blocker: `/s/` and
      // `/pub/` are blocked prefixes (ad/short-link rules) and made shared
      // links unopenable (net::ERR_BLOCKED_BY_CLIENT) even though the server
      // answered 200. `/share/` and `/artifact/` pass.
      // Share links carry the slug as a query parameter: content blockers
      // reject opaque share paths (`/s/`, `/pub/`, `/share/`) at navigation
      // level with net::ERR_BLOCKED_BY_CLIENT even though the server answers
      // 200. `/deliverable?slug=` is verified to open.
      shareUrl: enabled && shareSlug ? `${publicBase()}/deliverable?slug=${shareSlug}` : null,
    }
  })

  /**
   * Public artifact metadata. `/share` is canonical; `/pub` and `/s` stay as
   * aliases so previously handed-out links keep working outside blockers.
   */
  const shareHandler = async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string }
    const artifact = await deps.store.getArtifactByShareSlug(slug)
    if (!artifact) throw new NotFoundError('分享链接不存在或已关闭')
    const project = await deps.store.getProject(artifact.projectId)
    return { artifact, project }
  }
  /**
   * Canonical JSON surface for the public page (`/api/...` is never on a
   * blocker list); the path-style aliases stay for previously shared links.
   */
  app.get('/api/public/artifacts/:slug', shareHandler)
  app.get('/share/:slug', shareHandler)
  app.get('/pub/:slug', shareHandler)
  app.get('/s/:slug', shareHandler)

  app.get('/files/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const artifact = await deps.store.getArtifact(id)
    if (!artifact) throw new NotFoundError('交付物不存在')
    if (!artifact.shareEnabled) {
      const auth = await authenticate(deps, request)
      if (!auth || auth.userId !== artifact.userId) {
        return reply.code(401).send({ error: { code: 'unauthorized', message: '请先登录' } })
      }
    }
    const project = await deps.store.getProject(artifact.projectId)
    if (!project) throw new NotFoundError('项目不存在')
    const absolute = resolveInside(path.join(deps.config.workspaceRoot, project.workspaceKey), artifact.path)
    if (!absolute) throw new NotFoundError('文件路径非法')
    const download = (request.query as { download?: string }).download === '1'
    return sendFile(reply, absolute, artifact.mime, artifact.name, download)
  })

  /**
   * Word export: converts text deliverables (Markdown / plain text / HTML-ish
   * markdown) into a real .docx so "reports are always available as Word",
   * including reports generated before this feature existed.
   */
  app.get('/api/artifacts/:id/export.docx', async (request, reply) => {
    const { id } = request.params as { id: string }
    const artifact = await deps.store.getArtifact(id)
    if (!artifact) throw new NotFoundError('交付物不存在')
    if (artifact.userId !== undefined && !artifact.shareEnabled) {
      const auth = await authenticate(deps, request)
      if (!auth || auth.userId !== artifact.userId) {
        return reply.code(401).send({ error: { code: 'unauthorized', message: '请先登录' } })
      }
    }
    if (/\.(docx|pptx|xlsx|pdf|png|jpe?g|webp|svg|mp4|mp3|wav|zip)$/i.test(artifact.name)) {
      throw new AppError('unsupported_export', '该交付物已经是最终格式，请直接下载原文件。', 400)
    }
    const project = await deps.store.getProject(artifact.projectId)
    if (!project) throw new NotFoundError('项目不存在')
    const absolute = resolveInside(path.join(deps.config.workspaceRoot, project.workspaceKey), artifact.path)
    if (!absolute) throw new NotFoundError('文件路径非法')

    const raw = await readFile(absolute, 'utf8').catch(() => null)
    if (raw === null) throw new NotFoundError('源文件不存在或已被清理')
    const markdown = raw.replace(/<!doctype[^>]*>/i, '').replace(/<[^>]+>/g, '')
    // Only add a filename-derived title when the document does not already open
    // with its own heading, otherwise Word shows the title twice.
    const firstLine = markdown.trimStart().split('\n')[0] ?? ''
    const title = /^#{1,6}\s/.test(firstLine) ? '' : artifact.name.replace(/\.[^.]+$/, '')
    const docx = markdownToDocx(markdown, title)
    const filename = `${artifact.name.replace(/\.[^.]+$/, '')}.docx`
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    reply.header('content-length', String(docx.byteLength))
    reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    return reply.send(Buffer.from(docx))
  })

  app.get('/preview/:projectId/*', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const rest = (request.params as Record<string, string>)['*'] ?? 'index.html'
    const project = await deps.store.getProject(projectId)
    if (!project) throw new NotFoundError('项目不存在')

    if (!(await maybeAllowPublicPreview(deps, request, reply, projectId))) return

    const workspace = path.join(deps.config.workspaceRoot, project.workspaceKey)
    const target = resolveInside(workspace, rest.endsWith('/') || rest === '' ? `${rest}index.html` : rest)
    if (!target) throw new NotFoundError('路径非法')
    return sendFile(reply, target, mimeFor(target), path.basename(target), false)
  })
}

async function maybeAllowPublicPreview(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string,
): Promise<boolean> {
  const auth = await authenticate(deps, request)
  if (auth) return true
  const shared = await deps.store.listArtifacts({ projectId })
  if (shared.some((artifact) => artifact.shareEnabled)) return true
  await reply.code(401).send({ error: { code: 'unauthorized', message: '预览需要登录，或先分享交付物' } })
  return false
}

function resolveInside(root: string, relative: string): string | null {
  const decoded = decodeURIComponent(relative)
  const resolved = path.resolve(root, decoded)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

async function sendFile(
  reply: FastifyReply,
  absolute: string,
  mime: string,
  name: string,
  download: boolean,
) {
  try {
    const info = await stat(absolute)
    if (!info.isFile()) throw new Error('not a file')
    reply.header('content-type', normalizeContentType(mime))
    reply.header('content-length', String(info.size))
    // Deliverables are regenerated in place, so a cached copy would keep showing
    // an older revision after the user clicks download again.
    reply.header('cache-control', 'no-store, max-age=0')
    if (download) {
      reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
    }
    return reply.send(createReadStream(absolute))
  } catch {
    throw new NotFoundError('文件不存在或已被清理（沙箱工作区可能已回收）')
  }
}

/**
 * Browsers fall back to a locale encoding when a textual response carries no
 * charset, which turns UTF-8 Chinese into mojibake (the classic "乱码" report).
 * Markdown is downgraded to `text/plain` so it renders inline instead of being
 * downloaded by browsers that have no `text/markdown` viewer.
 */
export function normalizeContentType(mime: string): string {
  const lower = mime.toLowerCase()
  if (lower.startsWith('text/markdown') || lower.startsWith('text/x-markdown')) {
    return 'text/plain; charset=utf-8'
  }
  if (lower.includes('charset=')) return mime
  const textual =
    lower.startsWith('text/') ||
    lower === 'application/json' ||
    lower === 'application/xml' ||
    lower === 'image/svg+xml'
  return textual ? `${mime}; charset=utf-8` : mime
}

function mimeFor(file: string): string {
  const ext = path.extname(file).toLowerCase()
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  }
  return map[ext] ?? 'application/octet-stream'
}

export { mimeFor }

function publicBase(): string {
  return process.env.PUBLIC_BASE_URL ?? ''
}
