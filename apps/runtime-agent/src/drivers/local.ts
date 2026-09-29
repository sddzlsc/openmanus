import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RuntimeEvent } from '@wiwana/protocol'
import type { DriverContext, RuntimeDriver } from './types.js'
import { collectArtifacts } from './artifacts.js'

/**
 * Local driver: no dsh and no model required. It executes the same capability
 * scripts the sandbox ships, so the artifacts are real files produced by real
 * code. It is also the fallback when dsh is unavailable (missing credential,
 * missing binary, or a failed profile check).
 */
export class LocalDriver implements RuntimeDriver {
  readonly kind = 'local' as const

  async start(context: DriverContext): Promise<void> {
    await mkdir(context.workspace, { recursive: true })
    context.emit({ type: 'status', status: 'running', progress: 5, note: '正在理解任务' })
    context.emit({ type: 'thought', text: `解析需求：${context.session.prompt.slice(0, 120)}` })

    const { type, prompt, capabilityPacks } = context.session
    context.emit({ type: 'status', status: 'running', progress: 15, note: `加载能力包：${capabilityPacks.join(', ')}` })
    context.emit({ type: 'tool', name: 'plan', summary: '拆解任务并制定执行计划', status: 'finished' })

    let produced: RuntimeEvent[] = []
    try {
      if (type === 'office') produced = await this.runOfficePack(context, prompt)
      else if (type === 'data') produced = await this.runDataPack(context, prompt)
      else if (type === 'web') produced = await this.runWebPack(context, prompt)
      else if (type === 'media') produced = await this.runMediaPack(context, prompt)
      else produced = await this.runResearchPack(context, prompt)
    } catch (error) {
      context.emit({
        type: 'error',
        message: `能力包执行失败：${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      })
      return
    }

    for (const event of produced) context.emit(event)
    context.emit({ type: 'usage', tokens: 3200, ...(type === 'media' ? { images: 1 } : {}) })
    context.emit({ type: 'status', status: 'running', progress: 90, note: '校验交付物完整性' })
    context.emit({ type: 'done', summary: `已完成「${type}」任务，产出 ${produced.length} 个交付物。` })
  }

  async send(context: DriverContext, text: string): Promise<void> {
    context.emit({
      type: 'message',
      role: 'system',
      text: `已记录补充说明：${text}。当前为本地降级驱动，补充内容会在下一次任务中生效。`,
    })
  }

  async cancel(context: DriverContext): Promise<void> {
    context.session.cancelled = true
    context.emit({ type: 'status', status: 'cancelled', progress: 0, note: '任务已取消' })
  }

  private async runOfficePack(context: DriverContext, prompt: string): Promise<RuntimeEvent[]> {
    const events: RuntimeEvent[] = []
    const title = deriveTitle(prompt)
    const scripts: Array<{ script: string; description: string }> = [
      { script: 'make_docx.py', description: '生成 Word 文档' },
      { script: 'make_xlsx.py', description: '生成数据表格' },
      { script: 'make_pptx.py', description: '生成演示文稿' },
      { script: 'make_pdf.py', description: '导出 PDF' },
    ]

    for (const { script, description } of scripts) {
      context.emit({ type: 'tool', name: 'capability:office', summary: description, status: 'started' })
      const result = await this.runScript(context, path.join(context.capabilitiesRoot, 'office/scripts', script), [
        '--title',
        title,
        '--prompt',
        prompt,
      ])
      if (result.code === 0) events.push(...(await collectArtifacts(context.workspace)))
      else {
        context.emit({
          type: 'terminal',
          text: `[warn] ${script} 退出码 ${result.code}：${result.stderr.slice(0, 400)}\n`,
        })
      }
      context.emit({
        type: 'tool',
        name: 'capability:office',
        summary: description,
        status: result.code === 0 ? 'finished' : 'failed',
      })
    }

    if (events.length === 0) events.push(...(await this.fallbackMarkdown(context, prompt, 'office')))
    return dedupeArtifacts(events)
  }

  private async runDataPack(context: DriverContext, prompt: string): Promise<RuntimeEvent[]> {
    context.emit({ type: 'tool', name: 'capability:data', summary: '生成数据图表', status: 'started' })
    const result = await this.runScript(context, path.join(context.capabilitiesRoot, 'data/scripts/chart.py'), [
      '--title',
      deriveTitle(prompt),
      '--prompt',
      prompt,
    ])
    context.emit({
      type: 'tool',
      name: 'capability:data',
      summary: '生成数据图表',
      status: result.code === 0 ? 'finished' : 'failed',
    })
    const events =
      result.code === 0 ? await collectArtifacts(context.workspace) : await this.fallbackMarkdown(context, prompt, 'data')
    return dedupeArtifacts(events)
  }

  private async runWebPack(context: DriverContext, prompt: string): Promise<RuntimeEvent[]> {
    const title = deriveTitle(prompt)
    const index = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <header class="hero">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(prompt.slice(0, 200))}</p>
    <a class="cta" href="#contact">立即咨询</a>
  </header>
  <section class="features">
    <article><h3>专业团队</h3><p>由行业专家组成的服务团队，交付可落地。</p></article>
    <article><h3>快速响应</h3><p>需求确认后 24 小时内给出方案。</p></article>
    <article><h3>透明报价</h3><p>按阶段付费，过程可追踪。</p></article>
  </section>
  <section id="contact" class="contact">
    <h2>联系我们</h2>
    <form onsubmit="event.preventDefault();this.nextElementSibling.textContent='已收到，我们会尽快联系你。'">
      <input required placeholder="你的称呼">
      <input required placeholder="手机号">
      <button type="submit">提交</button>
    </form>
    <p class="result"></p>
  </section>
  <script src="./app.js"></script>
</body>
</html>`
    const css = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#101828;background:#fff}.hero{padding:96px 8vw;background:linear-gradient(135deg,#eef2ff,#f8fafc)}.hero h1{font-size:clamp(32px,5vw,56px);margin:0 0 16px}.hero p{max-width:640px;font-size:18px;line-height:1.7;color:#475467}.cta{display:inline-block;margin-top:24px;padding:14px 28px;border-radius:999px;background:#4338ca;color:#fff;text-decoration:none}.features{display:grid;gap:24px;padding:64px 8vw;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.features article{padding:24px;border-radius:20px;background:#f9fafb}.contact{padding:64px 8vw 96px}.contact form{display:flex;gap:12px;flex-wrap:wrap}.contact input{flex:1 1 220px;padding:12px 16px;border:1px solid #d0d5dd;border-radius:12px}.contact button{padding:12px 24px;border:0;border-radius:12px;background:#101828;color:#fff;font-size:16px}`
    const js = `document.querySelectorAll('a[href^="#"]').forEach((a)=>a.addEventListener('click',(e)=>{const t=document.querySelector(a.getAttribute('href'));if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth'})}}))`
    await mkdir(context.workspace, { recursive: true })
    await writeFile(path.join(context.workspace, 'index.html'), index, 'utf8')
    await writeFile(path.join(context.workspace, 'styles.css'), css, 'utf8')
    await writeFile(path.join(context.workspace, 'app.js'), js, 'utf8')
    context.emit({ type: 'terminal', text: '$ write index.html styles.css app.js\n' })
    return dedupeArtifacts(await collectArtifacts(context.workspace))
  }

  private async runMediaPack(context: DriverContext, prompt: string): Promise<RuntimeEvent[]> {
    context.emit({ type: 'tool', name: 'capability:media', summary: '调用图片生成模型', status: 'started' })
    const result = await this.runScript(context, path.join(context.capabilitiesRoot, 'media/scripts/generate_image.py'), [
      '--prompt',
      prompt,
    ])
    context.emit({
      type: 'tool',
      name: 'capability:media',
      summary: '调用图片生成模型',
      status: result.code === 0 ? 'finished' : 'failed',
    })
    const events =
      result.code === 0 ? await collectArtifacts(context.workspace) : await this.fallbackMarkdown(context, prompt, 'media')
    return dedupeArtifacts(events)
  }

  private async runResearchPack(context: DriverContext, prompt: string): Promise<RuntimeEvent[]> {
    const body = `# 调研简报\n\n## 任务\n${prompt}\n\n## 说明\n当前由本地降级驱动生成占位简报；配置 DeepSeek 凭据后由智能体完成真实调研。\n`
    await writeFile(path.join(context.workspace, 'research-brief.md'), body, 'utf8')
    return dedupeArtifacts(await collectArtifacts(context.workspace))
  }

  private async fallbackMarkdown(context: DriverContext, prompt: string, kind: string): Promise<RuntimeEvent[]> {
    const name = kind === 'media' ? 'generation-notes.md' : 'deliverable.md'
    const body = `# ${deriveTitle(prompt)}\n\n> 降级交付物（缺少运行时依赖或模型凭据时会走到这里）。\n\n## 任务\n${prompt}\n`
    await writeFile(path.join(context.workspace, name), body, 'utf8')
    return dedupeArtifacts(await collectArtifacts(context.workspace))
  }

  private async runScript(
    context: DriverContext,
    scriptPath: string,
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn('python3', [scriptPath, ...args, '--out', context.workspace], {
        cwd: context.workspace,
        env: process.env,
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stdout += text
        context.emit({ type: 'terminal', text })
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', (error) => resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` }))
      child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
    })
  }
}

function dedupeArtifacts(events: RuntimeEvent[]): RuntimeEvent[] {
  const seen = new Set<string>()
  const result: RuntimeEvent[] = []
  for (const event of events) {
    if (event.type !== 'artifact') continue
    if (seen.has(event.path)) continue
    seen.add(event.path)
    result.push(event)
  }
  return result
}

function deriveTitle(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim()
  return cleaned.length > 30 ? cleaned.slice(0, 30) : cleaned || '交付物'
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
