import { spawn, type ChildProcess } from 'node:child_process'
import type { DriverContext, RuntimeDriver } from './types.js'
import { collectArtifacts } from './artifacts.js'

export interface DshDriverOptions {
  binary: string
  profile: string
  home: string
  workspace: string
  timeoutMs: number
}

/**
 * dsh integration through the documented automation entry point.
 *
 * Why the headless CLI and not the web RPC — verified against the pinned
 * `@deepseek-ai/dsh@0.1.7-rc.2` inside the sandbox image:
 *   1. the web surface requires a launch-token → signed-cookie exchange
 *      (`GET /?token=...`, then a `dsh-auth-<authority>` cookie) and answers
 *      401 for every `/api` call without it;
 *   2. the RPC endpoint set is no longer the documented 0.1.0 shape: `POST
 *      /api/host.describe` answers 404, and endpoints come from the
 *      Typert/remotes layer instead of being statically discoverable.
 * The headless profile is the automation-oriented, documented path: one fresh
 * persisted session per invocation, final answer on stdout, exit code 0/1.
 *
 * One task = one `dsh --profile <profile> "<prompt>"` run in the workspace.
 * Follow-up messages re-run with the accumulated instruction history, because
 * headless exposes no session resume.
 */
export class DshDriver implements RuntimeDriver {
  readonly kind = 'dsh' as const
  private child: ChildProcess | null = null
  private history: string[] = []
  private cancelled = false

  constructor(private readonly options: DshDriverOptions) {}

  /**
   * Cheap pre-flight: the binary answers, the profile composes, and a DeepSeek
   * credential is visible to the child. A missing credential must fall back to
   * the local driver rather than burning a doomed model call.
   */
  static async probe(options: DshDriverOptions): Promise<boolean> {
    if (!process.env.DEEPSEEK_API_KEY) return false
    if ((await runOnce(options.binary, ['--version'], options.workspace)) !== 0) return false
    return (await runOnce(options.binary, ['--profile', options.profile, '--dump-default-config'], options.workspace)) === 0
  }

  async start(context: DriverContext): Promise<void> {
    this.history = [context.session.prompt]
    await this.runOnce(context)
  }

  async send(context: DriverContext, text: string): Promise<void> {
    this.history.push(text)
    context.emit({ type: 'message', role: 'system', text: `已接收补充说明，继续执行：${text}` })
    await this.runOnce(context)
  }

  async cancel(context: DriverContext): Promise<void> {
    this.cancelled = true
    this.child?.kill('SIGTERM')
    context.emit({ type: 'status', status: 'cancelled', progress: 0, note: '任务已取消' })
  }

