import type { TaskStatus } from '@wiwana/protocol'

const STYLES: Record<TaskStatus, { label: string; className: string }> = {
  queued: { label: '排队中', className: 'bg-slate-100 text-slate-600' },
  running: { label: '执行中', className: 'bg-indigo-50 text-indigo-600' },
  waiting_user: { label: '等待确认', className: 'bg-amber-50 text-amber-700' },
  done: { label: '已完成', className: 'bg-emerald-50 text-emerald-700' },
  failed: { label: '失败', className: 'bg-red-50 text-red-600' },
  cancelled: { label: '已取消', className: 'bg-slate-100 text-slate-500' },
}

export function StatusChip({ status }: { status: TaskStatus }) {
  const style = STYLES[status] ?? STYLES.queued
  return <span className={`chip ${style.className}`}>{style.label}</span>
}
