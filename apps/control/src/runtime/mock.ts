import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RuntimeEvent } from '@wiwana/protocol'
import type { RuntimeHandle, RuntimeProvider, StartTaskInput } from './provider.js'

/**
 * Development runtime: no Docker and no dsh required. It writes real files into
 * the workspace and replays a realistic event sequence so the whole product
 * (task console, SSE timeline, artifacts, share links) is demoable offline.
 */
export class MockRuntimeProvider implements RuntimeProvider {
  readonly kind = 'mock' as const

  constructor(private readonly options: { workspaceRoot: string; durationMs: number }) {}

  async startTask(input: StartTaskInput): Promise<RuntimeHandle> {
    const workspace = path.join(this.options.workspaceRoot, input.project.workspaceKey)
    await mkdir(workspace, { recursive: true })
    const handle = new MockHandle(workspace, input, this.options.durationMs)
    void handle.start()
    return handle
  }

  async dispose() {}
}

class MockHandle implements RuntimeHandle {
  readonly containerId: string | null = null
  readonly sessionId: string
  readonly previewPort: number | null = null
  private listeners = new Set<(event: RuntimeEvent) => void>()
  private cancelled = false
  private awaitingUser = false
  private queued: string[] = []

  constructor(
    private readonly workspace: string,
    private readonly input: StartTaskInput,
    private readonly durationMs: number,
  ) {
    this.sessionId = `mock-${input.task.id}`
  }