  private async runOnce(context: DriverContext): Promise<void> {
    this.cancelled = false
    context.emit({ type: 'status', status: 'running', progress: 8, note: '正在启动 dsh 智能体' })
    const prompt = buildPrompt(this.history, context.session.type)
    const started = Date.now()

    const timers = [
      setTimeout(() => context.emit({ type: 'status', status: 'running', progress: 35, note: '智能体正在执行' }), 15_000),
      setTimeout(() => context.emit({ type: 'status', status: 'running', progress: 60, note: '正在生成交付物' }), 60_000),
      setTimeout(() => context.emit({ type: 'status', status: 'running', progress: 82, note: '仍在执行（长任务）' }), 180_000),
    ]

    const result = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>(
      (resolve) => {
        const child = spawn(this.options.binary, ['--profile', this.options.profile, prompt], {
          cwd: this.options.workspace,
          env: { ...process.env, DSH_HOME: this.options.home, HOME: process.env.HOME ?? '/home/agent' },
        })
        this.child = child
        let stdout = ''
        let stderr = ''
        let timedOut = false
        let settled = false

        const timeout = setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
        }, this.options.timeoutMs)

        // dsh prints token-by-token; relaying every fragment produced >12k events
        // for a single project task. Batch into ~400-character chunks flushed at
        // most every 300 ms so the timeline stays readable and SSE stays cheap.
        let buffer = ''
        let flushTimer: NodeJS.Timeout | null = null
        const flush = () => {
          if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
          }
          const text = buffer.trim()
          buffer = ''
          if (text) context.emit({ type: 'terminal', text: `${text}\n` })
        }
        const relay = (text: string, target: 'stdout' | 'stderr') => {
          if (target === 'stdout') stdout += text
          else stderr += text
          buffer += text
          if (buffer.length >= 400) flush()
          else if (!flushTimer) flushTimer = setTimeout(flush, 300)
        }
        child.stdout.on('data', (chunk: Buffer) => relay(chunk.toString(), 'stdout'))
        child.stderr.on('data', (chunk: Buffer) => relay(chunk.toString(), 'stderr'))
        child.on('error', (error) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          resolve({ code: 127, stdout, stderr: `${stderr}${error.message}`, timedOut })
        })
        child.on('close', (code) => {
          if (settled) return
          settled = true
          flush()
          clearTimeout(timeout)
          resolve({ code, stdout, stderr, timedOut })
        })
      },
    )

    for (const timer of timers) clearTimeout(timer)
    this.child = null
    if (this.cancelled) return

    const artifacts = await collectArtifacts(this.options.workspace)
    for (const artifact of artifacts) context.emit(artifact)

    const answer = result.stdout.trim()
    if (result.timedOut) {
      context.emit({
        type: 'error',
        message: `任务超过 ${Math.round(this.options.timeoutMs / 60000)} 分钟未完成，已中止；已产出的文件仍保留在工作区。`,
        retryable: true,
      })
      return
    }
    if (result.code !== 0 || answer.length === 0) {
      const detail = (result.stderr || result.stdout).trim().slice(-600)
      const credentialHint = /MISSING_CREDENTIAL|no API key/i.test(detail)
        ? '（未配置 DeepSeek 凭据：请在控制面注入 DEEPSEEK_API_KEY）'
        : ''
      context.emit({
        type: 'error',
        message: `dsh 执行失败（退出码 ${result.code}）${credentialHint}${detail ? `：${detail}` : ''}`,
        retryable: credentialHint.length === 0,
      })
      return
    }

    context.emit({ type: 'message', role: 'agent', text: answer.slice(0, 4000) })
    context.emit({
      type: 'usage',
      tokens: estimateTokens(prompt, answer),
      ...(context.session.type === 'media' ? { images: 1 } : {}),
    })
    context.emit({ type: 'status', status: 'running', progress: 95, note: '整理交付物' })
    context.emit({
      type: 'done',
      summary:
        artifacts.length > 0
          ? `已完成，产出 ${artifacts.length} 个交付物（耗时 ${Math.round((Date.now() - started) / 1000)} 秒）。`
          : `已完成（耗时 ${Math.round((Date.now() - started) / 1000)} 秒），结果见回复正文。`,
    })
  }
}

