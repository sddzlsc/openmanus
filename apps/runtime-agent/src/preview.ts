import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, request as httpRequest, type Server } from 'node:http'
import path from 'node:path'
import { inferMime } from './drivers/artifacts.js'

/**
 * Static preview server for the workspace, bound to the container's preview
 * port. In production the edge proxy routes `s-<projectId>.<domain>` here.
 */
export function startPreviewServer(workspace: string, port: number): Promise<Server> {
  const apiPort = Number(process.env.PROJECT_API_PORT ?? 8788)
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)

    // `/api/*` → the generated project's backend.
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const proxy = httpRequest(
        { host: '127.0.0.1', port: apiPort, path: url.pathname + url.search, method: request.method, headers: request.headers },
        (upstream) => {
          response.writeHead(upstream.statusCode ?? 502, upstream.headers)
          upstream.pipe(response)
        },
      )
      proxy.on('error', () => {
        response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: '项目后端未启动（api/server.mjs）' }))
      })
      request.pipe(proxy)
      return
    }

    // `/admin/*` → the admin console; everything else → the website (falling
    // back to the workspace root for single-page projects).
    let root = workspace
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      root = path.join(workspace, 'admin')
      pathname = pathname.replace(/^\/admin/, '') || '/'
    } else {
      const siteRoot = path.join(workspace, 'site')
      try {
        await stat(siteRoot)
        root = siteRoot
      } catch {
        root = workspace
      }
    }

    const relative = pathname === '/' ? '/index.html' : pathname
    const resolved = path.resolve(root, `.${relative}`)
    if (!resolved.startsWith(path.resolve(root))) {
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
