import { spawn, type ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'

export interface ProjectServicesOptions {
  workspace: string
  apiPort: number
}

/**
 * Keeps the generated project's backend alive inside the sandbox.
 *
 * A full-suite project ships `api/server.mjs` (zero dependencies). The preview
 * server proxies `/api/*` to it, so one preview URL serves the website, the
 * admin console and the API — no extra published port, no routing changes.
 */
export class ProjectServices {
  private child: ChildProcess | null = null
  private stopping = false

  constructor(private readonly options: ProjectServicesOptions) {}

  get apiPort(): number {
    return this.options.apiPort
  }

  /** Starts the API if the workspace has one; safe to call repeatedly. */
  async ensureStarted(): Promise<boolean> {
    if (this.child && this.child.exitCode === null) return true
    const entry = path.join(this.options.workspace, 'api', 'server.mjs')
    try {
      await access(entry)
    } catch {
      return false
    }
    const child = spawn('node', [entry], {
      cwd: path.join(this.options.workspace, 'api'),
      env: { ...process.env, PROJECT_API_PORT: String(this.options.apiPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[project-api] ${chunk.toString()}`))
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[project-api] ${chunk.toString()}`))
    child.on('exit', (code) => {
      this.child = null
      if (!this.stopping && code !== 0) {
        // Restart once after a crash so a mid-task edit does not kill the API.
        setTimeout(() => void this.ensureStarted(), 1500)
      }
    })
    this.child = child
    return true
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.child?.kill('SIGTERM')
    this.child = null
  }
}
