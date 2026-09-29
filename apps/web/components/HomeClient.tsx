'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Task, TaskTemplate, UsageSnapshot } from '@wiwana/protocol'
import { api, reportClientError } from '@/lib/api'
import { StatusChip } from '@/components/StatusChip'

export function HomeClient() {
  const router = useRouter()
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [usage, setUsage] = useState<UsageSnapshot | null>(null)
  const [prompt, setPrompt] = useState('')
  const [type, setType] = useState('office')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needLogin, setNeedLogin] = useState(false)
  /** null = 还在判断登录态 */
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        await api.me()
        setLoggedIn(true)
      } catch (caught) {
        setLoggedIn(false)
        setNeedLogin(true)
        setError(caught instanceof Error ? caught.message : '请先登录')
        void api.templates().then((response) => setTemplates(response.templates)).catch(() => {})
        return
      }
      const [templateResponse, usageResponse, taskResponse] = await Promise.all([
        api.templates(),
        api.usage(),
        api.tasks(),
      ])
      setTemplates(templateResponse.templates)
      setUsage(usageResponse.usage)
      setTasks(taskResponse.tasks)
    })()
  }, [])

  const submit = async () => {
    if (!prompt.trim()) {
      setError('请先输入任务描述，再点「开始执行」。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await api.createTask({ type, prompt: prompt.trim() })
      router.push(`/tasks/${created.task.id}`)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '创建任务失败'
      setError(message)
      reportClientError(caught, 'HomeClient.submit', { type, promptLength: prompt.trim().length })
      if (caught instanceof Error && caught.name === 'UnauthorizedError') {
        setLoggedIn(false)
        setNeedLogin(true)
      }
    } finally {
      setBusy(false)
    }
  }

  const loginCard = (
    <div className="rounded-2xl border border-[var(--wiwana-line)] bg-[var(--wiwana-brand-soft)] p-5">
      <p className="text-sm font-semibold text-[var(--wiwana-brand)]">请先登录，再创建任务</p>
      <p className="mt-1 text-xs text-[var(--wiwana-muted)]">
        任务与交付物属于你的账号。开发环境：手机号任意 11 位，验证码固定 <code className="font-mono">000000</code>。
      </p>
      <button className="btn btn-brand mt-3" onClick={() => router.push('/login')}>
        立即登录
      </button>
    </div>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <section className="card p-6">
        <h1 className="text-2xl font-semibold">交代一件事，剩下的交给智能体</h1>
        <p className="mt-2 text-sm text-[var(--wiwana-muted)]">
          任务在云端沙箱异步执行，可以关闭页面；完成后会在「交付物」里给你文件与分享链接。
        </p>

        {loggedIn === false ? (
          <div className="mt-5">{loginCard}</div>
        ) : (
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
            }}
            placeholder="例如：帮我做一份《2026 新能源汽车出海趋势》报告，包含市场概况、竞争格局、机会与风险，附一张销量对比图。"
            className="mt-5 h-36 w-full resize-none rounded-2xl border border-[var(--wiwana-line)] p-4 text-sm outline-none focus:border-[var(--wiwana-brand)]"
          />
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => {
                setType(template.type)
                setPrompt(template.examplePrompt)
              }}
              className={`chip border ${
                type === template.type
                  ? 'border-[var(--wiwana-brand)] bg-[var(--wiwana-brand-soft)] text-[var(--wiwana-brand)]'
                  : 'border-[var(--wiwana-line)] bg-white text-[var(--wiwana-muted)]'
              }`}
            >
              {template.title}
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--wiwana-muted)]">
            {loggedIn === false
              ? '登录后即可查看额度'
              : usage
                ? `今日已用 ${usage.tokens.used.toLocaleString()} / ${usage.tokens.limit.toLocaleString()} tokens · 运行中 ${usage.runningTasks.used}/${usage.runningTasks.limit}`
                : '正在加载额度…'}
          </span>
          <div className="flex items-center gap-3">
            {loggedIn !== false && !prompt.trim() && (
              <span className="text-xs text-[var(--wiwana-muted)]">输入任务描述后按钮可用（⌘/Ctrl + Enter 直接提交）</span>
            )}
            <button
              type="button"
              className="btn btn-brand"
              onClick={submit}
              disabled={busy || loggedIn === false || !prompt.trim()}
              title={loggedIn === false ? '请先登录' : !prompt.trim() ? '请先输入任务描述' : '开始执行'}
            >
              {busy ? '正在创建…' : loggedIn === false ? '请先登录' : '开始执行'}
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
            {needLogin && (
              <>
                {' '}
                <a className="underline" href="/login">
                  去登录
                </a>
              </>
            )}
          </p>
        )}
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">最近任务</h2>
        <div className="mt-4 space-y-3">
          {tasks.length === 0 && <p className="text-sm text-[var(--wiwana-muted)]">还没有任务，先在上面交代一件事。</p>}
          {tasks.map((task) => (
            <a
              key={task.id}
              href={`/tasks/${task.id}`}
              className="block rounded-xl border border-[var(--wiwana-line)] p-3 transition hover:border-[var(--wiwana-brand)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{task.title}</span>
                <StatusChip status={task.status} />
              </div>
              <p className="mt-1 truncate text-xs text-[var(--wiwana-muted)]">{task.prompt}</p>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--wiwana-line)]">
                <div className="h-full rounded-full bg-[var(--wiwana-brand)]" style={{ width: `${task.progress}%` }} />
              </div>
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
