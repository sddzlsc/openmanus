'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Artifact, Project, Task, TaskEvent } from '@wiwana/protocol'
import { api, reportClientError, subscribeTask } from '@/lib/api'
import { StatusChip } from '@/components/StatusChip'
import { ArtifactCard } from '@/components/ArtifactCard'

type TimelineItem = { seq: number; kind: string; text: string }

export function TaskClient({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<Task | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [items, setItems] = useState<TimelineItem[]>([])
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [terminalTail, setTerminalTail] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      const detail = await api.task(taskId)
      setTask(detail.task)
      setProject(detail.project)
      setArtifacts(detail.artifacts)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加载失败')
      reportClientError(caught, 'TaskClient.refresh', { taskId })
    }
  }, [taskId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const unsubscribe = subscribeTask(taskId, (event: TaskEvent) => {
      setItems((current) => [...current, toItem(event)].slice(-200))
      if (event.type === 'screenshot') setScreenshot(event.dataUrl)
      if (event.type === 'terminal') setTerminalTail((current) => [...current, event.text].slice(-40))
      if (event.type === 'artifact') void refresh()
      if (event.type === 'status' || event.type === 'done' || event.type === 'error') void refresh()
    })
    return unsubscribe
  }, [taskId, refresh])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [items.length])

  const canChat = useMemo(() => task?.status === 'running' || task?.status === 'waiting_user', [task?.status])

  const send = async () => {
    if (!message.trim() || !canChat) return
    const text = message.trim()
    setMessage('')
    try {
      await api.sendMessage(taskId, text)
      setItems((current) => [...current, { seq: Date.now(), kind: 'user', text }])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送失败')
      reportClientError(caught, 'TaskClient.send', { taskId })
    }
  }

  const cancel = async () => {
    try {
      await api.cancelTask(taskId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '取消失败')
      reportClientError(caught, 'TaskClient.cancel', { taskId })
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.05fr_1fr]">
      <section className="card flex h-[78vh] flex-col p-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{task?.title ?? '加载中…'}</h1>
            <p className="mt-1 line-clamp-2 text-xs text-[var(--wiwana-muted)]">{task?.prompt}</p>
          </div>
          {task && <StatusChip status={task.status} />}
        </header>

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[var(--wiwana-line)]">
          <div className="h-full rounded-full bg-[var(--wiwana-brand)] transition-all" style={{ width: `${task?.progress ?? 0}%` }} />
        </div>

        <div className="timeline-scroll mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
          {items.map((item) => (
            <div key={`${item.seq}-${item.kind}`} className={itemClassName(item.kind)}>
              <span className="mr-2 text-[11px] uppercase tracking-wide opacity-60">{labelFor(item.kind)}</span>
              <span className="whitespace-pre-wrap text-sm">{item.text}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            disabled={!canChat}
            placeholder={canChat ? '补充说明或调整方向（回车发送）' : '任务结束后不可追加消息'}
            className="flex-1 rounded-xl border border-[var(--wiwana-line)] px-3 py-2 text-sm outline-none focus:border-[var(--wiwana-brand)] disabled:bg-slate-50"
          />
          <button className="btn btn-primary" onClick={send} disabled={!canChat || !message.trim()}>
            发送
          </button>
          <button className="btn btn-ghost" onClick={cancel} disabled={!canChat}>
            取消
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </section>

      <section className="space-y-5">
        <div className="card p-5">
          <h2 className="text-lg font-semibold">电脑视图</h2>
          <p className="mt-1 text-xs text-[var(--wiwana-muted)]">
            实时显示智能体在沙箱里的操作：浏览器截图流 + 终端输出（M3 接入 CDP 截图流）。
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-[var(--wiwana-line)] bg-slate-50">
            {screenshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={screenshot} alt="智能体浏览器画面" className="w-full" />
            ) : (
              <div className="grid h-40 place-items-center text-xs text-[var(--wiwana-muted)]">暂无浏览器画面</div>
            )}
          </div>
          <pre className="mt-3 h-32 overflow-y-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
            {terminalTail.length > 0 ? terminalTail.join('') : '$ 等待智能体执行…\n'}
          </pre>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">交付物</h2>
            <div className="flex gap-2">
              <button
                className="btn btn-ghost !px-3 !py-1.5 text-xs"
                onClick={async () => {
                  try {
                    const result = await api.rescanTask(taskId)
                    setError(result.added.length > 0 ? null : '没有发现新的文件')
                    await refresh()
                  } catch (caught) {
                    setError(caught instanceof Error ? caught.message : '刷新失败')
                  }
                }}
              >
                刷新交付物
              </button>
              <a className="btn btn-brand !px-3 !py-1.5 text-xs" href={api.exportTaskUrl(taskId)}>
                打包下载全部
              </a>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            {artifacts.length === 0 && <p className="text-sm text-[var(--wiwana-muted)]">任务产出后会出现在这里。</p>}
            {artifacts.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} onChange={refresh} />
            ))}
          </div>
          {project && artifacts.some((artifact) => artifact.kind === 'website') && (
            <a
              className="mt-4 inline-block text-xs text-[var(--wiwana-brand)] underline"
              href={`/preview/${project.id}/index.html`}
              target="_blank"
            >
              打开网站预览
            </a>
          )}
        </div>
      </section>
    </div>
  )
}

function toItem(event: TaskEvent): TimelineItem {
  switch (event.type) {
    case 'status':
      return { seq: event.seq, kind: 'status', text: `${event.progress}% ${event.note ?? ''}`.trim() }
    case 'thought':
      return { seq: event.seq, kind: 'thought', text: event.text }
    case 'tool':
      return { seq: event.seq, kind: 'tool', text: `${event.summary || event.name}（${event.status}）` }
    case 'message':
      return { seq: event.seq, kind: event.role, text: event.text }
    case 'terminal':
      return { seq: event.seq, kind: 'terminal', text: event.text.trim() }
    case 'artifact':
      return { seq: event.seq, kind: 'artifact', text: `产出交付物：${event.artifact.name}` }
    case 'usage':
      return {
        seq: event.seq,
        kind: 'usage',
        text: `消耗 ${event.tokens} tokens${event.images ? ` · 图片 ${event.images}` : ''}${event.videos ? ` · 视频 ${event.videos}` : ''}`,
      }
    case 'screenshot':
      return { seq: event.seq, kind: 'screenshot', text: event.caption ?? '浏览器截图已更新' }
    case 'error':
      return { seq: event.seq, kind: 'error', text: `${event.message}${event.retryable ? '（可重试）' : ''}` }
    case 'done':
      return { seq: event.seq, kind: 'done', text: event.summary }
  }
}

function labelFor(kind: string): string {
  const map: Record<string, string> = {
    status: '进度',
    thought: '思考',
    tool: '工具',
    terminal: '终端',
    artifact: '交付物',
    usage: '用量',
    error: '错误',
    done: '完成',
    user: '我',
    agent: '智能体',
    system: '系统',
  }
  return map[kind] ?? kind
}

function itemClassName(kind: string): string {
  switch (kind) {
    case 'error':
      return 'rounded-xl bg-red-50 px-3 py-2 text-red-700'
    case 'done':
      return 'rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700'
    case 'artifact':
      return 'rounded-xl bg-indigo-50 px-3 py-2 text-indigo-700'
    case 'user':
      return 'rounded-xl bg-slate-100 px-3 py-2'
    case 'terminal':
      return 'rounded-xl bg-slate-900/95 px-3 py-2 font-mono text-[12px] text-slate-100'
    default:
      return 'rounded-xl border border-[var(--wiwana-line)] px-3 py-2'
  }
}