/** Product framing: the headless agent must leave files, not only prose. */
function buildPrompt(history: string[], type: string): string {
  const [first, ...followUps] = history
  const suiteHint =
    type === 'fullstack'
      ? [
          '',
          '这是一个**成套项目**任务，必须交付四端而不是单个页面：',
          '先运行 `node /opt/wiwana/capabilities/fullstack/scripts/bootstrap.mjs --out /workspace --name "<项目名>" --domain "<业务领域>"` 生成骨架，',
          '然后按需求改造 site/（网站）、admin/（后台管理）、api/（后端接口，数据落在 api/data/）、app/（uni-app 源码，用于小程序与 App）。',
          '自检要求：/api/health 返回 200、/admin/ 能增删查数据、/ 首页能读到接口数据；再用 browser 截图 + vision 检查排版。',
          '交付说明里必须写清：小程序/App 用 HBuilderX 打开 app/ 目录打包（不要在回复里声称已打包成功）。',
        ]
      : []
  const researchHint =
    type === 'research'
      ? [
          '',
          '这是一个调研任务：对象超过 4 个时必须用 subagent 工具并行派发子智能体（每个 2–4 个对象，一批不超过 8 个），',
          '子任务描述里写清「研究范围 + 需要的字段 + 必须附来源链接」；全部返回后按来源去重合并成对比表，',
          '并在时间线里打印「派出子智能体：…」「子智能体完成：…（来源 N 条）」两行进度。',
        ]
      : []
  const lines = [
    '你是 Wiwana 智能体在沙箱中的执行单元。当前工作目录就是 /workspace，你的产出会被直接交付给用户。',
    `任务类型：${type}。`,
    '要求：把最终交付物写成文件放在当前工作目录（例如 report.md、deliverable.docx、deck.pptx、workbook.xlsx、index.html、chart.svg），',
    '文件内容用中文、排版整洁；完成后用一段话说明产出了哪些文件、每个文件的用途。不要把大段正文只写在回复里。',
    '环境里已预装 python-docx / openpyxl / python-pptx / reportlab / matplotlib，可直接用它们生成 .docx/.xlsx/.pptx/.pdf。',
    '凡是报告、方案、周报、演讲稿、分析结论这类文字交付物，必须同时生成一份 Word 文档（.docx），文件名与 Markdown 一致。',
    '幻灯片要有版式设计（色块、卡片、页码、栏目结构），不要用纯文字卡片糊一版；',
    '交付前必须运行 /opt/wiwana/capabilities/office/scripts/check_pptx.py 校验；',
    '若报文字溢出，用 office/scripts/fix_pptx_overflow.py 在保留原设计的前提下修复（撑高/缩字），再复检直到退出码为 0。',
    '修完溢出后必须再跑 office/scripts/polish_pptx_layout.py 做构图对齐：每个色块内的文案要水平+垂直居中（四周留白相等），最后再跑一次 check_pptx.py。',
    '硬性要求：写完文件后必须运行 `ls -la` 确认它们真实存在；任何交付物没有真正生成，都要在最终回复里说明原因，不能只说“已完成”。',
    // ── coding & browsing routing ────────────────────────────────────────────
    '编程类任务（写代码、改仓库、跑测试、调试、重构）优先委派给 `subagent_codex`（Codex）或 `subagent_claude_code`（Claude Code）——',
    '两者在本沙箱内都已指向 DeepSeek（Codex 走 Responses 协议、Claude Code 走 Anthropic 兼容端点），不需要 OpenAI/Anthropic 账号：',
    '把「目标 + 相关文件路径 + 验收命令」写清楚交给它们，它们会在同一工作区里直接改代码；返回后必须自己跑一遍测试/构建确认。',
    '如果需要访问真实网页（查资料、登录后抓取、填表、验证上线效果、留证截图），使用 browser 能力包：',
    '`python3 /opt/wiwana/capabilities/browser/scripts/browse.py --url <URL> --action text|links|screenshot|fill|click`；',
    '关键步骤要截图存到工作区（截图会被登记为交付物），不要在浏览器里做人工翻页拼接。',
    '视觉自检：产出网页/幻灯片/海报后，先用 browser 包截图，再运行 vision 能力包',
    '`python3 /opt/wiwana/capabilities/vision/scripts/describe_image.py --image <截图>` 检查排版',
    '（文字是否超出色块、元素是否重叠、对比度是否足够），把结论写进时间线后再修，最多挑 3 个最严重的问题。',
    '',
    `用户任务：${first ?? ''}`,
    ...researchHint,
    ...suiteHint,
  ]
  if (followUps.length > 0) {
    lines.push('', '后续补充要求（按时间顺序，优先级更高）：')
    for (const item of followUps) lines.push(`- ${item}`)
  }
  return lines.join('\n')
}

function estimateTokens(prompt: string, answer: string): number {
  // dsh prints no token usage in headless mode; this is a deliberate, documented
  // proxy for quota accounting (3 characters ≈ 1 token for mixed zh/en text).
  return Math.max(1, Math.round((prompt.length + answer.length) / 3))
}

function runOnce(binary: string, args: string[], cwd: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { cwd, env: process.env })
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(127)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}