  onEvent(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async send(text: string) {
    this.queued.push(text)
    this.emit({ type: 'message', role: 'system', text: `已收到补充说明：${text}` })
    if (this.awaitingUser) {
      this.emit({ type: 'status', status: 'running', progress: 45, note: '收到补充说明，继续执行' })
      this.awaitingUser = false
    }
  }

  async cancel() {
    this.cancelled = true
    this.emit({ type: 'status', status: 'cancelled', progress: 0, note: '任务已取消' })
  }

  async dispose() {
    this.listeners.clear()
  }

  private emit(event: RuntimeEvent) {
    for (const listener of this.listeners) listener(event)
  }

  async start() {
    const { task, capabilityPacks } = this.input
    const step = Math.max(300, Math.floor(this.durationMs / 8))
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const steps: Array<() => Promise<void>> = [
      async () => {
        this.emit({ type: 'status', status: 'running', progress: 5, note: '正在理解任务' })
        this.emit({ type: 'thought', text: `分析需求：${task.prompt.slice(0, 120)}` })
        await wait(step)
      },
      async () => {
        this.emit({ type: 'tool', name: 'plan', summary: '拆解任务并制定执行计划', status: 'started' })
        this.emit({ type: 'status', status: 'running', progress: 18, note: `加载能力包：${capabilityPacks.join(', ')}` })
        await wait(step)
        this.emit({ type: 'tool', name: 'plan', summary: '拆解任务并制定执行计划', status: 'finished' })
      },
      async () => {
        this.emit({ type: 'tool', name: 'bash', summary: '准备沙箱工作区与依赖', status: 'started' })
        this.emit({ type: 'terminal', text: '$ pwd\n/workspace\n$ ls -la\n(total 0)\n' })
        await wait(step)
        this.emit({ type: 'tool', name: 'bash', summary: '准备沙箱工作区与依赖', status: 'finished' })
      },
      async () => {
        this.emit({ type: 'status', status: 'running', progress: 40, note: '生成交付物' })
        const artifacts = await this.produceArtifacts()
        for (const artifact of artifacts) {
          this.emit(artifact)
          await wait(Math.floor(step / 2))
        }
      },
      async () => {
        this.emit({ type: 'usage', tokens: 4200, ...usageFor(task.type) })
        this.emit({ type: 'status', status: 'running', progress: 85, note: '校验结果' })
        this.emit({ type: 'tool', name: 'verify', summary: '检查交付物完整性', status: 'finished' })
        await wait(step)
      },
    ]

    for (const runStep of steps) {
      if (this.cancelled) return
      try {
        await runStep()
      } catch (error) {
        this.emit({ type: 'error', message: error instanceof Error ? error.message : String(error), retryable: true })
        return
      }
    }

    if (this.cancelled) return
    this.emit({
      type: 'done',
      summary: `已完成「${task.title}」，共生成交付物文件，可在交付物中心查看或分享。`,
    })
  }

  private async produceArtifacts(): Promise<RuntimeEvent[]> {
    const type = this.input.task.type
    const now = new Date().toISOString().slice(0, 10)
    const files: Array<{
      name: string
      kind: 'doc' | 'sheet' | 'slides' | 'chart' | 'dataset' | 'website' | 'image' | 'code'
      mime: string
      content: string
    }> = []

    if (type === 'office') {
      files.push({
        name: 'report.md',
        kind: 'doc',
        mime: 'text/markdown; charset=utf-8',
        content: `# ${this.input.task.title}\n\n> 生成时间：${now}（开发环境示例交付物）\n\n## 任务\n${this.input.task.prompt}\n\n## 结论\n- 已按需求完成初稿结构\n- 下一步可继续对话要求修改\n`,
      })
      files.push({
        name: 'workbook.csv',
        kind: 'sheet',
        mime: 'text/csv',
        content: '项目,负责人,状态,进度\n需求澄清,Agent,完成,100%\n初稿生成,Agent,完成,100%\n评审修改,用户,待办,0%\n',
      })
      files.push({
        name: 'slides.md',
        kind: 'slides',
        mime: 'text/markdown; charset=utf-8',
        content: `# ${this.input.task.title}\n\n---\n\n## 背景\n${this.input.task.prompt}\n\n---\n\n## 方案\n1. 现状\n2. 方案\n3. 收益\n`,
      })
      files.push({
        name: 'chart.svg',
        kind: 'chart',
        mime: 'image/svg+xml',
        content: svgChart('完成度', [['需求', 100], ['初稿', 80], ['评审', 30]]),
      })
    } else if (type === 'web') {
      files.push({
        name: 'index.html',
        kind: 'website',
        mime: 'text/html',
        content: `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(this.input.task.title)}</title><link rel="stylesheet" href="./styles.css"></head><body><main><h1>${escapeHtml(this.input.task.title)}</h1><p>${escapeHtml(this.input.task.prompt.slice(0, 160))}</p><button id="cta">开始体验</button><p id="out"></p></main><script src="./app.js"></script></body></html>`,
      })
      files.push({
        name: 'styles.css',
        kind: 'code',
        mime: 'text/css',
        content: `:root{color-scheme:light}body{margin:0;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f6f7fb;color:#16181d}main{max-width:720px;margin:12vh auto;padding:48px;background:#fff;border-radius:24px;box-shadow:0 24px 60px rgba(16,24,40,.08)}h1{font-size:40px;margin:0 0 12px}button{margin-top:24px;padding:12px 20px;border:0;border-radius:12px;background:#16181d;color:#fff;font-size:16px;cursor:pointer}`,
      })
      files.push({
        name: 'app.js',
        kind: 'code',
        mime: 'text/javascript',
        content: `document.getElementById('cta')?.addEventListener('click',()=>{document.getElementById('out').textContent='由 Wiwana 智能体生成 · '+new Date().toLocaleString('zh-CN')})`,
      })
    } else if (type === 'data') {
      files.push({
        name: 'data.csv',
        kind: 'dataset',
        mime: 'text/csv',
        content: '月份,销售额,同比\n1月,128,12%\n2月,143,18%\n3月,171,24%\n4月,166,15%\n',
      })
      files.push({
        name: 'chart.svg',
        kind: 'chart',
        mime: 'image/svg+xml',
        content: svgChart('销售额趋势', [['1月', 128], ['2月', 143], ['3月', 171], ['4月', 166]]),
      })
      files.push({
        name: 'analysis.md',
        kind: 'doc',
        mime: 'text/markdown; charset=utf-8',
        content: `# 数据分析报告\n\n- 数据区间：近 4 个月\n- 结论：3 月达到峰值，4 月小幅回落\n- 建议：关注 3 月增长动因并复制到 4 月渠道\n`,
      })
    } else if (type === 'media') {
      files.push({
        name: 'cover.svg',
        kind: 'image',
        mime: 'image/svg+xml',
        content: svgPoster(this.input.task.prompt.slice(0, 40) || this.input.task.title),
      })
      files.push({
        name: 'prompt-notes.md',
        kind: 'doc',
        mime: 'text/markdown; charset=utf-8',
        content: `# 生成说明\n\n提示词：${this.input.task.prompt}\n\n生产环境将由能力包调用通义万相 / 可灵 / 音乐生成 API 输出图片、视频与音频文件。\n`,
      })
    } else {
      files.push({
        name: 'findings.md',
        kind: 'doc',
        mime: 'text/markdown; charset=utf-8',
        content: `# 调研纪要（开发环境示例）\n\n${this.input.task.prompt}\n\n> M4/M5 将接入浏览器自动化与并行子智能体，输出完整调研报告。\n`,
      })
    }

    const events: RuntimeEvent[] = []
    for (const file of files) {
      const target = path.join(this.workspace, file.name)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, file.content, 'utf8')
      events.push({ type: 'artifact', path: file.name, kind: file.kind, name: file.name, mime: file.mime })
      this.emit({ type: 'terminal', text: `$ write ${file.name}\n` })
    }
    return events
  }
}

function usageFor(type: string): { images?: number; videos?: number } {
  if (type === 'media') return { images: 1 }
  return {}
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function svgChart(title: string, rows: Array<[string, number]>): string {
  const max = Math.max(...rows.map(([, v]) => v), 1)
  const bars = rows
    .map(([label, value], index) => {
      const height = Math.round((value / max) * 140)
      return `<rect x="${40 + index * 90}" y="${190 - height}" width="52" height="${height}" rx="8" fill="#4f46e5"/><text x="${66 + index * 90}" y="212" font-size="12" text-anchor="middle" fill="#475467">${label}</text><text x="${66 + index * 90}" y="${180 - height}" font-size="12" text-anchor="middle" fill="#16181d">${value}</text>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="240" viewBox="0 0 420 240"><rect width="420" height="240" fill="#fff"/><text x="24" y="32" font-size="16" font-weight="600" fill="#16181d">${escapeHtml(title)}</text>${bars}</svg>`
}

function svgPoster(text: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><text x="40" y="180" font-size="34" font-family="system-ui" fill="#fff">${escapeHtml(text)}</text><text x="40" y="320" font-size="18" font-family="system-ui" fill="rgba(255,255,255,.8)">Wiwana Agent · 开发环境示例</text></svg>`
}
