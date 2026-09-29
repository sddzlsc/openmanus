'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Automation, Project } from '@wiwana/protocol'
import { api, reportClientError } from '@/lib/api'

const PRESETS = [
  { label: '每天早上 9 点', cron: '0 9 * * *' },
  { label: '每小时', cron: '0 * * * *' },
  { label: '每 30 分钟', cron: '*/30 * * * *' },
  { label: '每周一 10 点', cron: '0 10 * * 1' },
]

export function AutomationsClient() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState('')
  const [cron, setCron] = useState('0 9 * * *')
  const [prompt, setPrompt] = useState('')
  const [projectId, setProjectId] = useState<string>('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [automationResponse, projectResponse] = await Promise.all([api.automations(), api.projects()])
      setAutomations(automationResponse.automations)
      setProjects(projectResponse.projects)
      setProjectId((current) => current || projectResponse.projects[0]?.id || '')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    if (!projectId || !name.trim() || !prompt.trim()) {
      setError('请填写名称、执行内容，并选择一个项目')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.createAutomation({
        projectId,
        name: name.trim(),
        actionPrompt: prompt.trim(),
        trigger: { kind: 'schedule', cron: cron.trim(), timezone: 'Asia/Shanghai' },
      })
      setNotice(result.note)
      setName('')
      setPrompt('')
      await load()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '创建失败'
      setError(message)
      reportClientError(caught, 'AutomationsClient.create', { cron })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <section className="card p-6">
        <h1 className="text-xl font-semibold">新建自动化</h1>
        <p className="mt-1 text-xs text-[var(--wiwana-muted)]">
          到点自动创建任务并执行；任务完成后仍走正常的交付物与通知流程（时区：Asia/Shanghai）。
        </p>

        <label className="mt-4 block text-xs text-[var(--wiwana-muted)]">名称</label>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：每日项目进展汇总"
          className="mt-1 w-full rounded-xl border border-[var(--wiwana-line)] px-3 py-2 text-sm outline-none focus:border-[var(--wiwana-brand)]"
        />

        <label className="mt-3 block text-xs text-[var(--wiwana-muted)]">执行内容（会作为任务指令）</label>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例如：汇总昨天的项目进展，输出一份站会纪要并保存为 report.md"
          className="mt-1 h-24 w-full resize-none rounded-xl border border-[var(--wiwana-line)] p-3 text-sm outline-none focus:border-[var(--wiwana-brand)]"
        />

        <label className="mt-3 block text-xs text-[var(--wiwana-muted)]">执行时间（cron）</label>
        <input
          value={cron}
          onChange={(event) => setCron(event.target.value)}
          className="mt-1 w-full rounded-xl border border-[var(--wiwana-line)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--wiwana-brand)]"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.cron}
              type="button"
              onClick={() => setCron(preset.cron)}
              className="chip border border-[var(--wiwana-line)] bg-white text-[var(--wiwana-muted)]"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs text-[var(--wiwana-muted)]">所属项目</label>
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="mt-1 w-full rounded-xl border border-[var(--wiwana-line)] px-3 py-2 text-sm outline-none"
        >
          {projects.length === 0 && <option value="">（还没有项目，先创建一个任务）</option>}
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <button className="btn btn-brand mt-4 w-full" onClick={create} disabled={busy || !projectId}>
          {busy ? '正在创建…' : '创建自动化'}
        </button>
        {notice && <p className="mt-3 rounded-xl bg-[var(--wiwana-brand-soft)] px-3 py-2 text-xs text-[var(--wiwana-brand)]">{notice}</p>}
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">已配置的自动化</h2>
        <div className="mt-4 space-y-3">
          {automations.length === 0 && <p className="text-sm text-[var(--wiwana-muted)]">还没有自动化任务。</p>}
          {automations.map((automation) => (
            <div key={automation.id} className="rounded-xl border border-[var(--wiwana-line)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{automation.name}</span>
                <span className={`chip ${automation.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {automation.enabled ? '已启用' : '已停用'}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-[var(--wiwana-muted)]">{automation.actionPrompt}</p>
              <p className="mt-2 text-[11px] text-[var(--wiwana-muted)]">
                {automation.trigger.kind === 'schedule'
                  ? `cron: ${automation.trigger.cron} · 下次执行：${
                      automation.nextRunAt ? new Date(automation.nextRunAt).toLocaleString('zh-CN') : '—'
                    }`
                  : `事件触发：${automation.trigger.provider} / ${automation.trigger.event}`}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  className="btn btn-ghost !px-3 !py-1.5 text-xs"
                  onClick={async () => {
                    try {
                      await api.setAutomationEnabled(automation.id, !automation.enabled)
                      await load()
                    } catch (caught) {
                      setError(caught instanceof Error ? caught.message : '操作失败')
                    }
                  }}
                >
                  {automation.enabled ? '停用' : '启用'}
                </button>
                <button
                  className="btn btn-brand !px-3 !py-1.5 text-xs"
                  onClick={async () => {
                    try {
                      await api.runAutomationNow(automation.id)
                      setNotice(`已立即触发「${automation.name}」，去任务台查看进度`)
                    } catch (caught) {
                      setError(caught instanceof Error ? caught.message : '触发失败')
                    }
                  }}
                >
                  立即执行
                </button>
                <button
                  className="btn btn-ghost !px-3 !py-1.5 text-xs"
                  onClick={async () => {
                    try {
                      await api.deleteAutomation(automation.id)
                      await load()
                    } catch (caught) {
                      setError(caught instanceof Error ? caught.message : '删除失败')
                    }
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
