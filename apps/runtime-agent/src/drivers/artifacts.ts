import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { ArtifactKind, RuntimeEvent } from '@wiwana/protocol'

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '__pycache__', '.cache', 'venv', '.venv'])

/**
 * Scan the workspace and describe every deliverable file the agent produced.
 * Recursive (bounded) on purpose: agents routinely write into `output/`,
 * `assets/` or a per-deliverable subdirectory, and a top-level-only scan made
 * those files invisible in the product. Unknown extensions still register as
 * `file` so nothing a user is expected to download can be lost.
 */
export async function collectArtifacts(workspace: string, maxDepth = 3): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = []

  const walk = async (dir: string, depth: number, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (depth >= maxDepth || SKIP_DIRS.has(entry.name)) continue
        await walk(path.join(dir, entry.name), depth + 1, relative)
        continue
      }
      if (!entry.isFile()) continue
      events.push({
        type: 'artifact',
        path: relative,
        kind: inferKind(entry.name),
        name: entry.name,
        mime: inferMime(entry.name),
      })
    }
  }

  await walk(workspace, 0, '')
  return events
}

export function inferKind(name: string): ArtifactKind {
  const extension = path.extname(name).toLowerCase()
  switch (extension) {
    case '.docx':
    case '.doc':
    case '.md':
      return 'doc'
    case '.xlsx':
    case '.xls':
      return 'sheet'
    case '.pptx':
    case '.ppt':
      return 'slides'
    case '.pdf':
      return 'pdf'
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
      return 'image'
    case '.svg':
      return 'chart'
    case '.mp4':
    case '.mov':
      return 'video'
    case '.mp3':
    case '.wav':
      return 'audio'
    case '.html':
      return 'website'
    case '.csv':
    case '.json':
      return 'dataset'
    case '.css':
    case '.js':
    case '.ts':
    case '.py':
    case '.sh':
      return 'code'
    default:
      return 'file'
  }
}

export function inferMime(name: string): string {
  const extension = path.extname(name).toLowerCase()
  const map: Record<string, string> = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
  }
  return map[extension] ?? 'application/octet-stream'
}
