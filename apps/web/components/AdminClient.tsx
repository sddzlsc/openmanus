'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

interface ContainerRow {
  id: string
  projectId: string
  provider: string
  state: string
  previewPort: number | null
  lastActivityAt: string
}

interface TaskRow {
  id: string
  title: string
  type: string
  status: string
  progress: number
  projectId: string
}

export function AdminClient() {
  const [overview, setOverview] = useState<{ users: number; tasks: Record<string, number>; containers: Record<string, number> } | null>(null)
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.usage>>['usage'] | null>(null)
  const [containers, setContainers] = useState<ContainerRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [overviewResponse, usageResponse, containerResponse, taskResponse] = await Promise.all([
        api.adminOverview(),
        api.usage(),
        api.adminContainers(),
        api.adminTasks(),
      ])
      setOverview(overviewResponse)
      setUsage(usageResponse.usage)
      setContainers(containerResponse.containers)
      setTasks(taskResponse.tasks)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">本机控制台</h1>
            <p className="mt-1 text-xs text-[var(--wiwana-muted)]">
              单机单用户，无需登录。这里可以查看任务、容器与用量，并清理孤儿容器。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-ghost"
              onClick={async () => {
                try {
                  const result = await api.adminReap()
                  setNotice(`已回收 ${result.removed} 个孤儿容器`)
                  await load()
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : '回收失败')
                }
              }}
            >
              回收孤儿容器
            </button>
            <button className="btn btn-brand" onClick={() => void load()}>
              刷新
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          {[
            { label: '排队任务', value: overview?.tasks.queued ?? '—' },
            { label: '运行中', value: overview?.tasks.running ?? '—' },
            { label: '已完成', value: overview?.tasks.done ?? '—' },
            { label: '失败', value: overview?.tasks.failed ?? '—' },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-[var(--wiwana-line)] p-3">
              <p className="text-xs text-[var(--wiwana-muted)]">{item.label}</p>
              <p className="mt-1 text-lg font-semibold">{item.value}</p>
            </div>
          ))}
        </div>

        {usage && (
          <p className="mt-4 text-xs text-[var(--wiwana-muted)]">
            今日用量：{usage.tokens.used.toLocaleString()} / {usage.tokens.limit.toLocaleString()} tokens · 图片 {usage.images.used}/
            {usage.images.limit} · 视频 {usage.videos.used}/{usage.videos.limit} · 并发上限 {usage.runningTasks.limit}
          </p>
        )}
        {notice && <p className="mt-3 rounded-xl bg-[var(--wiwana-brand-soft)] px-3 py-2 text-xs text-[var(--wiwana-brand)]">{notice}</p>}
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">容器</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--wiwana-muted)]">
              <tr>
                <th className="py-2">容器</th>
                <th className="py-2">项目</th>
                <th className="py-2">状态</th>
                <th className="py-2">预览端口</th>
                <th className="py-2">最后活动</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((container) => (
                <tr key={container.id} className="border-t border-[var(--wiwana-line)]">
                  <td className="py-2 font-mono">{container.id.slice(0, 18)}</td>
                  <td className="py-2 font-mono">{container.projectId.slice(-8)}</td>
                  <td className="py-2">{container.state}</td>
                  <td className="py-2">{container.previewPort ?? '—'}</td>
                  <td className="py-2">{new Date(container.lastActivityAt).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
              {containers.length === 0 && (
                <tr>
                  <td className="py-3 text-[var(--wiwana-muted)]" colSpan={5}>
                    没有容器（任务沙箱用完即回收）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">最近任务</h2>
        <div className="mt-3 space-y-2">
          {tasks.map((task) => (
            <a
              key={task.id}
              href={`/tasks/${task.id}`}
              className="flex items-center justify-between rounded-xl border border-[var(--wiwana-line)] px-3 py-2 text-xs hover:border-[var(--wiwana-brand)]"
            >
              <span className="truncate">{task.title}</span>
              <span className="ml-3 shrink-0 text-[var(--wiwana-muted)]">
                {task.type} · {task.status} · {task.progress}%
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
