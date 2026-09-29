import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import type { RuntimeEvent } from '@wiwana/protocol'

export interface ScreenWatcherOptions {
  scriptPath: string
  previewUrl: string
  intervalMs: number
  timeoutMs: number
  /** Stops the loop as soon as the session is finished or cancelled. */
  shouldContinue?: () => boolean
}

/**
 * Live "computer view": while a task runs, screenshot the project's preview page
 * on a timer and push the frame into the task timeline. Frames are small JPEGs
 * (960×600, quality 55) so the SSE payload stays around 30–60 KB.
 */
export class ScreenWatcher {
  private timer: NodeJS.Timeout | null = null
  private capturing = false

  constructor(
    private readonly options: ScreenWatcherOptions,
    private readonly emit: (event: RuntimeEvent) => void,
  ) {}

  start(caption = '实时预览'): void {
    if (this.timer) return
    void this.capture(caption)
    this.timer = setInterval(() => void this.capture(caption), this.options.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async capture(caption: string): Promise<void> {
    if (this.options.shouldContinue && !this.options.shouldContinue()) {
      this.stop()
      return
    }
    if (this.capturing) return
    this.capturing = true
    const out = `/tmp/wiwana-screen-${Date.now()}.jpg`
    try {
      const result = await run(this.options.scriptPath, ['--url', this.options.previewUrl, '--out', out], this.options.timeoutMs)
      if (!result.startsWith('ok ')) return
      const bytes = await readFile(out)
      if (bytes.byteLength === 0) return
      this.emit({
        type: 'screenshot',
        dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
        caption,
      })
    } catch {
      // A frame that cannot be captured is simply not emitted.
    } finally {
      this.capturing = false
    }
  }
}

function run(script: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('python3', [script, ...args], { env: process.env })
    let stdout = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve('')
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(stdout.trim())
    })
  })
}
