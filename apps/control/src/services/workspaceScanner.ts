import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ArtifactKind } from '@wiwana/protocol'

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '__pycache__', '.cache', 'venv', '.venv'])

export interface ScannedFile {
  /** Path relative to the workspace root. */
  path: string
  name: string
  kind: ArtifactKind
  mime: string
  sizeBytes: number
}

/**
 * Recursive workspace scan used by the rescan endpoint. Mirrors the runtime
 * agent's artifact rules so a file the agent produced but failed to register
 * (late writes, nested directories, unknown extensions) can still be exported.
 */
export async function scanWorkspaceFiles(root: string, maxDepth = 3): Promise<ScannedFile[]> {
  const files: ScannedFile[] = []

  const walk = async (dir: string, depth: number, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const absolute = path.join(dir, entry.name)
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (depth >= maxDepth || SKIP_DIRS.has(entry.name)) continue
        await walk(absolute, depth + 1, relative)
        continue
      }
      if (!entry.isFile()) continue
      const info = await stat(absolute).catch(() => null)
      if (!info) continue
      files.push({
        path: relative,
        name: entry.name,
        kind: inferKind(entry.name),
        mime: inferMime(entry.name),
        sizeBytes: info.size,
      })
    }
  }

  await walk(root, 0, '')
  return files
}

export function inferKind(name: string): ArtifactKind {
  switch (path.extname(name).toLowerCase()) {
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
    '.py': 'text/x-python; charset=utf-8',
    '.zip': 'application/zip',
  }
  return map[extension] ?? 'application/octet-stream'
}
