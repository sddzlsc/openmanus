import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { inferMime } from './drivers/artifacts.js'

/**
 * Static preview server for the workspace, bound to the container's preview
 * port. In production the edge proxy routes `s-<projectId>.<domain>` here.
 */
export function startPreviewServer(workspace: string, port: number): Promise<Server> {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const resolved = path.resolve(workspace, `.${relative}`)
    if (!resolved.startsWith(path.resolve(workspace))) {
      response.writeHead(403).end('forbidden')
      return
    }
    try {
      const info = await stat(resolved)
      if (!info.isFile()) throw new Error('not a file')
      response.writeHead(200, {
        'content-type': inferMime(resolved),
        'content-length': String(info.size),
        'cache-control': 'no-store',
      })
      createReadStream(resolved).pipe(response)
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('预览文件不存在')
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => resolve(server))
  })
}
